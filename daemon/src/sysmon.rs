use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
};
use serde::Serialize;
use sysinfo::{Disks, System};
use tokio::{
    sync::{broadcast, watch},
    time::{MissedTickBehavior, interval},
};

use crate::AppState;

const POLL_INTERVAL: Duration = Duration::from_secs(1);
const CHANNEL_CAPACITY: usize = 4;

#[derive(Clone)]
pub(crate) struct Manager {
    updates: broadcast::Sender<Stats>,
    shutdown: watch::Sender<bool>,
    active_clients: Arc<AtomicUsize>,
    active: watch::Sender<bool>,
}

impl Manager {
    pub(crate) fn new() -> Self {
        let (updates, _) = broadcast::channel(CHANNEL_CAPACITY);
        let (shutdown, mut shutdown_rx) = watch::channel(false);
        let (active, mut active_rx) = watch::channel(false);
        let active_clients = Arc::new(AtomicUsize::new(0));
        let sender = updates.clone();
        tokio::spawn(async move {
            let mut ticker = interval(POLL_INTERVAL);
            ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
            let mut system = None;
            let mut disks = None;
            loop {
                if !*active_rx.borrow() {
                    tokio::select! {
                        result = active_rx.changed() => {
                            if result.is_err() { break; }
                        }
                        result = shutdown_rx.changed() => {
                            if result.is_err() || *shutdown_rx.borrow() { break; }
                        }
                    }
                    continue;
                }
                let system = system.get_or_insert_with(System::new_all);
                let disks = disks.get_or_insert_with(Disks::new_with_refreshed_list);
                tokio::select! {
                    _ = ticker.tick() => {
                        system.refresh_all();
                        disks.refresh(true);
                        let _ = sender.send(collect_stats(system, disks));
                    }
                    result = active_rx.changed() => {
                        if result.is_err() { break; }
                    }
                    result = shutdown_rx.changed() => {
                        if result.is_err() || *shutdown_rx.borrow() {
                            break;
                        }
                    }
                }
            }
        });
        Self {
            updates,
            shutdown,
            active_clients,
            active,
        }
    }

    pub(crate) fn subscribe(&self) -> Subscription {
        let clients = self.active_clients.fetch_add(1, Ordering::AcqRel) + 1;
        if clients == 1 {
            let _ = self.active.send(true);
        }
        Subscription {
            receiver: self.updates.subscribe(),
            manager: self.clone(),
        }
    }

    fn disconnect(&self) {
        let previous = self.active_clients.fetch_sub(1, Ordering::AcqRel);
        if previous == 1 {
            let _ = self.active.send(false);
        }
    }

    pub(crate) fn shutdown(&self) {
        let _ = self.shutdown.send(true);
    }
}

pub(crate) struct Subscription {
    receiver: broadcast::Receiver<Stats>,
    manager: Manager,
}

impl Subscription {
    async fn recv(&mut self) -> Result<Stats, broadcast::error::RecvError> {
        self.receiver.recv().await
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        self.manager.disconnect();
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Stats {
    #[serde(rename = "type")]
    message_type: &'static str,
    cpu_percent: f32,
    mem_used: u64,
    mem_total: u64,
    disks: Vec<DiskStat>,
    processes: Vec<ProcessStat>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskStat {
    mount: String,
    used: u64,
    total: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessStat {
    pid: u32,
    name: String,
    cpu_percent: f32,
    mem_bytes: u64,
}

fn collect_stats(system: &System, disks: &Disks) -> Stats {
    let mut processes: Vec<_> = system
        .processes()
        .values()
        .map(|process| ProcessStat {
            pid: process.pid().as_u32(),
            name: process.name().to_string_lossy().into_owned(),
            cpu_percent: process.cpu_usage(),
            mem_bytes: process.memory(),
        })
        .collect();
    processes.sort_by_key(|process| process.pid);

    Stats {
        message_type: "stats",
        cpu_percent: system.global_cpu_usage(),
        mem_used: system.used_memory(),
        mem_total: system.total_memory(),
        disks: disks
            .list()
            .iter()
            .map(|disk| DiskStat {
                mount: disk.mount_point().to_string_lossy().into_owned(),
                used: disk.total_space().saturating_sub(disk.available_space()),
                total: disk.total_space(),
            })
            .collect(),
        processes,
    }
}

pub(crate) async fn upgrade(State(state): State<AppState>, upgrade: WebSocketUpgrade) -> Response {
    let receiver = state.sysmon.subscribe();
    upgrade
        .max_message_size(crate::MAX_SYSMON_MESSAGE_BYTES)
        .max_frame_size(crate::MAX_SYSMON_MESSAGE_BYTES)
        .on_upgrade(move |socket| socket_loop(socket, receiver))
}

async fn socket_loop(mut socket: WebSocket, mut receiver: Subscription) {
    loop {
        tokio::select! {
            result = receiver.recv() => {
                let Ok(stats) = result else { continue };
                let Ok(payload) = serde_json::to_string(&stats) else { return };
                if socket.send(Message::Text(payload.into())).await.is_err() {
                    return;
                }
            }
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() { return; }
                    }
                    Some(Ok(Message::Pong(_))) | Some(Ok(Message::Text(_))) | Some(Ok(Message::Binary(_))) => {}
                }
            }
        }
    }
}
