mod fs;
mod watch;

use std::{
    env,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::{
    Json, Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
    routing::{get, post, put},
};
use rustix::fs::{OFlags, ResolveFlags, openat2};
use serde::Serialize;
use tracing::{debug, warn};

#[derive(Clone)]
pub(crate) struct AppState {
    version: Arc<str>,
    fs_root: Arc<Path>,
    fs_root_fd: Arc<std::fs::File>,
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
    let home = env::var_os("HOME").expect("HOME must be set for filesystem access");
    let root = std::fs::canonicalize(home).expect("HOME must reference an existing directory");
    router_with_fs_root(root)
}

pub fn router_with_fs_root(root: PathBuf) -> Router {
    let root =
        std::fs::canonicalize(root).expect("filesystem root must reference an existing directory");
    let fs_root_fd = openat2(
        std::fs::File::open(&root).expect("filesystem root must be openable"),
        ".",
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
        rustix::fs::Mode::empty(),
        ResolveFlags::BENEATH | ResolveFlags::NO_SYMLINKS,
    )
    .expect("filesystem root must be openable");
    let fs_root_fd = std::fs::File::from(fs_root_fd);
    let state = AppState {
        version: Arc::from(env!("CARGO_PKG_VERSION")),
        fs_root: Arc::from(root),
        fs_root_fd: Arc::new(fs_root_fd),
    };

    Router::new()
        .route("/api/health", get(health))
        .route("/api/fs/list", get(fs::list))
        .route("/api/fs/read", get(fs::read))
        .route("/api/fs/op", post(fs::operate))
        .route("/api/fs/write", put(fs::write))
        .route("/ws/fs-watch", get(watch_upgrade))
        .route("/ws/echo", get(echo_upgrade))
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: state.version.to_string(),
    })
}

async fn watch_upgrade(State(state): State<AppState>, upgrade: WebSocketUpgrade) -> Response {
    upgrade.on_upgrade(move |socket| watch::socket(socket, state))
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
