use std::{
    collections::{HashMap, hash_map::Entry},
    os::fd::AsRawFd,
    path::{Path, PathBuf},
    time::Duration,
};

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use notify::{
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
    event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
};
use serde::{Deserialize, Serialize};
use tokio::{
    sync::mpsc,
    time::{Instant, sleep_until},
};
use tracing::{debug, warn};

use crate::{
    AppState,
    fs::{ApiError, entry_for_watch, resolve_watch_dir},
};

const DEBOUNCE_WINDOW: Duration = Duration::from_millis(150);

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum WatchCommand {
    Subscribe { path: String },
    Unsubscribe { path: String },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WatchEvent {
    r#type: &'static str,
    path: String,
    kind: WatchKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    entry: Option<crate::fs::FsEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
enum WatchKind {
    Created,
    Modified,
    Removed,
    Renamed,
}

struct WatchSubscription {
    _handle: std::fs::File,
    watched_path: PathBuf,
}

pub(crate) async fn socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let mut watcher = match notify::recommended_watcher(move |result| {
        if event_tx.send(result).is_err() {
            debug!("filesystem watcher receiver closed");
        }
    }) {
        Ok(watcher) => watcher,
        Err(error) => {
            warn!(%error, "failed to create filesystem watcher");
            return;
        }
    };
    let mut subscriptions: HashMap<PathBuf, WatchSubscription> = HashMap::new();
    let mut pending: HashMap<String, (Instant, WatchEvent)> = HashMap::new();

    loop {
        let deadline = pending.values().map(|(deadline, _)| *deadline).min();
        tokio::select! {
            message = receiver.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        if let Err(error) = apply_command(&state, &mut watcher, &mut subscriptions, &mut pending, &text).await {
                            let payload = serde_json::json!({ "error": error.message() }).to_string();
                            if sender.send(Message::Text(payload.into())).await.is_err() { return; }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => return,
                    Some(Err(error)) => { debug!(%error, "filesystem watcher client disconnected"); return; }
                    Some(Ok(Message::Binary(_) | Message::Ping(_) | Message::Pong(_))) => {}
                }
            }
            result = event_rx.recv() => {
                match result {
                    Some(Ok(event)) => queue_event(&state, &subscriptions, event, &mut pending).await,
                    Some(Err(error)) => warn!(%error, "filesystem watch failed"),
                    None => return,
                }
            }
            () = wait_for(deadline), if deadline.is_some() => {
                let now = Instant::now();
                let ready: Vec<_> = pending.iter().filter(|(_, (deadline, _))| *deadline <= now).map(|(key, (_, event))| (key.clone(), event.clone())).collect();
                for (key, event) in ready {
                    pending.remove(&key);
                    let payload = match serde_json::to_string(&event) {
                        Ok(payload) => payload,
                        Err(error) => { warn!(%error, "failed to serialize filesystem event"); continue; }
                    };
                    if sender.send(Message::Text(payload.into())).await.is_err() { return; }
                }
            }
        }
    }
}

async fn apply_command(
    state: &AppState,
    watcher: &mut RecommendedWatcher,
    subscriptions: &mut HashMap<PathBuf, WatchSubscription>,
    pending: &mut HashMap<String, (Instant, WatchEvent)>,
    text: &str,
) -> Result<(), ApiError> {
    let command: WatchCommand =
        serde_json::from_str(text).map_err(|_| ApiError::bad_request("invalid watch command"))?;
    match command {
        WatchCommand::Subscribe { path } => {
            let (watch_handle, display_path) = resolve_watch_dir(state, &path).await?;
            if let Entry::Vacant(entry) = subscriptions.entry(display_path) {
                let watched_path =
                    PathBuf::from(format!("/proc/self/fd/{}", watch_handle.as_raw_fd()));
                watcher
                    .watch(&watched_path, RecursiveMode::Recursive)
                    .map_err(ApiError::from_notify)?;
                entry.insert(WatchSubscription {
                    _handle: watch_handle,
                    watched_path,
                });
            }
        }
        WatchCommand::Unsubscribe { path } => {
            let (_, display_path) = resolve_watch_dir(state, &path).await?;
            if let Some(subscription) = subscriptions.get(&display_path) {
                watcher
                    .unwatch(&subscription.watched_path)
                    .map_err(ApiError::from_notify)?;
                subscriptions.remove(&display_path);
                pending.retain(|event_path, _| !Path::new(event_path).starts_with(&display_path));
            }
        }
    }
    Ok(())
}

