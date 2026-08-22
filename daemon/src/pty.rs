use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex, Weak},
    time::Duration,
};

use axum::{
    Json,
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    http::{HeaderMap, StatusCode, header::ORIGIN},
    response::{IntoResponse, Response},
};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{mpsc, oneshot, watch},
    time::{Instant, MissedTickBehavior, interval},
};
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::{AppState, fs::resolve_watch_dir};

const MIN_DIMENSION: u16 = 1;
const MAX_DIMENSION: u16 = 1_000;
const ATTACH_TIMEOUT: Duration = Duration::from_secs(30);
const PING_INTERVAL: Duration = Duration::from_secs(15);
const PONG_TIMEOUT: Duration = Duration::from_secs(10);
const POLICY_ERROR: u16 = 1008;
const ALLOWED_ORIGINS: [&str; 2] = ["http://tauri.localhost", "http://localhost:1420"];

type PtyWriter = Arc<Mutex<Box<dyn Write + Send>>>;
type PtyMaster = Arc<Mutex<Box<dyn MasterPty + Send>>>;

#[derive(Clone)]
pub(crate) struct SessionManager {
    inner: Arc<Mutex<HashMap<Uuid, PtySession>>>,
    shutdown: watch::Sender<bool>,
}

impl SessionManager {
    pub(crate) fn new() -> Self {
        let (shutdown, _) = watch::channel(false);
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            shutdown,
        }
    }

    pub(crate) fn shutdown(&self) {
        let _ = self.shutdown.send(true);
        self.inner.lock().expect("PTY session map poisoned").clear();
    }

    fn subscribe_shutdown(&self) -> watch::Receiver<bool> {
        self.shutdown.subscribe()
    }

    fn insert(&self, id: Uuid, session: PtySession) {
        self.inner
            .lock()
            .expect("PTY session map poisoned")
            .insert(id, session);
        let sessions = Arc::downgrade(&self.inner);
        tokio::spawn(async move {
            tokio::time::sleep(ATTACH_TIMEOUT).await;
            remove_expired(sessions, id);
        });
    }

    fn attach(&self, id: Uuid) -> Option<PtySession> {
        self.inner
            .lock()
            .expect("PTY session map poisoned")
            .remove(&id)
    }
}

impl Drop for SessionManager {
    fn drop(&mut self) {
        if Arc::strong_count(&self.inner) == 1 {
            self.inner.lock().expect("PTY session map poisoned").clear();
        }
    }
}

fn remove_expired(sessions: Weak<Mutex<HashMap<Uuid, PtySession>>>, id: Uuid) {
    let Some(sessions) = sessions.upgrade() else {
        return;
    };
    if sessions
        .lock()
        .expect("PTY session map poisoned")
        .remove(&id)
        .is_some()
    {
        info!(session_id = %id, "expired unattached PTY session");
    }
}

