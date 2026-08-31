use std::path::Path;

use axum::{
    Json,
    body::Bytes,
    extract::{Path as PathExtractor, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};

pub(crate) mod thumbnail;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::{
    AppState,
    state::{StateError, WallpaperRecord},
};

const CURRENT_PREF_KEY: &str = "wallpaper.current";
const DEFAULT_CURRENT: &str = "aqua";
const MAX_LABEL_BYTES: usize = 200;

#[derive(Deserialize)]
pub(crate) struct UploadQuery {
    label: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetRequest {
    id: String,
}

#[derive(Deserialize)]
pub(crate) struct AssetQuery {
    #[serde(default)]
    #[allow(dead_code)] // cache-buster accepted and ignored by design
    v: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CustomWallpaper {
    id: String,
    label: String,
    added_at: chrono::DateTime<Utc>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WallpaperState {
    current: String,
    custom: Vec<CustomWallpaper>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub(crate) enum SimpleResponse {
    Success { success: bool },
    Failure { success: bool, error: String },
}

fn success() -> Json<SimpleResponse> {
    Json(SimpleResponse::Success { success: true })
}

fn failure(error: impl Into<String>) -> (StatusCode, Json<SimpleResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(SimpleResponse::Failure {
            success: false,
            error: error.into(),
        }),
    )
}

impl From<StateError> for Response {
    fn from(error: StateError) -> Self {
        match error {
            StateError::Invalid(message) => failure(message).into_response(),
            StateError::Storage(message) => {
                tracing::error!(%message, "wallpaper storage request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(SimpleResponse::Failure {
                        success: false,
                        error: "wallpaper storage unavailable".into(),
                    }),
                )
                    .into_response()
            }
        }
    }
}

/// Small boxed error wrapper to avoid `clippy::result_large_err`.
/// `Response` is 128 bytes; returning `Result<_, Response>` copies that on every `Err`.
/// Boxing makes the `Err` variant pointer-sized (8 bytes).
pub(crate) struct WallpaperError(Box<Response>);

impl From<StateError> for WallpaperError {
    fn from(error: StateError) -> Self {
        Self(Box::new(Response::from(error)))
    }
}

impl From<Response> for WallpaperError {
    fn from(response: Response) -> Self {
        Self(Box::new(response))
    }
}

impl IntoResponse for WallpaperError {
    fn into_response(self) -> Response {
        *self.0
    }
}

fn custom(record: WallpaperRecord) -> CustomWallpaper {
    CustomWallpaper {
        id: record.id,
        label: record.label,
        added_at: record.added_at,
    }
}

pub(crate) async fn state(
    State(state): State<AppState>,
) -> Result<Json<WallpaperState>, WallpaperError> {
    let wallpapers = state
        .state
        .list_wallpapers()
        .map_err(WallpaperError::from)?;
    let current = state
        .state
        .get_pref(CURRENT_PREF_KEY)
        .map_err(WallpaperError::from)?
        .unwrap_or_else(|| DEFAULT_CURRENT.to_owned());
    Ok(Json(WallpaperState {
        current,
        custom: wallpapers.into_iter().map(custom).collect(),
    }))
}

pub(crate) async fn set(
    State(state): State<AppState>,
    Json(request): Json<SetRequest>,
) -> Result<Json<SimpleResponse>, WallpaperError> {
    let id = request.id.trim();
    if id.is_empty() || id.len() > MAX_LABEL_BYTES {
        return Err(failure("wallpaper id must be non-empty")
            .into_response()
            .into());
    }
    state
        .state
        .set_pref(CURRENT_PREF_KEY, id)
        .map_err(WallpaperError::from)?;
    Ok(success())
}

pub(crate) async fn upload(
    State(state): State<AppState>,
    Query(query): Query<UploadQuery>,
    bytes: Bytes,
) -> Result<Response, WallpaperError> {
    let label = query.label.trim();
    if label.is_empty() || label.len() > MAX_LABEL_BYTES {
        return Err(failure("label must be between 1 and 200 characters")
            .into_response()
            .into());
    }
    if bytes.is_empty() {
        return Err(failure("upload body must contain image data")
            .into_response()
            .into());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let stored = {
        let directory = state.wallpaper_dir.clone();
        let task_id = id.clone();
        match tokio::task::spawn_blocking(move || {
            crate::wallpaper::thumbnail::store(&directory, &task_id, &bytes)
        })
        .await
        {
            Ok(Ok(stored)) => stored,
            Ok(Err(message)) => {
                return Err(failure(message).into_response().into());
            }
            Err(_) => return Err(failure("wallpaper task failed").into_response().into()),
        }
    };

    let record = WallpaperRecord {
        id: id.clone(),
        label: label.to_owned(),
        path: stored.path,
        thumb_path: stored.thumb_path,
        added_at: Utc::now(),
    };
    state
        .state
        .insert_wallpaper(&record)
        .map_err(WallpaperError::from)?;
    Ok((StatusCode::CREATED, Json(custom(record))).into_response())
}

pub(crate) async fn delete(
    State(state): State<AppState>,
    PathExtractor(id): PathExtractor<String>,
) -> Result<Json<SimpleResponse>, WallpaperError> {
    let record = state
        .state
        .get_wallpaper(&id)
        .map_err(WallpaperError::from)?;
    let Some(record) = record else {
        // Built-in and unknown IDs are frontend-owned; nothing daemon-owned to remove.
        return Err(failure("no custom wallpaper with that id exists")
            .into_response()
            .into());
    };
    let was_current = state
        .state
        .get_pref(CURRENT_PREF_KEY)
        .map_err(WallpaperError::from)?
        .is_some_and(|current| current == id);
    state
        .state
        .delete_wallpaper(&id)
        .map_err(WallpaperError::from)?;
    let directory = state.wallpaper_dir.clone();
    tokio::task::spawn_blocking(move || {
        crate::wallpaper::thumbnail::remove_files(&record.path, &record.thumb_path);
        drop(directory);
    });
    if was_current {
        state
            .state
            .set_pref(CURRENT_PREF_KEY, DEFAULT_CURRENT)
            .map_err(WallpaperError::from)?;
    }
    Ok(success())
}

pub(crate) async fn asset(
    State(state): State<AppState>,
    PathExtractor(id): PathExtractor<String>,
    Query(_cache_buster): Query<AssetQuery>,
) -> Response {
    serve_file(&state, &id, false).await
}

pub(crate) async fn thumb(
    State(state): State<AppState>,
    PathExtractor(id): PathExtractor<String>,
) -> Response {
    serve_file(&state, &id, true).await
}

async fn serve_file(state: &AppState, id: &str, thumbnail: bool) -> Response {
    let Ok(record) = state.state.get_wallpaper(id) else {
        return failure("wallpaper storage unavailable").into_response();
    };
    let Some(record) = record else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    let path = if thumbnail {
        record.thumb_path
    } else {
        record.path
    };
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let mime = mime_for(&path);
            (StatusCode::OK, [(header::CONTENT_TYPE, mime)], bytes).into_response()
        }
        Err(error) => {
            tracing::error!(%error, path = %path.display(), "failed to read wallpaper asset");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(SimpleResponse::Failure {
                    success: false,
                    error: "wallpaper asset unavailable".into(),
                }),
            )
                .into_response()
        }
    }
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}
