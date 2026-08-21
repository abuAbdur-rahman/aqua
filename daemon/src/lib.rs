use std::{net::SocketAddr, sync::Arc};

use axum::{
    Json, Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
    routing::get,
};
use serde::Serialize;
use tracing::{debug, warn};

#[derive(Clone)]
struct AppState {
    version: Arc<str>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: String,
}

pub const DAEMON_PORT: u16 = 61_234;

pub fn daemon_addr() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], DAEMON_PORT))
}

pub fn router() -> Router {
    let state = AppState {
        version: Arc::from(env!("CARGO_PKG_VERSION")),
    };

    Router::new()
        .route("/api/health", get(health))
        .route("/ws/echo", get(echo_upgrade))
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: state.version.to_string(),
    })
}

async fn echo_upgrade(upgrade: WebSocketUpgrade) -> Response {
    upgrade.on_upgrade(echo_socket)
}

async fn echo_socket(mut socket: WebSocket) {
    while let Some(result) = socket.recv().await {
        let message = match result {
            Ok(message) => message,
            Err(error) => {
                warn!(%error, "websocket receive failed");
                return;
            }
        };

        match message {
            message @ (Message::Text(_) | Message::Binary(_)) => {
                if let Err(error) = socket.send(message).await {
                    debug!(%error, "websocket client disconnected before echo");
                    return;
                }
            }
            Message::Close(frame) => {
                if let Err(error) = socket.send(Message::Close(frame)).await {
                    debug!(%error, "websocket close acknowledgement failed");
                }
                return;
            }
            Message::Ping(_) | Message::Pong(_) => {}
        }
    }
}