struct PtySession {
    master: PtyMaster,
    writer: PtyWriter,
    output: mpsc::UnboundedReceiver<Vec<u8>>,
    exit: oneshot::Receiver<u32>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl Drop for PtySession {
    fn drop(&mut self) {
        if let Ok(mut killer) = self.killer.lock()
            && let Err(error) = killer.kill()
        {
            debug!(%error, "PTY child was already stopped");
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SpawnRequest {
    cwd: Option<String>,
    cols: u16,
    rows: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpawnResponse {
    session_id: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum ClientControl {
    Resize { cols: u16, rows: u16 },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ServerControl {
    Exit { code: u32 },
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

pub(crate) struct PtyError {
    status: StatusCode,
    message: String,
}

impl PtyError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for PtyError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorResponse {
                error: self.message,
            }),
        )
            .into_response()
    }
}

pub(crate) async fn spawn(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<SpawnRequest>,
) -> Result<Json<SpawnResponse>, PtyError> {
    validate_origin(&headers)?;
    validate_dimensions(request.cols, request.rows)?;

    let (cwd, cwd_handle) = resolve_cwd(&state, request.cwd).await?;
    let session = tokio::task::spawn_blocking(move || {
        create_session(cwd, cwd_handle, request.cols, request.rows)
    })
    .await
    .map_err(|error| PtyError::internal(format!("PTY startup task failed: {error}")))??;
    let id = Uuid::new_v4();
    state.pty.insert(id, session);
    info!(session_id = %id, "spawned PTY session");
    Ok(Json(SpawnResponse {
        session_id: id.to_string(),
    }))
}

pub(crate) async fn upgrade(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Result<Response, PtyError> {
    validate_origin(&headers)?;
    let id =
        Uuid::parse_str(&session_id).map_err(|_| PtyError::not_found("PTY session not found"))?;
    let shutdown = state.pty.subscribe_shutdown();
    let session = state
        .pty
        .attach(id)
        .ok_or_else(|| PtyError::not_found("PTY session not found"))?;
    Ok(upgrade.on_upgrade(move |socket| bridge(socket, id, session, shutdown)))
}

fn validate_origin(headers: &HeaderMap) -> Result<(), PtyError> {
    let origin = headers
        .get(ORIGIN)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| PtyError::forbidden("PTY requests require an approved Origin"))?;
    if ALLOWED_ORIGINS.contains(&origin) {
        Ok(())
    } else {
        Err(PtyError::forbidden("Origin is not allowed for PTY access"))
    }
}

fn validate_dimensions(cols: u16, rows: u16) -> Result<(), PtyError> {
    if (MIN_DIMENSION..=MAX_DIMENSION).contains(&cols)
        && (MIN_DIMENSION..=MAX_DIMENSION).contains(&rows)
    {
        Ok(())
    } else {
        Err(PtyError::bad_request(
            "cols and rows must be between 1 and 1000",
        ))
    }
}

async fn resolve_cwd(
    state: &AppState,
    requested: Option<String>,
) -> Result<(String, std::fs::File), PtyError> {
    use std::os::fd::AsRawFd;

    let requested = requested.unwrap_or_else(|| ".".to_owned());
    let (handle, _) = resolve_watch_dir(state, &requested)
        .await
        .map_err(|error| PtyError::bad_request(error.message()))?;
    let path = format!("/proc/self/fd/{}", handle.as_raw_fd());
    Ok((path, handle))
}

fn create_session(
    cwd: String,
    cwd_handle: std::fs::File,
    cols: u16,
    rows: u16,
) -> Result<PtySession, PtyError> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| PtyError::internal(format!("failed to open PTY: {error}")))?;
    let mut command = CommandBuilder::new("bash");
    command.cwd(cwd);
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| PtyError::internal(format!("failed to spawn shell: {error}")))?;
    drop(cwd_handle);
    drop(pair.slave);

    let killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| PtyError::internal(format!("failed to open PTY output: {error}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| PtyError::internal(format!("failed to open PTY input: {error}")))?;
    let master = Arc::new(Mutex::new(pair.master));
    let writer = Arc::new(Mutex::new(writer));
    let (output_tx, output_rx) = mpsc::unbounded_channel();
    let (exit_tx, exit_rx) = oneshot::channel();

    std::thread::spawn(move || {
        let mut buffer = vec![0; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    if output_tx.send(buffer[..length].to_vec()).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    debug!(%error, "PTY output reader stopped");
                    break;
                }
            }
        }
    });
    std::thread::spawn(move || match child.wait() {
        Ok(status) => {
            let _ = exit_tx.send(status.exit_code());
        }
        Err(error) => warn!(%error, "failed to wait for PTY child"),
    });

    Ok(PtySession {
        master,
        writer,
        output: output_rx,
        exit: exit_rx,
        killer: Mutex::new(killer),
    })
}

async fn bridge(
    mut socket: WebSocket,
    id: Uuid,
    mut session: PtySession,
    mut shutdown: watch::Receiver<bool>,
) {
    info!(session_id = %id, "attached PTY websocket");
    let mut heartbeat = interval(PING_INTERVAL);
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    heartbeat.tick().await;
    let mut pong_deadline: Option<Instant> = None;
    let mut exit_code = None;

    loop {
        if exit_code.is_some() && session.output.is_closed() && session.output.is_empty() {
            break;
        }
        tokio::select! {
            output = session.output.recv() => {
                if let Some(bytes) = output
                    && socket.send(Message::Binary(bytes.into())).await.is_err()
                {
                    break;
                }
            }
            result = &mut session.exit, if exit_code.is_none() => {
                exit_code = result.ok();
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Binary(bytes))) => {
                        if write_input(session.writer.clone(), bytes.to_vec()).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        let control = serde_json::from_str::<ClientControl>(&text);
                        match control {
                            Ok(ClientControl::Resize { cols, rows }) if validate_dimensions(cols, rows).is_ok() => {
                                if resize(session.master.clone(), cols, rows).await.is_err() {
                                    break;
                                }
                            }
                            _ => {
                                close_policy_error(&mut socket, "invalid PTY control message").await;
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Pong(_))) => pong_deadline = None,
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() { break; }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(error)) => { debug!(session_id = %id, %error, "PTY websocket disconnected"); break; }
                }
            }
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    let _ = socket.send(Message::Close(Some(CloseFrame { code: 1001, reason: "daemon shutting down".into() }))).await;
                    break;
                }
            }
            _ = heartbeat.tick() => {
                if pong_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                    close_policy_error(&mut socket, "PTY heartbeat timeout").await;
                    break;
                }
                if pong_deadline.is_none() {
                    if socket.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
                    pong_deadline = Some(Instant::now() + PONG_TIMEOUT);
                }
            }
            () = wait_for_deadline(pong_deadline), if pong_deadline.is_some() => {
                close_policy_error(&mut socket, "PTY heartbeat timeout").await;
                break;
            }
        }
    }

    if let Some(code) = exit_code {
        if let Ok(payload) = serde_json::to_string(&ServerControl::Exit { code }) {
            let _ = socket.send(Message::Text(payload.into())).await;
        }
        let _ = socket
            .send(Message::Close(Some(CloseFrame {
                code: 1000,
                reason: "process exited".into(),
            })))
            .await;
    }
    info!(session_id = %id, "closed PTY session");
}

async fn write_input(writer: PtyWriter, bytes: Vec<u8>) -> Result<(), ()> {
    tokio::task::spawn_blocking(move || {
        writer
            .lock()
            .map_err(|_| ())?
            .write_all(&bytes)
            .map_err(|_| ())
    })
    .await
    .map_err(|_| ())?
}

async fn resize(master: PtyMaster, cols: u16, rows: u16) -> Result<(), ()> {
    tokio::task::spawn_blocking(move || {
        master
            .lock()
            .map_err(|_| ())?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|_| ())
    })
    .await
    .map_err(|_| ())?
}

async fn close_policy_error(socket: &mut WebSocket, reason: &'static str) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code: POLICY_ERROR,
            reason: reason.into(),
        })))
        .await;
}

async fn wait_for_deadline(deadline: Option<Instant>) {
    if let Some(deadline) = deadline {
        tokio::time::sleep_until(deadline).await;
    }
}
