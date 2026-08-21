// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Manager, WindowEvent};
use thiserror::Error;
use tokio::time::sleep;

#[derive(Debug, Error)]
enum DaemonError {
    #[error("WSL not available: {0}")]
    WslUnavailable(String),
    #[error("Failed to spawn daemon: {0}")]
    SpawnFailed(String),
    #[error("Health check failed: {0}")]
    HealthFailed(String),
    #[error("Timeout waiting for daemon")]
    Timeout,
}

async fn discover_default_distro() -> Result<String, DaemonError> {
    let output = Command::new("wsl.exe")
        .args(["-l", "-v"])
        .output()
        .map_err(|e| DaemonError::WslUnavailable(e.to_string()))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let distro = stdout
        .lines()
        .find(|l| l.contains('*'))
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("Ubuntu")
        .trim()
        .to_string();

    Ok(distro)
}

async fn spawn_daemon(distro: &str) -> Result<(), DaemonError> {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let daemon_path = format!("{}/projects/aqua/daemon", home).replace('\\', "/");

    Command::new("wsl.exe")
        .args(["-d", distro, "--", "cargo", "run", "--manifest-path", &format!("{}/Cargo.toml", daemon_path)])
        .spawn()
        .map_err(|e| DaemonError::SpawnFailed(e.to_string()))?;

    Ok(())
}

async fn wait_for_health(_app: AppHandle, max_retries: u32, interval_ms: u64) -> Result<(), DaemonError> {
    let client = reqwest::Client::new();
    for _ in 0..max_retries {
        match client.get("http://localhost:61234/api/health").send().await {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            _ => sleep(Duration::from_millis(interval_ms)).await,
        }
    }
    Err(DaemonError::Timeout)
}

async fn setup_daemon(app: AppHandle) -> Result<(), DaemonError> {
    let distro = discover_default_distro().await?;

    if wait_for_health(app.clone(), 1, 0).await.is_err() {
        spawn_daemon(&distro).await?;
        wait_for_health(app.clone(), 25, 200).await?;
    }

    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| DaemonError::SpawnFailed(e.to_string()))?;
        window.set_decorations(false).ok();
    }

    Ok(())
}

#[tauri::command]
async fn greet(name: String) -> Result<String, String> {
    Ok(format!("Hello, {}! You've been greeted from Rust!", name))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = setup_daemon(app_handle).await {
                    eprintln!("Daemon setup failed: {}", e);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
