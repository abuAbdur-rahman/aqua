// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use thiserror::Error;
use tokio::time::sleep;

const DAEMON_HEALTH_URL: &str = "http://localhost:61234/api/health";
const DAEMON_SHUTDOWN_URL: &str = "http://localhost:61234/api/system/shutdown";

struct DaemonChild(Mutex<Option<std::process::Child>>);

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

// Resolve the daemon's directory *inside* the distro. Windows and WSL users
// differ, so USERPROFILE-based guesses are wrong; probe known layouts under
// the WSL user's home, with AQUA_DAEMON_DIR as an explicit override.
async fn resolve_daemon_dir(distro: &str) -> Result<String, DaemonError> {
    if let Ok(dir) = std::env::var("AQUA_DAEMON_DIR") {
        if !dir.is_empty() {
            return Ok(dir);
        }
    }

    let who = Command::new("wsl.exe")
        .args(["-d", distro, "--", "whoami"])
        .output()
        .map_err(|e| DaemonError::WslUnavailable(e.to_string()))?;
    let user = String::from_utf8_lossy(&who.stdout).trim().to_string();

    let candidates = [
        format!("/home/{user}/projects/Self/aqua/daemon"),
        format!("/home/{user}/projects/aqua/daemon"),
    ];
    for candidate in candidates {
        let probe = Command::new("wsl.exe")
            .args(["-d", distro, "--", "test", "-d", &candidate])
            .output();
        if probe.map(|o| o.status.success()).unwrap_or(false) {
            return Ok(candidate);
        }
    }

    Err(DaemonError::SpawnFailed(
        "daemon directory not found in distro — set AQUA_DAEMON_DIR to its WSL path".to_string(),
    ))
}

async fn spawn_daemon(distro: &str, dir: &str) -> Result<std::process::Child, DaemonError> {
    Command::new("wsl.exe")
        .args([
            "-d",
            distro,
            "--",
            "cargo",
            "run",
            "--release",
            "--manifest-path",
            &format!("{dir}/Cargo.toml"),
        ])
        .spawn()
        .map_err(|e| DaemonError::SpawnFailed(e.to_string()))
}

async fn wait_for_health(
    _app: AppHandle,
    max_retries: u32,
    interval_ms: u64,
) -> Result<(), DaemonError> {
    let client = reqwest::Client::new();
    for _ in 0..max_retries {
        match client.get(DAEMON_HEALTH_URL).send().await {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            _ => sleep(Duration::from_millis(interval_ms)).await,
        }
    }
    Err(DaemonError::Timeout)
}

// Graceful shutdown per APPEND_V3.md §2: POST /api/system/shutdown first,
// poll for the daemon to go down (~3s), force-kill the host-side child only
// as the fallback. Killing wsl.exe is best-effort — it does not reach
// processes already running inside the distro.
async fn stop_daemon(child_state: &State<'_, DaemonChild>) -> Result<(), String> {
    let client = reqwest::Client::new();
    let _ = client.post(DAEMON_SHUTDOWN_URL).send().await;

    for _ in 0..15 {
        match client.get(DAEMON_HEALTH_URL).send().await {
            Ok(resp) if resp.status().is_success() => sleep(Duration::from_millis(200)).await,
            _ => break,
        }
    }

    if let Some(mut child) = child_state.0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

fn store_child(app: &AppHandle, child: std::process::Child) {
    // If a previous handle was still tracked, don't leak it.
    let state = app.state::<DaemonChild>();
    let mut slot = state.0.lock().unwrap();
    if let Some(mut old) = slot.take() {
        let _ = old.kill();
        let _ = old.wait();
    }
    *slot = Some(child);
}

// The window starts hidden (visible: false in tauri.conf.json) and must be
// shown no matter how daemon startup ends — a failed health check still gets
// the desktop UI with its "Daemon offline" indicator, never an invisible app.
async fn setup_daemon(app: AppHandle) -> Result<(), DaemonError> {
    let result = start_daemon(&app).await;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_decorations(false);
    }

    result
}

async fn start_daemon(app: &AppHandle) -> Result<(), DaemonError> {
    let distro = discover_default_distro().await?;

    if wait_for_health(app.clone(), 1, 0).await.is_err() {
        let dir = resolve_daemon_dir(&distro).await?;
        let child = spawn_daemon(&distro, &dir).await?;
        store_child(app, child);
        wait_for_health(app.clone(), 25, 200).await?;
    }

    Ok(())
}

