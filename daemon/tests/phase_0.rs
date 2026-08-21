use std::net::SocketAddr;

use aqua_daemon::{DAEMON_PORT, daemon_addr, router};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use futures_util::{SinkExt, StreamExt};
use http_body_util::BodyExt;
use serde_json::json;
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tower::ServiceExt;

#[tokio::test]
async fn health_matches_the_contract() {
    let response = router()
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .expect("health request should be valid"),
        )
        .await
        .expect("health handler should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "application/json");

    let body = response
        .into_body()
        .collect()
        .await
        .expect("health body should be readable")
        .to_bytes();
    let payload: serde_json::Value =
        serde_json::from_slice(&body).expect("health body should be JSON");

    assert_eq!(
        payload,
        json!({
            "status": "ok",
            "version": env!("CARGO_PKG_VERSION")
        })
    );
}

#[test]
fn daemon_uses_the_fixed_loopback_port() {
    assert_eq!(DAEMON_PORT, 61_234);
    assert_eq!(daemon_addr(), SocketAddr::from(([127, 0, 0, 1], 61_234)));
}

#[tokio::test]
async fn websocket_echo_preserves_text_and_binary_frames() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("ephemeral listener should bind");
    let address = listener
        .local_addr()
        .expect("ephemeral listener should have an address");
    let server = tokio::spawn(async move {
        axum::serve(listener, router())
            .await
            .expect("test server should run");
    });

    let (mut socket, _) = connect_async(format!("ws://{address}/ws/echo"))
        .await
        .expect("echo websocket should connect");

    socket
        .send(Message::Text("hello Aqua".into()))
        .await
        .expect("text frame should send");
    assert_eq!(
        socket
            .next()
            .await
            .expect("text echo should arrive")
            .expect("text echo should be valid"),
        Message::Text("hello Aqua".into())
    );

    socket
        .send(Message::Binary(vec![0, 1, 2, 255].into()))
        .await
        .expect("binary frame should send");
    assert_eq!(
        socket
            .next()
            .await
            .expect("binary echo should arrive")
            .expect("binary echo should be valid"),
        Message::Binary(vec![0, 1, 2, 255].into())
    );

    socket.close(None).await.expect("socket should close");
    server.abort();
}
