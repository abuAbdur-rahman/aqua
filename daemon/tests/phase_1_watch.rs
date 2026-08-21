use std::{path::Path, time::Duration};

use aqua_daemon::router_with_fs_root;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};

async fn start_server(root: &Path) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let router: Router = router_with_fs_root(root.to_path_buf());
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (format!("ws://{address}/ws/fs-watch"), server)
}

async fn next_change(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(3), socket.next())
            .await
            .expect("watch event should arrive")
            .expect("watch websocket should remain open")
            .expect("watch frame should be valid");
        if let Message::Text(text) = message {
            let value: Value = serde_json::from_str(&text).expect("watch frame should be JSON");
            if value.get("type") == Some(&Value::String("change".into())) {
                return value;
            }
        }
    }
}

#[tokio::test]
async fn watch_subscribe_reports_create_and_modified_events() {
    let root = TempDir::new().unwrap();
    let (url, server) = start_server(root.path()).await;
    let (mut socket, _) = connect_async(url).await.unwrap();
    socket
        .send(Message::Text(r#"{"type":"subscribe","path":"."}"#.into()))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;

    let file = root.path().join("watched.txt");
    tokio::fs::write(&file, "one").await.unwrap();
    let created = next_change(&mut socket).await;
    assert_eq!(created["kind"], "created");
    assert_eq!(created["path"], file.to_string_lossy().to_string());
    assert_eq!(created["entry"]["kind"], "file");

    tokio::time::sleep(Duration::from_millis(250)).await;
    tokio::fs::write(&file, "two").await.unwrap();
    tokio::fs::write(&file, "three").await.unwrap();
    tokio::fs::write(&file, "final").await.unwrap();
    let modified = next_change(&mut socket).await;
    assert_eq!(modified["kind"], "modified");
    assert_eq!(modified["entry"]["size"], 5);
    let duplicate = tokio::time::timeout(Duration::from_millis(350), socket.next()).await;
    assert!(
        duplicate.is_err(),
        "a write burst should produce one debounced event"
    );

    tokio::fs::remove_file(&file).await.unwrap();
    let removed = next_change(&mut socket).await;
    assert_eq!(removed["kind"], "removed");
    assert_eq!(removed["path"], file.to_string_lossy().to_string());
    assert!(removed.get("entry").is_none());

    socket.close(None).await.unwrap();
    server.abort();
}

#[tokio::test]
async fn watch_unsubscribe_stops_events_and_rename_is_deterministic() {
    let root = TempDir::new().unwrap();
    let (url, server) = start_server(root.path()).await;
    let (mut socket, _) = connect_async(url).await.unwrap();
    socket
        .send(Message::Text(r#"{"type":"subscribe","path":"."}"#.into()))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;

    let original = root.path().join("original.txt");
    let renamed = root.path().join("renamed.txt");
    tokio::fs::write(&original, "data").await.unwrap();
    let _ = next_change(&mut socket).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    tokio::fs::rename(&original, &renamed).await.unwrap();
    let event = next_change(&mut socket).await;
    assert_eq!(event["kind"], "renamed");
    assert_eq!(event["path"], renamed.to_string_lossy().to_string());

    socket
        .send(Message::Text(r#"{"type":"unsubscribe","path":"."}"#.into()))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;
    tokio::fs::write(root.path().join("ignored.txt"), "ignored")
        .await
        .unwrap();
    let no_event = tokio::time::timeout(Duration::from_millis(500), socket.next()).await;
    assert!(
        no_event.is_err(),
        "unsubscribed clients must not receive filesystem events"
    );

    socket.close(None).await.unwrap();
    server.abort();
}
