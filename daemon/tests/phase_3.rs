use std::time::Duration;

use aqua_daemon::router_with_fs_root;
use futures_util::StreamExt;
use tempfile::TempDir;
use tokio::{net::TcpListener, time::timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message};

async fn start_server(root: &std::path::Path) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let root = root.to_path_buf();
    let server = tokio::spawn(async move {
        axum::serve(listener, router_with_fs_root(root))
            .await
            .unwrap();
    });
    (format!("ws://{address}/ws/sysmon"), server)
}

async fn next_stats(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> serde_json::Value {
    timeout(Duration::from_secs(4), async {
        loop {
            if let Some(Ok(Message::Text(text))) = socket.next().await {
                let value: serde_json::Value = serde_json::from_str(&text).unwrap();
                if value["type"] == "stats" {
                    break value;
                }
            }
        }
    })
    .await
    .expect("sysmon should emit within four seconds")
}

#[tokio::test]
async fn sysmon_stream_emits_contract_shaped_stats() {
    let root = TempDir::new().unwrap();
    let (url, server) = start_server(root.path()).await;
    let (mut socket, _) = connect_async(url).await.unwrap();
    let frame = next_stats(&mut socket).await;

    assert_eq!(frame["type"], "stats");
    assert!(frame["cpuPercent"].as_f64().unwrap().is_finite());
    assert!(frame["memUsed"].as_u64().is_some());
    assert!(frame["memTotal"].as_u64().is_some());
    assert!(frame["disks"].is_array());
    assert!(frame["processes"].is_array());
    let process = frame["processes"].as_array().unwrap().first().unwrap();
    assert!(process["pid"].as_u64().is_some());
    assert!(process["name"].as_str().is_some());
    assert!(process["cpuPercent"].as_f64().unwrap().is_finite());
    assert!(process["memBytes"].as_u64().is_some());

    server.abort();
}

#[tokio::test]
async fn multiple_sysmon_clients_receive_updates() {
    let root = TempDir::new().unwrap();
    let (url, server) = start_server(root.path()).await;
    let (mut first, _) = connect_async(&url).await.unwrap();
    let (mut second, _) = connect_async(&url).await.unwrap();

    assert_eq!(next_stats(&mut first).await["type"], "stats");
    assert_eq!(next_stats(&mut second).await["type"], "stats");

    server.abort();
}
