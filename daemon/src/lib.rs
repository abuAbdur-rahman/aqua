mod fs;
mod pty;
mod search;
mod state;
mod sysmon;
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
        DefaultBodyLimit, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
    routing::{get, post, put},
};
use rustix::fs::{OFlags, ResolveFlags, openat2};
use serde::Serialize;
use tower::{ServiceBuilder, limit::ConcurrencyLimitLayer};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing::{debug, warn};

#[derive(Clone)]
pub(crate) struct AppState {
    version: Arc<str>,
    fs_root: Arc<Path>,
    fs_root_fd: Arc<std::fs::File>,
    pub(crate) pty: pty::SessionManager,
    pub(crate) sysmon: sysmon::Manager,
    pub(crate) search: search::Manager,
    pub(crate) state: state::Store,
}

#[derive(Clone)]
pub struct DaemonShutdown {
    pty: pty::SessionManager,
    sysmon: sysmon::Manager,
    search: search::Manager,
}

impl DaemonShutdown {
    pub fn shutdown(&self) {
        self.pty.shutdown();
        self.sysmon.shutdown();
        self.search.shutdown();
    }
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: String,
}

pub const DAEMON_PORT: u16 = 61_234;
const MAX_HTTP_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_ECHO_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_WATCH_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_SYSMON_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_CONCURRENT_REQUESTS: usize = 128;

pub fn daemon_addr() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], DAEMON_PORT))
}

pub fn router() -> Router {
    let home = env::var_os("HOME").expect("HOME must be set for filesystem access");
    let root = std::fs::canonicalize(home).expect("HOME must reference an existing directory");
    build_router(root, false, true).0
}

pub fn router_with_shutdown() -> (Router, DaemonShutdown) {
    let home = env::var_os("HOME").expect("HOME must be set for filesystem access");
    let root = std::fs::canonicalize(home).expect("HOME must reference an existing directory");
    build_router(root, true, true)
}

pub fn router_with_fs_root(root: PathBuf) -> Router {
    router_with_fs_root_and_shutdown(root).0
}

pub fn router_with_fs_root_and_shutdown(root: PathBuf) -> (Router, DaemonShutdown) {
    build_router(root, false, false)
}

fn build_router(
    root: PathBuf,
    start_indexer: bool,
    persistent_state: bool,
) -> (Router, DaemonShutdown) {
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
    let pty = pty::SessionManager::new();
    let sysmon = sysmon::Manager::new();
    let search = search::Manager::new(root.clone(), start_indexer);
    let state_store = if persistent_state {
        state::Store::open_default(&root).expect("state database must be available")
    } else {
        state::Store::in_memory().expect("in-memory state database must be available")
    };
    let state = AppState {
        version: Arc::from(env!("CARGO_PKG_VERSION")),
        fs_root: Arc::from(root),
        fs_root_fd: Arc::new(fs_root_fd),
        pty: pty.clone(),
        sysmon: sysmon.clone(),
        search: search.clone(),
        state: state_store,
    };
    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/fs/list", get(fs::list))
        .route("/api/fs/read", get(fs::read))
        .route("/api/fs/op", post(fs::operate))
        .route("/api/fs/write", put(fs::write))
        .route("/api/search", get(search::query))
        .route("/api/state/layout", get(state_layout).put(state_layout_put))
        .route("/api/pty/spawn", post(pty::spawn))
        .route("/ws/pty/{session_id}", get(pty::upgrade))
        .route("/ws/sysmon", get(sysmon::upgrade))
        .route("/ws/fs-watch", get(watch_upgrade))
        .route("/ws/echo", get(echo_upgrade))
        .layer(DefaultBodyLimit::max(MAX_HTTP_BODY_BYTES))
        .layer(ServiceBuilder::new().layer(ConcurrencyLimitLayer::new(MAX_CONCURRENT_REQUESTS)))
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list([
                    "http://tauri.localhost"
                        .parse()
                        .expect("valid packaged Origin"),
                    "http://localhost:1420"
                        .parse()
                        .expect("valid development Origin"),
                ]))
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PUT,
                ])
                .allow_headers([axum::http::header::CONTENT_TYPE]),
        )
        .with_state(state);
    (
        router,
        DaemonShutdown {
            pty,
            sysmon,
            search,
        },
    )
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: state.version.to_string(),
    })
}

async fn state_layout(
    State(state): State<AppState>,
) -> Result<Json<state::LayoutState>, StateResponseError> {
    state
        .state
        .get_layout()
        .map(Json)
        .map_err(StateResponseError)
}

async fn state_layout_put(
    State(state): State<AppState>,
    Json(layout): Json<state::LayoutState>,
) -> Result<Json<serde_json::Value>, StateResponseError> {
    state
        .state
        .replace_layout(&layout)
        .map_err(StateResponseError)?;
    Ok(Json(serde_json::json!({"success": true})))
}

struct StateResponseError(state::StateError);

impl axum::response::IntoResponse for StateResponseError {
    fn into_response(self) -> Response {
        let (status, error) = match self.0 {
            state::StateError::Invalid(error) => (axum::http::StatusCode::BAD_REQUEST, error),
            state::StateError::Storage(error) => {
                tracing::error!(%error, "state storage request failed");
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "state storage unavailable".into(),
                )
            }
        };
        (
            status,
            Json(serde_json::json!({"success": false, "error": error})),
        )
            .into_response()
    }
}

async fn watch_upgrade(State(state): State<AppState>, upgrade: WebSocketUpgrade) -> Response {
    upgrade
        .max_message_size(MAX_WATCH_MESSAGE_BYTES)
        .max_frame_size(MAX_WATCH_MESSAGE_BYTES)
        .on_upgrade(move |socket| watch::socket(socket, state))
}

async fn echo_upgrade(upgrade: WebSocketUpgrade) -> Response {
    upgrade
        .max_message_size(MAX_ECHO_MESSAGE_BYTES)
        .max_frame_size(MAX_ECHO_MESSAGE_BYTES)
        .on_upgrade(echo_socket)
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