async fn queue_event(
    state: &AppState,
    subscriptions: &HashMap<PathBuf, WatchSubscription>,
    mut event: Event,
    pending: &mut HashMap<String, (Instant, WatchEvent)>,
) {
    event.paths = event
        .paths
        .into_iter()
        .filter_map(|path| contract_path(subscriptions, &path))
        .collect();
    let mapped = map_event(state, event).await;
    for event in mapped {
        let key = event.path.clone();
        if matches!(event.kind, WatchKind::Modified)
            && pending.values().any(|(_, pending_event)| {
                pending_event.path == event.path && matches!(pending_event.kind, WatchKind::Created)
            })
        {
            continue;
        }
        pending.insert(key, (Instant::now() + DEBOUNCE_WINDOW, event));
    }
}

async fn map_event(state: &AppState, event: Event) -> Vec<WatchEvent> {
    let root = &state.fs_root;
    if matches!(
        event.kind,
        EventKind::Modify(ModifyKind::Name(RenameMode::Both))
    ) && event.paths.len() == 2
    {
        let destination = &event.paths[1];
        if destination.starts_with(root) {
            return vec![WatchEvent {
                r#type: "change",
                path: path_string(destination),
                kind: WatchKind::Renamed,
                entry: entry_for_watch(state, destination.clone()).await,
            }];
        }
        return Vec::new();
    }
    if matches!(
        event.kind,
        EventKind::Modify(ModifyKind::Name(RenameMode::From))
    ) {
        return Vec::new();
    }
    if matches!(
        event.kind,
        EventKind::Modify(ModifyKind::Name(RenameMode::To))
    ) {
        let Some(path) = event.paths.first() else {
            return Vec::new();
        };
        if !path.starts_with(root) {
            return Vec::new();
        }
        return vec![WatchEvent {
            r#type: "change",
            path: path_string(path),
            kind: WatchKind::Renamed,
            entry: entry_for_watch(state, path.clone()).await,
        }];
    }
    let kind = match event.kind {
        EventKind::Create(
            CreateKind::Any | CreateKind::File | CreateKind::Folder | CreateKind::Other,
        ) => WatchKind::Created,
        EventKind::Modify(_) => WatchKind::Modified,
        EventKind::Remove(
            RemoveKind::Any | RemoveKind::File | RemoveKind::Folder | RemoveKind::Other,
        ) => WatchKind::Removed,
        _ => return Vec::new(),
    };
    let mut mapped = Vec::new();
    for path in event.paths {
        if path.starts_with(root) {
            let entry = if matches!(kind, WatchKind::Removed) {
                None
            } else {
                entry_for_watch(state, path.clone()).await
            };
            mapped.push(WatchEvent {
                r#type: "change",
                path: path_string(&path),
                kind: kind.clone(),
                entry,
            });
        }
    }
    mapped
}

fn contract_path(
    subscriptions: &HashMap<PathBuf, WatchSubscription>,
    event_path: &Path,
) -> Option<PathBuf> {
    subscriptions
        .iter()
        .find_map(|(display_path, subscription)| {
            event_path
                .strip_prefix(&subscription.watched_path)
                .ok()
                .map(|relative| display_path.join(relative))
        })
}

async fn wait_for(deadline: Option<Instant>) {
    if let Some(deadline) = deadline {
        sleep_until(deadline).await;
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
