// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use base64::Engine as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use thiserror::Error;
use tokio::time::sleep;

const DAEMON_HEALTH_URL: &str = "http://localhost:61234/api/health";
const DAEMON_SHUTDOWN_URL: &str = "http://localhost:61234/api/system/shutdown";
const DAEMON_SERVICE: &str = "aqua-daemon.service";

// CREATE_NO_WINDOW: wsl.exe is a console subsystem binary, so spawning it
// from a windowed (GUI) parent would flash a terminal window for every
// bridge call (distro discovery, systemctl lifecycle, import/export, copy).
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// Every wsl.exe spawn goes through here so daemon lifecycle and file-bridge
// calls never flash a console window on the user's desktop.
fn wsl_command() -> Command {
    let mut command = Command::new("wsl.exe");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[derive(Debug, Error)]
enum DaemonError {
    #[error("WSL not available: {0}")]
    WslUnavailable(String),
    #[error("Failed to start daemon service: {0}")]
    SpawnFailed(String),
    #[error("Timeout waiting for daemon")]
    Timeout,
}

async fn discover_default_distro() -> Result<String, DaemonError> {
    let output = wsl_command()
        .args(["-l", "-v"])
        .output()
        .map_err(|e| DaemonError::WslUnavailable(e.to_string()))?;

    Ok(parse_default_distro(&decode_wsl_output(&output.stdout)))
}

// wsl.exe -l -v emits UTF-16LE (no BOM) when stdout is redirected. UTF-16LE
// ASCII is also byte-valid UTF-8 (NUL is a legal code point), so "valid
// UTF-8" can't be the discriminator — detect the NUL-padding pattern instead;
// real text output never contains NUL.
fn decode_wsl_output(bytes: &[u8]) -> String {
    if bytes.contains(&0) {
        let (decoded, _, had_errors) = encoding_rs::UTF_16LE.decode(bytes);
        if had_errors {
            String::from_utf8_lossy(bytes).into_owned()
        } else {
            decoded.into_owned()
        }
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

// The `*` marks the default distro in `wsl -l -v`; its name is the second column.
fn parse_default_distro(stdout: &str) -> String {
    stdout
        .lines()
        .find(|l| l.contains('*'))
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("Ubuntu")
        .trim()
        .to_string()
}

// Resolve the daemon's directory *inside* the distro. Kept only for
// diagnostics / Settings display — never touched by the spawn/start/restart
// hot paths (daemon is now a systemd --user service, see
// daemon/deploy/README.md). Probe known layouts under the WSL user's home
// with AQUA_DAEMON_DIR as explicit override.
async fn resolve_daemon_dir(distro: &str) -> Result<String, DaemonError> {
    if let Ok(dir) = std::env::var("AQUA_DAEMON_DIR") {
        if !dir.is_empty() {
            return Ok(dir);
        }
    }

    let who = wsl_command()
        .args(["-d", distro, "--", "whoami"])
        .output()
        .map_err(|e| DaemonError::WslUnavailable(e.to_string()))?;
    let user = String::from_utf8_lossy(&who.stdout).trim().to_string();

    let candidates = [
        format!("/home/{user}/projects/Self/aqua/daemon"),
        format!("/home/{user}/projects/aqua/daemon"),
    ];
    for candidate in candidates {
        let probe = wsl_command()
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

// Diagnostic probe — exposes resolve_daemon_dir for Settings/About without
// involving the service lifecycle. Not used by start/restart paths.
#[tauri::command]
async fn get_daemon_dir() -> Result<String, String> {
    let distro = discover_default_distro().await.map_err(|e| e.to_string())?;
    resolve_daemon_dir(&distro).await.map_err(|e| e.to_string())
}

async fn systemctl_action(distro: &str, action: &str) -> Result<(), DaemonError> {
    let output = wsl_command()
        .args([
            "-d",
            distro,
            "--",
            "systemctl",
            "--user",
            action,
            DAEMON_SERVICE,
        ])
        .output()
        .map_err(|e| DaemonError::WslUnavailable(e.to_string()))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(DaemonError::SpawnFailed(format!(
            "systemctl --user {action} {DAEMON_SERVICE} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
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

// Explicit "Stop backend" — graceful POST first, fallback to systemctl stop.
// NOT used by normal quit; only by the dedicated Stop action (future tray
// item). Never does a host-side process kill; systemd owns the process.
async fn stop_daemon_service(distro: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let _ = client.post(DAEMON_SHUTDOWN_URL).send().await;

    for _ in 0..15 {
        match client.get(DAEMON_HEALTH_URL).send().await {
            Ok(resp) if resp.status().is_success() => sleep(Duration::from_millis(200)).await,
            _ => return Ok(()),
        }
    }

    // Still up after ~3s — let systemd stop it (no host-side kill).
    systemctl_action(distro, "stop")
        .await
        .map_err(|e| e.to_string())
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
        systemctl_action(&distro, "start").await?;
        wait_for_health(app.clone(), 25, 200).await?;
    }

    Ok(())
}

#[tauri::command]
async fn restart_daemon(app: AppHandle) -> Result<(), String> {
    let distro = discover_default_distro().await.map_err(|e| e.to_string())?;
    systemctl_action(&distro, "restart")
        .await
        .map_err(|e| e.to_string())?;
    wait_for_health(app.clone(), 25, 200)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn relaunch_aqua(app: AppHandle) -> Result<(), String> {
    // Relaunch leaves the daemon service running — the new instance's
    // health-first guard will find it already up.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Command::new(exe).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn quit_and_stop_daemon(app: AppHandle) -> Result<(), String> {
    // Quit Aqua — leave the daemon service running (persistent systemd user
    // service with linger). Do NOT invoke stop_daemon_service here; that
    // accidental coupling was the bug this migration fixes. Explicit stop is
    // the separate `stop_daemon` command.
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn stop_daemon(app: AppHandle) -> Result<(), String> {
    let distro = discover_default_distro().await.map_err(|e| e.to_string())?;
    stop_daemon_service(&distro).await?;
    // Keep health poll consistent with start path — caller can verify down.
    let _ = app;
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
    let distro = discover_default_distro().await.map_err(|e| e.to_string())?;
    let output = wsl_command()
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
    systemctl_action(&distro, "start")
        .await
        .map_err(|e| e.to_string())?;
    wait_for_health(app.clone(), 25, 200)
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
            data_base64: base64::engine::general_purpose::STANDARD.encode(data),
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

// Native destination picker for Finder's "Export to Windows..." (WSL ->
// Windows). Copy through WSL directly so large/binary files are not constrained
// by the daemon's preview-oriented fs/read response.
#[tauri::command]
async fn export_to_windows(
    source_path: String,
    file_name: String,
    is_directory: bool,
) -> Result<Option<String>, String> {
    let target = if is_directory {
        rfd::AsyncFileDialog::new()
            .set_title("Choose Windows destination")
            .pick_folder()
            .await
            .map(|folder| folder.path().join(&file_name))
    } else {
        rfd::AsyncFileDialog::new()
            .set_file_name(&file_name)
            .set_title("Export to Windows")
            .save_file()
            .await
            .map(|file| file.path().to_path_buf())
    };

    let Some(target) = target else {
        return Ok(None);
    };
    let target_wsl = to_wsl_mount(&target)
        .map_err(|()| "Network locations aren't supported for export yet.".to_string())?;
    let distro = discover_default_distro().await.map_err(|e| e.to_string())?;

    let mut command = wsl_command();
    command.args(["-d", &distro, "--cd", "~", "--", "cp"]);
    if is_directory {
        command.arg("-r");
    }
    let output = command
        .args([&source_path, &target_wsl])
        .output()
        .map_err(|e| format!("WSL not available: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Export failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(Some(target.to_string_lossy().to_string()))
}

// Copy a user-selected Windows path into the Finder's WSL destination. The
// daemon intentionally rejects /mnt/c paths as outside its data root, so this
// explicit Windows->WSL bridge runs through wsl.exe instead of the fs API.
#[tauri::command]
async fn import_from_windows(source_path: String, destination_path: String) -> Result<(), String> {
    if !source_path.starts_with("/mnt/") || source_path.contains('\0') {
        return Err("Invalid Windows source path".to_string());
    }
    if destination_path.contains('\0') || destination_path.split('/').any(|part| part == "..") {
        return Err("Invalid WSL destination path".to_string());
    }

    let distro = discover_default_distro().await.map_err(|e| e.to_string())?;
    let output = wsl_command()
        .args([
            "-d",
            &distro,
            "--cd",
            "~",
            "--",
            "cp",
            "-r",
            "--",
            &source_path,
            &destination_path,
        ])
        .output()
        .map_err(|e| format!("WSL not available: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Import failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

// Copy (is_move=false) or move (is_move=true) a Finder entry into a chosen
// WSL folder, running through wsl.exe so the daemon is not involved — the
// daemon rejects /mnt/* sources, and copy/move is basic enough that it
// should keep working even while the daemon is down. Unlike cp/mv's silent
// overwrite, a name conflict at the destination is refused up front so
// nothing gets clobbered without the user choosing a different folder.
#[tauri::command]
async fn copy_move_entry(
    source_path: String,
    destination_dir: String,
    is_move: bool,
) -> Result<(), String> {
    if source_path.contains('\0') || source_path.split('/').any(|part| part == "..") {
        return Err("Invalid source path".to_string());
    }
    if destination_dir.contains('\0') || destination_dir.split('/').any(|part| part == "..") {
        return Err("Invalid destination path".to_string());
    }

    let name = source_path
        .rsplit('/')
        .next()
        .filter(|part| !part.is_empty() && *part != ".")
        .ok_or_else(|| "Invalid source path".to_string())?;
    let base = destination_dir.trim_end_matches('/');
    let target = if base.is_empty() {
        format!("/{name}")
    } else {
        format!("{base}/{name}")
    };

    let distro = discover_default_distro().await.map_err(|e| e.to_string())?;
    let exists = wsl_command()
        .args(["-d", &distro, "--cd", "~", "--", "test", "-e", &target])
        .output()
        .map_err(|e| format!("WSL not available: {e}"))?
        .status
        .success();
    if exists {
        return Err(format!(
            "“{name}” already exists in the destination folder."
        ));
    }

    let mut command = wsl_command();
    command.args(["-d", &distro, "--cd", "~", "--"]);
    if is_move {
        command.arg("mv");
    } else {
        command.arg("cp").arg("-r");
    }
    let output = command
        .args(["--", &source_path, &destination_dir])
        .output()
        .map_err(|e| format!("WSL not available: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "{} failed: {}",
            if is_move { "Move" } else { "Copy" },
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            restart_daemon,
            relaunch_aqua,
            quit_and_stop_daemon,
            stop_daemon,
            get_distro,
            get_daemon_dir,
            pick_images,
            export_to_windows,
            import_from_windows,
            copy_move_entry,
            pick_windows_files,
            restart_wsl_distro
        ])
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

#[cfg(test)]
mod tests {
    use super::{decode_wsl_output, parse_default_distro};

    fn utf16le(text: &str) -> Vec<u8> {
        let mut bytes = Vec::new();
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn decodes_utf16le_wsl_list_output() {
        let raw = utf16le("* Ubuntu    Running         2\r\n");
        let decoded = decode_wsl_output(&raw);
        assert_eq!(decoded, "* Ubuntu    Running         2\r\n");
        assert_eq!(parse_default_distro(&decoded), "Ubuntu");
    }

    #[test]
    fn passes_through_utf8_output() {
        let decoded = decode_wsl_output(b"* Ubuntu    Running         2\n");
        assert_eq!(parse_default_distro(&decoded), "Ubuntu");
    }

    #[test]
    fn parses_name_when_line_has_leading_star() {
        assert_eq!(parse_default_distro("* Debian   Stopped\n"), "Debian");
    }

    #[test]
    fn falls_back_to_ubuntu_when_no_default_marked() {
        assert_eq!(
            parse_default_distro("NAME      STATE           VERSION\n"),
            "Ubuntu"
        );
    }

    #[test]
    fn falls_back_to_ubuntu_when_star_line_has_no_name() {
        assert_eq!(parse_default_distro("* \n"), "Ubuntu");
    }
}