#[tauri::command]
async fn restart_daemon(app: AppHandle) -> Result<(), String> {
    stop_daemon(&app.state::<DaemonChild>()).await?;
    let distro = discover_default_distro().await.map_err(|e| e.to_string())?;
    let dir = resolve_daemon_dir(&distro)
        .await
        .map_err(|e| e.to_string())?;
    // cargo may recompile after a daemon-side change, so allow a longer
    // health window than first launch.
    let child = spawn_daemon(&distro, &dir)
        .await
        .map_err(|e| e.to_string())?;
    store_child(&app, child);
    wait_for_health(app.clone(), 100, 200)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn relaunch_aqua(app: AppHandle) -> Result<(), String> {
    stop_daemon(&app.state::<DaemonChild>()).await?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Command::new(exe).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn quit_and_stop_daemon(app: AppHandle) -> Result<(), String> {
    stop_daemon(&app.state::<DaemonChild>()).await?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn get_distro() -> Result<String, String> {
    discover_default_distro().await.map_err(|e| e.to_string())
}

// Distro-scoped WSL power action (app/PLAN.md §4 "Power actions"): terminate
// the one distro Aqua depends on, then re-run the normal startup sequence.
// `wsl --shutdown` (whole VM) is deliberately never exposed — see the hard
// rule in app/AGENTS.md. Reachable only from Settings → Daemon pane, always
// behind a confirmation modal naming this resolved distro.
#[tauri::command]
async fn restart_wsl_distro(app: AppHandle) -> Result<(), String> {
    stop_daemon(&app.state::<DaemonChild>()).await?;
    let distro = discover_default_distro().await.map_err(|e| e.to_string())?;
    let output = Command::new("wsl.exe")
        .args(["--terminate", &distro])
        .output()
        .map_err(|e| format!("WSL not available: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "wsl --terminate {} failed: {}",
            distro,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let dir = resolve_daemon_dir(&distro)
        .await
        .map_err(|e| e.to_string())?;
    // Fresh distro boot means cargo may recompile; use the long health window.
    let child = spawn_daemon(&distro, &dir)
        .await
        .map_err(|e| e.to_string())?;
    store_child(&app, child);
    wait_for_health(app.clone(), 100, 200)
        .await
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct PickedImage {
    name: String,
    // Base64 over the IPC boundary: a `Vec<u8>` field serializes as a JSON
    // array of numbers, which `new Blob([..])` stringifies into garbage the
    // daemon can't decode. Base64 keeps the bytes intact end to end.
    data_base64: String,
}

// Native OS file picker for wallpaper uploads (multi-select — Settings allows
// batch adds). OS-integration glue on purpose: the WebView never browses the
// host filesystem itself, it only receives the files the user explicitly
// picked in a real Windows dialog.
#[tauri::command]
async fn pick_images() -> Result<Vec<PickedImage>, String> {
    let files = rfd::AsyncFileDialog::new()
        .set_title("Choose images")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .pick_files()
        .await
        .unwrap_or_default();

    let mut picked = Vec::with_capacity(files.len());
    for file in files {
        let name = file.file_name().to_string();
        let data = file.read().await;
        picked.push(PickedImage {
            name,
            data_base64: base64::encode(data),
        });
    }
    Ok(picked)
}

#[tauri::command]
async fn greet(name: String) -> Result<String, String> {
    Ok(format!("Hello, {}! You've been greeted from Rust!", name))
}

// Translate one Windows path into its WSL drive-mount form:
// C:\Users\dev\x.jpg -> /mnt/c/Users/dev/x.jpg. UNC / network paths have no
// drive-mount equivalent, so they are refused rather than mistranslated.
fn to_wsl_mount(path: &std::path::Path) -> Result<String, ()> {
    let mut components = path.components();
    let drive = match components.next() {
        Some(std::path::Component::Prefix(prefix)) => match prefix.kind() {
            std::path::Prefix::Disk(byte) => (byte as char).to_ascii_lowercase(),
            _ => return Err(()),
        },
        _ => return Err(()),
    };
    let rest = components
        .filter(|c| !matches!(c, std::path::Component::RootDir))
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/");
    Ok(format!("/mnt/{drive}/{rest}"))
}

// Native OS picker for Finder's "Import from Windows..." action (multi-select).
// OS-integration glue on purpose: the host hands back translated WSL-mount
// *paths only* — never bytes — so the actual copy still goes through the
// daemon's fs API like every other file operation.
#[tauri::command]
async fn pick_windows_files() -> Result<Vec<String>, String> {
    let files = rfd::AsyncFileDialog::new()
        .set_title("Import from Windows")
        .pick_files()
        .await
        .unwrap_or_default();

    if files.is_empty() {
        return Ok(Vec::new());
    }

    let mut translated = Vec::with_capacity(files.len());
    for file in files {
        match to_wsl_mount(file.path()) {
            Ok(path) => translated.push(path),
            Err(()) => {
                return Err("Network locations aren't supported for import yet.".to_string());
            }
        }
    }
    Ok(translated)
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "show", "Show Aqua", true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", "Quit Aqua", true, None::<&str>)?,
        ],
    )?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("default window icon must be set");

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Aqua")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            restart_daemon,
            relaunch_aqua,
            quit_and_stop_daemon,
            get_distro,
            pick_images,
            pick_windows_files,
            restart_wsl_distro
        ])
        .manage(DaemonChild(Mutex::new(None)))
        .setup(|app| {
            use std::time::{Duration, Instant};
            // Key autorepeat re-fires the shortcut ~every 30ms while held; a deliberate
            // second press is never within 300ms of the previous one. Latch collapses
            // autorepeat bursts into a single toggle so the palette can't flicker shut.
            let last_toggle = Mutex::new(Instant::now() - Duration::from_millis(1000));
            // A stale registration (e.g. a lingering previous dev instance still
            // holding Ctrl+Shift+Space) must not take the whole app down —
            // degrade to "no global shortcut" instead of panicking in setup.
            if let Err(e) = app.global_shortcut().on_shortcut(
                "Ctrl+Shift+Space",
                move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let mut last = last_toggle.lock().unwrap();
                        if last.elapsed() < Duration::from_millis(300) {
                            return;
                        }
                        *last = Instant::now();
                        drop(last);
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("spotlight-toggle", ());
                        }
                    }
                },
            ) {
                eprintln!("Global shortcut unavailable: {}", e);
            }
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = setup_daemon(app_handle).await {
                    eprintln!("Daemon setup failed: {}", e);
                }
            });
            if let Err(e) = build_tray(app.handle()) {
                eprintln!("Tray setup failed: {}", e);
            }
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
