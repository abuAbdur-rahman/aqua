use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{Json, extract::State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::AppState;

const ELEVATION_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Clone)]
pub(crate) struct Elevation {
    expires_at: Arc<Mutex<Option<Instant>>>,
    sudo_command: Arc<Path>,
    helper_executable: Arc<Path>,
}

impl Default for Elevation {
    fn default() -> Self {
        let helper = std::env::current_exe()
            .ok()
            .and_then(|path| {
                path.parent()
                    .map(|parent| parent.join("aqua-daemon-helper"))
            })
            .unwrap_or_else(|| PathBuf::from("aqua-daemon-helper"));
        Self::with_commands(PathBuf::from("sudo"), helper)
    }
}

impl Elevation {
    pub(crate) fn with_commands(sudo_command: PathBuf, helper_executable: PathBuf) -> Self {
        Self {
            expires_at: Arc::new(Mutex::new(None)),
            sudo_command: Arc::from(sudo_command),
            helper_executable: Arc::from(helper_executable),
        }
    }
}

impl Elevation {
    pub(crate) fn is_active(&self) -> bool {
        self.expires_at
            .lock()
            .expect("elevation mutex must not be poisoned")
            .is_some_and(|expires| expires > Instant::now())
    }

    fn grant(&self) -> DateTime<Utc> {
        *self
            .expires_at
            .lock()
            .expect("elevation mutex must not be poisoned") = Some(Instant::now() + ELEVATION_TTL);
        Utc::now() + chrono::Duration::from_std(ELEVATION_TTL).expect("TTL fits chrono")
    }
}

#[derive(Deserialize)]
pub(crate) struct ElevateRequest {
    password: String,
}

#[derive(Serialize)]
#[serde(untagged, rename_all = "camelCase")]
pub(crate) enum ElevateResponse {
    Success {
        success: bool,
        #[serde(rename = "expiresAt")]
        expires_at: DateTime<Utc>,
    },
    Failure {
        success: bool,
        error: &'static str,
    },
}

pub(crate) async fn elevate(
    State(state): State<AppState>,
    Json(request): Json<ElevateRequest>,
) -> Json<ElevateResponse> {
    let sudo_command = Arc::clone(&state.elevation.sudo_command);
    let valid = tokio::task::spawn_blocking(move || {
        validate_password_with(&sudo_command, &request.password)
    })
    .await
    .unwrap_or(false);
    if valid {
        Json(ElevateResponse::Success {
            success: true,
            expires_at: state.elevation.grant(),
        })
    } else {
        Json(ElevateResponse::Failure {
            success: false,
            error: "elevation failed",
        })
    }
}

pub(crate) fn run_elevated_fs(
    elevation: &Elevation,
    root: &Path,
    operation: &crate::fs::FsOp,
) -> Result<(), crate::fs::ApiError> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct HelperRequest<'a> {
        #[serde(flatten)]
        operation: &'a crate::fs::FsOp,
        allowed_root: &'a Path,
    }

    let payload = serde_json::to_vec(&HelperRequest {
        operation,
        allowed_root: root,
    })
    .map_err(|_| crate::fs::ApiError::internal("elevated request failed"))?;
    let mut child = Command::new(&*elevation.sudo_command)
        .args(["-n"])
        .arg(&*elevation.helper_executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| crate::fs::ApiError::internal("elevated helper unavailable"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| crate::fs::ApiError::internal("elevated helper unavailable"))?
        .write_all(&payload)
        .map_err(|_| crate::fs::ApiError::internal("elevated request failed"))?;
    let output = child
        .wait_with_output()
        .map_err(|_| crate::fs::ApiError::internal("elevated helper failed"))?;
    if !output.status.success() {
        return Err(crate::fs::ApiError::elevation_required(
            "elevation is required",
        ));
    }
    let response: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| crate::fs::ApiError::internal("invalid elevated helper response"))?;
    if response.get("success") == Some(&serde_json::Value::Bool(true)) {
        Ok(())
    } else {
        Err(crate::fs::ApiError::forbidden(
            "elevated filesystem operation failed",
        ))
    }
}

fn validate_password_with(sudo_command: &Path, password: &str) -> bool {
    let mut child = match Command::new(sudo_command)
        .args(["-S", "-v"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return false,
    };
    let Some(mut stdin) = child.stdin.take() else {
        return false;
    };
    if stdin.write_all(format!("{password}\n").as_bytes()).is_err() {
        return false;
    }
    drop(stdin);
    child.wait().is_ok_and(|status| status.success())
}

#[derive(Serialize)]
pub(crate) struct ShutdownResponse {
    pub(crate) success: bool,
}

pub(crate) async fn shutdown(State(state): State<AppState>) -> Json<ShutdownResponse> {
    state.shutdown.notify_one();
    Json(ShutdownResponse { success: true })
}
