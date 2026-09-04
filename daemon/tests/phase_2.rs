use std::{path::Path, time::Duration};

use aqua_daemon::{router_with_fs_root, router_with_fs_root_and_shutdown};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use futures_util::{SinkExt, StreamExt};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::TempDir;
use tokio::{net::TcpListener, time::timeout};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};
use tower::ServiceExt;

const ALLOWED_ORIGIN: &str = "http://localhost:1420";

async fn spawn_request(
    router: Router,
    root: &Path,
    body: Value,
    origin: Option<&str>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method("POST")
        .uri("/api/pty/spawn")
        .header("content-type", "application/json");
    if let Some(origin) = origin {
        builder = builder.header("origin", origin);
    }
    let response = router
        .oneshot(builder.body(Body::from(body.to_string())).unwrap())
        .await
        .expect("spawn handler should respond");
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("spawn response should be readable")
        .to_bytes();
    let payload = serde_json::from_slice(&bytes).unwrap_or_else(|error| {
        panic!(
            "spawn response should be JSON for root {}: {error}",
            root.display()
        )
    });
    (status, payload)
}

async fn start_server(root: &Path) -> (Router, String, tokio::task::JoinHandle<()>) {
    let router = router_with_fs_root(root.to_path_buf());
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let server_router = router.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_router).await.unwrap();
    });
    (router, format!("ws://{address}"), server)
}

async fn connect(
    url: &str,
    origin: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let mut request = url.into_client_request().unwrap();
    request
        .headers_mut()
        .insert("origin", origin.parse().unwrap());
    connect_async(request)
        .await
        .expect("PTY websocket should connect")
        .0
}

