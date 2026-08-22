use std::time::Duration;

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
}

impl Manager {
    pub(crate) fn new() -> Self {
        let (updates, _) = broadcast::channel(CHANNEL_CAPACITY);
        let (shutdown, mut shutdown_rx) = watch::channel(false);
        let sender = updates.clone();
        tokio::spawn(async move {
            let mut ticker = interval(POLL_INTERVAL);
            ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
            let mut system = System::new_all();
            let mut disks = Disks::new_with_refreshed_list();
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        system.refresh_all();
                        disks.refresh(true);
                        let _ = sender.send(collect_stats(&system, &disks));
                    }
                    result = shutdown_rx.changed() => {
                        if result.is_err() || *shutdown_rx.borrow() {
                            break;
                        }
                    }
                }
            }
        });
        Self { updates, shutdown }
    }

    pub(crate) fn subscribe(&self) -> broadcast::Receiver<Stats> {
        self.updates.subscribe()
    }

    pub(crate) fn shutdown(&self) {
        let _ = self.shutdown.send(true);
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
    upgrade.on_upgrade(move |socket| socket_loop(socket, receiver))
}

async fn socket_loop(mut socket: WebSocket, mut receiver: broadcast::Receiver<Stats>) {
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