#[tokio::test]
async fn spawn_requires_an_exact_allowed_origin() {
    let root = TempDir::new().unwrap();
    for origin in [None, Some("null"), Some("https://example.com")] {
        let (status, body) = spawn_request(
            router_with_fs_root(root.path().to_path_buf()),
            root.path(),
            json!({"cols": 80, "rows": 24}),
            origin,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(
            body["error"]
                .as_str()
                .is_some_and(|error| !error.is_empty())
        );
    }
}

#[tokio::test]
async fn spawn_validates_dimensions_and_working_directory() {
    let root = TempDir::new().unwrap();
    let router = router_with_fs_root(root.path().to_path_buf());
    for body in [
        json!({"cols": 0, "rows": 24}),
        json!({"cols": 80, "rows": 1001}),
        json!({"cols": 80, "rows": 24, "cwd": "missing"}),
        json!({"cols": 80, "rows": 24, "cwd": "/"}),
    ] {
        let (status, response) =
            spawn_request(router.clone(), root.path(), body, Some(ALLOWED_ORIGIN)).await;
        assert!(status.is_client_error());
        assert!(
            response["error"]
                .as_str()
                .is_some_and(|error| !error.is_empty())
        );
    }
}

#[tokio::test]
async fn binary_io_resize_and_exit_follow_the_contract() {
    let root = TempDir::new().unwrap();
    let (router, base_url, server) = start_server(root.path()).await;
    let (status, response) = spawn_request(
        router,
        root.path(),
        json!({"cols": 80, "rows": 24, "cwd": root.path()}),
        Some(ALLOWED_ORIGIN),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let session_id = response["sessionId"].as_str().unwrap();
    let url = format!("{base_url}/ws/pty/{session_id}");
    let mut socket = connect(&url, ALLOWED_ORIGIN).await;

    socket
        .send(Message::Text(
            json!({"type": "resize", "cols": 100, "rows": 30})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    socket
        .send(Message::Binary(
            b"printf AQUA_PTY_OK; exit 7\n".to_vec().into(),
        ))
        .await
        .unwrap();

    let mut output = Vec::new();
    let mut exit = None;
    while let Some(frame) = socket.next().await {
        match frame.unwrap() {
            Message::Binary(bytes) => output.extend_from_slice(&bytes),
            Message::Text(text) => {
                let control: Value = serde_json::from_str(&text).unwrap();
                if control["type"] == "exit" {
                    exit = control["code"].as_u64();
                }
            }
            Message::Close(_) => break,
            Message::Ping(payload) => socket.send(Message::Pong(payload)).await.unwrap(),
            Message::Pong(_) | Message::Frame(_) => {}
        }
    }

    assert!(String::from_utf8_lossy(&output).contains("AQUA_PTY_OK"));
    assert_eq!(exit, Some(7));
    server.abort();
}

async fn read_until(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    needle: &str,
) -> Vec<u8> {
    timeout(Duration::from_secs(5), async {
        let mut output = Vec::new();
        while !String::from_utf8_lossy(&output).contains(needle) {
            match socket
                .next()
                .await
                .expect("PTY websocket should remain open")
                .unwrap()
            {
                Message::Binary(bytes) => output.extend_from_slice(&bytes),
                Message::Ping(payload) => socket.send(Message::Pong(payload)).await.unwrap(),
                Message::Close(frame) => panic!("PTY websocket closed early: {frame:?}"),
                Message::Text(_) | Message::Pong(_) | Message::Frame(_) => {}
            }
        }
        output
    })
    .await
    .expect("PTY output should arrive")
}

#[tokio::test]
async fn concurrent_sessions_are_isolated() {
    let root = TempDir::new().unwrap();
    let (router, base_url, server) = start_server(root.path()).await;
    let mut session_ids = Vec::new();
    for _ in 0..2 {
        let (status, response) = spawn_request(
            router.clone(),
            root.path(),
            json!({"cols": 80, "rows": 24, "cwd": root.path()}),
            Some(ALLOWED_ORIGIN),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        session_ids.push(response["sessionId"].as_str().unwrap().to_owned());
    }
    assert_ne!(session_ids[0], session_ids[1]);

    let mut first = connect(
        &format!("{base_url}/ws/pty/{}", session_ids[0]),
        ALLOWED_ORIGIN,
    )
    .await;
    let mut second = connect(
        &format!("{base_url}/ws/pty/{}", session_ids[1]),
        ALLOWED_ORIGIN,
    )
    .await;
    first
        .send(Message::Binary(b"printf FIRST_ONLY\n".to_vec().into()))
        .await
        .unwrap();
    second
        .send(Message::Binary(b"printf SECOND_ONLY\n".to_vec().into()))
        .await
        .unwrap();

    let first_output = read_until(&mut first, "FIRST_ONLY").await;
    let second_output = read_until(&mut second, "SECOND_ONLY").await;
    assert!(!String::from_utf8_lossy(&first_output).contains("SECOND_ONLY"));
    assert!(!String::from_utf8_lossy(&second_output).contains("FIRST_ONLY"));
    first.close(None).await.unwrap();
    second.close(None).await.unwrap();
    server.abort();
}

#[tokio::test]
async fn disconnect_terminates_the_shell_process() {
    let root = TempDir::new().unwrap();
    let pid_file = root.path().join("shell.pid");
    let child_pid_file = root.path().join("child.pid");
    let (router, base_url, server) = start_server(root.path()).await;
    let (_, response) = spawn_request(
        router,
        root.path(),
        json!({"cols": 80, "rows": 24, "cwd": root.path()}),
        Some(ALLOWED_ORIGIN),
    )
    .await;
    let mut socket = connect(
        &format!(
            "{base_url}/ws/pty/{}",
            response["sessionId"].as_str().unwrap()
        ),
        ALLOWED_ORIGIN,
    )
    .await;
    socket
        .send(Message::Binary(
            format!(
                "echo $$ > {}; sleep 60 & echo $! > {}; printf PID_READY; wait\n",
                pid_file.display(),
                child_pid_file.display()
            )
            .into_bytes()
            .into(),
        ))
        .await
        .unwrap();
    read_until(&mut socket, "PID_READY").await;
    let pid = timeout(Duration::from_secs(5), async {
        loop {
            match tokio::fs::read_to_string(&pid_file).await {
                Ok(pid) => break pid,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
                Err(error) => panic!("failed to read shell PID: {error}"),
            }
        }
    })
    .await
    .expect("shell should write its PID");
    let child_pid = timeout(Duration::from_secs(5), async {
        loop {
            match tokio::fs::read_to_string(&child_pid_file).await {
                Ok(pid) => break pid,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
                Err(error) => panic!("failed to read child PID: {error}"),
            }
        }
    })
    .await
    .expect("shell should write its child PID");
    socket.close(None).await.unwrap();

    for process_id in [pid.trim(), child_pid.trim()] {
        // 30s ceiling: GitHub Actions runners can take far longer than a local
        // machine to reap the process group after the websocket drops. 5s
        // flaked there (the group did terminate, just slowly).
        timeout(Duration::from_secs(30), async {
            loop {
                let status = tokio::process::Command::new("kill")
                    .args(["-0", process_id])
                    .stderr(std::process::Stdio::null())
                    .status()
                    .await
                    .unwrap();
                if !status.success() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("shell process group should terminate after websocket disconnect");
    }
    server.abort();
}

#[tokio::test]
async fn daemon_shutdown_terminates_attached_shell_processes() {
    let root = TempDir::new().unwrap();
    let pid_file = root.path().join("shutdown.pid");
    let (router, shutdown) = router_with_fs_root_and_shutdown(root.path().to_path_buf());
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let server_router = router.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_router).await.unwrap();
    });
    let (_, response) = spawn_request(
        router,
        root.path(),
        json!({"cols": 80, "rows": 24, "cwd": root.path()}),
        Some(ALLOWED_ORIGIN),
    )
    .await;
    let mut socket = connect(
        &format!(
            "ws://{address}/ws/pty/{}",
            response["sessionId"].as_str().unwrap()
        ),
        ALLOWED_ORIGIN,
    )
    .await;
    socket
        .send(Message::Binary(
            format!(
                "echo $$ > {}; printf SHUTDOWN_READY; sleep 60\n",
                pid_file.display()
            )
            .into_bytes()
            .into(),
        ))
        .await
        .unwrap();
    read_until(&mut socket, "SHUTDOWN_READY").await;
    let pid = timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(pid) = tokio::fs::read_to_string(&pid_file).await {
                break pid;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("shell should write its PID");

    shutdown.shutdown();
    timeout(Duration::from_secs(5), async {
        loop {
            let status = tokio::process::Command::new("kill")
                .args(["-0", pid.trim()])
                .stderr(std::process::Stdio::null())
                .status()
                .await
                .unwrap();
            if !status.success() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("daemon shutdown should terminate the shell");
    server.abort();
}

#[tokio::test]
async fn websocket_origin_control_validation_and_single_attachment_are_enforced() {
    let root = TempDir::new().unwrap();
    let (router, base_url, server) = start_server(root.path()).await;
    let (_, response) = spawn_request(
        router,
        root.path(),
        json!({"cols": 80, "rows": 24, "cwd": root.path()}),
        Some(ALLOWED_ORIGIN),
    )
    .await;
    let url = format!(
        "{base_url}/ws/pty/{}",
        response["sessionId"].as_str().unwrap()
    );

    let mut denied = url.as_str().into_client_request().unwrap();
    denied
        .headers_mut()
        .insert("origin", "https://example.com".parse().unwrap());
    let error = connect_async(denied)
        .await
        .expect_err("unapproved Origin should fail");
    assert!(error.to_string().contains("403"));

    let mut socket = connect(&url, ALLOWED_ORIGIN).await;
    let mut second = url.as_str().into_client_request().unwrap();
    second
        .headers_mut()
        .insert("origin", ALLOWED_ORIGIN.parse().unwrap());
    let error = connect_async(second)
        .await
        .expect_err("session should only attach once");
    assert!(error.to_string().contains("404"));

    socket
        .send(Message::Text("terminal text is not stdin".into()))
        .await
        .unwrap();
    let close = socket.next().await.unwrap().unwrap();
    match close {
        Message::Close(Some(frame)) => assert_eq!(u16::from(frame.code), 1008),
        other => panic!("expected policy close, got {other:?}"),
    }
    server.abort();
}
