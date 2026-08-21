use std::{
    fs::{self, File},
    io::{self, Read, Write},
    os::fd::{AsFd, AsRawFd, FromRawFd, IntoRawFd, OwnedFd},
    os::unix::fs::PermissionsExt as _,
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use rustix::fs::{
    AtFlags, Mode, OFlags, ResolveFlags, fchmod, mkdirat, openat2, renameat, statat, unlinkat,
};
use serde::{Deserialize, Serialize};
use tokio::task;

use crate::AppState;

const READ_LIMIT: usize = 1024 * 1024;
const RESOLVE_SAFE: ResolveFlags = ResolveFlags::BENEATH.union(ResolveFlags::NO_SYMLINKS);

#[derive(Deserialize)]
pub(crate) struct PathQuery {
    path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    name: String,
    path: String,
    kind: EntryKind,
    size: u64,
    modified: DateTime<Utc>,
    permissions: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
enum EntryKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadResponse {
    path: String,
    content: String,
    encoding: Encoding,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum Encoding {
    Utf8,
    Base64,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FsOp {
    CreateFile { path: String },
    CreateDir { path: String },
    Rename { path: String, new_name: String },
    Move { path: String, to: String },
    Delete { path: String },
    Chmod { path: String, mode: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteRequest {
    path: String,
    content: String,
}

#[derive(Serialize)]
#[serde(untagged)]
enum FsOpResponse {
    Success { success: bool },
    Failure { success: bool, error: String },
}

#[derive(Serialize)]
#[serde(untagged)]
enum FsWriteResponse {
    Success {
        success: bool,
        modified: DateTime<Utc>,
    },
    Failure {
        success: bool,
        error: String,
    },
}

pub(crate) async fn list(
    State(state): State<AppState>,
    Query(query): Query<PathQuery>,
) -> Result<Json<Vec<FsEntry>>, ApiError> {
    Ok(Json(
        run_blocking(state, move |state| list_sync(&state, &query.path)).await?,
    ))
}

pub(crate) async fn read(
    State(state): State<AppState>,
    Query(query): Query<PathQuery>,
) -> Result<Json<FsReadResponse>, ApiError> {
    Ok(Json(
        run_blocking(state, move |state| read_sync(&state, &query.path)).await?,
    ))
}

pub(crate) async fn operate(
    State(state): State<AppState>,
    Json(operation): Json<FsOp>,
) -> Response {
    match run_blocking(state, move |state| apply_operation(&state, operation)).await {
        Ok(()) => Json(FsOpResponse::Success { success: true }).into_response(),
        Err(error) => (
            error.status,
            Json(FsOpResponse::Failure {
                success: false,
                error: error.message,
            }),
        )
            .into_response(),
    }
}

pub(crate) async fn write(
    State(state): State<AppState>,
    Json(request): Json<FsWriteRequest>,
) -> Response {
    match run_blocking(state, move |state| write_sync(&state, request)).await {
        Ok(modified) => Json(FsWriteResponse::Success {
            success: true,
            modified,
        })
        .into_response(),
        Err(error) => (
            error.status,
            Json(FsWriteResponse::Failure {
                success: false,
                error: error.message,
            }),
        )
            .into_response(),
    }
}

fn list_sync(state: &AppState, requested: &str) -> Result<Vec<FsEntry>, ApiError> {
    let relative = relative_path(&state.fs_root, requested)?;
    let dir = open_safe(
        &state.fs_root_fd,
        &relative,
        OFlags::RDONLY | OFlags::DIRECTORY,
    )?;
    let directory = fs::read_dir(fd_path(&dir)).map_err(ApiError::from_io)?;
    let display = display_path(&state.fs_root, &relative);
    let mut entries = Vec::new();
    for entry in directory {
        let entry = entry.map_err(ApiError::from_io)?;
        let metadata = entry.metadata().map_err(ApiError::from_io)?;
        entries.push(entry_from_metadata(
            entry.file_name().to_string_lossy().into_owned(),
            display.join(entry.file_name()),
            metadata,
        ));
    }
    entries.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(entries)
}

fn read_sync(state: &AppState, requested: &str) -> Result<FsReadResponse, ApiError> {
    let relative = relative_path(&state.fs_root, requested)?;
    let fd = open_safe(&state.fs_root_fd, &relative, OFlags::RDONLY)?;
    let mut file = file_from_fd(fd);
    if !file.metadata().map_err(ApiError::from_io)?.is_file() {
        return Err(ApiError::bad_request("path is not a file"));
    }
    let mut bytes = Vec::with_capacity(READ_LIMIT + 1);
    Read::by_ref(&mut file)
        .take((READ_LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(ApiError::from_io)?;
    let truncated = bytes.len() > READ_LIMIT;
    bytes.truncate(READ_LIMIT);
    let (content, encoding) = if truncated {
        (STANDARD.encode(&bytes), Encoding::Base64)
    } else {
        match std::str::from_utf8(&bytes) {
            Ok(text) => (text.to_owned(), Encoding::Utf8),
            Err(_) => (STANDARD.encode(&bytes), Encoding::Base64),
        }
    };
    Ok(FsReadResponse {
        path: path_string(&display_path(&state.fs_root, &relative)),
        content,
        encoding,
        truncated,
    })
}

fn write_sync(state: &AppState, request: FsWriteRequest) -> Result<DateTime<Utc>, ApiError> {
    let relative = relative_path(&state.fs_root, &request.path)?;
    let fd = open_safe(&state.fs_root_fd, &relative, OFlags::WRONLY | OFlags::TRUNC)?;
    let mut file = file_from_fd(fd);
    if !file.metadata().map_err(ApiError::from_io)?.is_file() {
        return Err(ApiError::bad_request("path is not a file"));
    }
    file.write_all(request.content.as_bytes())
        .map_err(ApiError::from_io)?;
    file.sync_all().map_err(ApiError::from_io)?;
    Ok(file
        .metadata()
        .map_err(ApiError::from_io)?
        .modified()
        .map_err(ApiError::from_io)?
        .into())
}

fn apply_operation(state: &AppState, operation: FsOp) -> Result<(), ApiError> {
    match operation {
        FsOp::CreateFile { path } => {
            let relative = relative_path(&state.fs_root, &path)?;
            reject_root(&relative)?;
            validate_final_name(&relative)?;
            let (parent, name) = parent_and_name(&relative)?;
            let parent_fd = open_safe(
                &state.fs_root_fd,
                parent,
                OFlags::RDONLY | OFlags::DIRECTORY,
            )?;
            let fd = openat2(
                &parent_fd,
                name,
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL,
                Mode::from_bits_truncate(0o666),
                RESOLVE_SAFE,
            )
            .map_err(ApiError::from_io)?;
            drop(fd);
        }
        FsOp::CreateDir { path } => {
            let relative = relative_path(&state.fs_root, &path)?;
            reject_root(&relative)?;
            validate_final_name(&relative)?;
            let (parent, name) = parent_and_name(&relative)?;
            let parent_fd = open_safe(
                &state.fs_root_fd,
                parent,
                OFlags::RDONLY | OFlags::DIRECTORY,
            )?;
            mkdirat(&parent_fd, name, Mode::from_bits_truncate(0o777))
                .map_err(ApiError::from_io)?;
        }
        FsOp::Rename { path, new_name } => {
            validate_name(&new_name)?;
            let source = relative_path(&state.fs_root, &path)?;
            reject_root(&source)?;
            let (parent, name) = parent_and_name(&source)?;
            let parent_fd = open_safe(
                &state.fs_root_fd,
                parent,
                OFlags::RDONLY | OFlags::DIRECTORY,
            )?;
            reject_collision(&parent_fd, Path::new(&new_name))?;
            renameat(&parent_fd, name, &parent_fd, Path::new(&new_name))
                .map_err(ApiError::from_io)?;
        }
        FsOp::Move { path, to } => {
            let source = relative_path(&state.fs_root, &path)?;
            let destination = relative_path(&state.fs_root, &to)?;
            reject_root(&source)?;
            reject_root(&destination)?;
            validate_final_name(&destination)?;
            let (source_parent, source_name) = parent_and_name(&source)?;
            let (destination_parent, destination_name) = parent_and_name(&destination)?;
            let source_fd = open_safe(
                &state.fs_root_fd,
                source_parent,
                OFlags::RDONLY | OFlags::DIRECTORY,
            )?;
            let destination_fd = open_safe(
                &state.fs_root_fd,
                destination_parent,
                OFlags::RDONLY | OFlags::DIRECTORY,
            )?;
            reject_collision(&destination_fd, destination_name)?;
            renameat(&source_fd, source_name, &destination_fd, destination_name)
                .map_err(ApiError::from_io)?;
        }
        FsOp::Delete { path } => {
            let relative = relative_path(&state.fs_root, &path)?;
            reject_root(&relative)?;
            let (parent, name) = parent_and_name(&relative)?;
            let parent_fd = open_safe(
                &state.fs_root_fd,
                parent,
                OFlags::RDONLY | OFlags::DIRECTORY,
            )?;
            let stat =
                statat(&parent_fd, name, AtFlags::SYMLINK_NOFOLLOW).map_err(ApiError::from_io)?;
            if rustix::fs::FileType::from_raw_mode(stat.st_mode).is_dir() {
                remove_directory_tree(&parent_fd, name)?;
            } else {
                unlinkat(&parent_fd, name, AtFlags::empty()).map_err(ApiError::from_io)?;
            }
        }
        FsOp::Chmod { path, mode } => {
            let relative = relative_path(&state.fs_root, &path)?;
            let mode = u32::from_str_radix(&mode, 8)
                .map_err(|_| ApiError::bad_request("mode must be an octal string"))?;
            if mode > 0o7777 {
                return Err(ApiError::bad_request("mode is outside the supported range"));
            }
            let fd = open_safe(&state.fs_root_fd, &relative, OFlags::RDONLY)?;
            fchmod(&fd, Mode::from_bits_truncate(mode)).map_err(ApiError::from_io)?;
        }
    }
    Ok(())
}

pub(crate) async fn resolve_watch_dir(
    state: &AppState,
    requested: &str,
) -> Result<(File, PathBuf), ApiError> {
    let relative = relative_path(&state.fs_root, requested)?;
    let fd = open_safe(
        &state.fs_root_fd,
        &relative,
        OFlags::RDONLY | OFlags::DIRECTORY,
    )?;
    Ok((file_from_fd(fd), display_path(&state.fs_root, &relative)))
}

pub(crate) async fn entry_for_watch(state: &AppState, path: PathBuf) -> Option<FsEntry> {
    let relative = relative_path(&state.fs_root, &path_string(&path)).ok()?;
    let fd = open_safe(&state.fs_root_fd, &relative, OFlags::RDONLY).ok()?;
    let metadata = file_from_fd(fd).metadata().ok()?;
    Some(entry_from_metadata(
        path.file_name()?.to_string_lossy().into_owned(),
        path,
        metadata,
    ))
}

fn open_safe(root: &File, path: &Path, flags: OFlags) -> Result<OwnedFd, ApiError> {
    openat2(
        root,
        path,
        flags | OFlags::CLOEXEC,
        Mode::empty(),
        RESOLVE_SAFE,
    )
    .map_err(ApiError::from_io)
}

fn remove_directory_tree(parent: &impl AsFd, name: &Path) -> Result<(), ApiError> {
    let directory_fd = openat2(
        parent,
        name,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
        Mode::empty(),
        RESOLVE_SAFE,
    )
    .map_err(ApiError::from_io)?;
    let directory = file_from_fd(directory_fd);
    for entry in fs::read_dir(fd_path(&directory)).map_err(ApiError::from_io)? {
        let entry = entry.map_err(ApiError::from_io)?;
        let child_name = entry.file_name();
        let child_stat = statat(&directory, &child_name, AtFlags::SYMLINK_NOFOLLOW)
            .map_err(ApiError::from_io)?;
        if rustix::fs::FileType::from_raw_mode(child_stat.st_mode).is_dir() {
            remove_directory_tree(&directory, Path::new(&child_name))?;
        } else {
            unlinkat(&directory, &child_name, AtFlags::empty()).map_err(ApiError::from_io)?;
        }
    }
    unlinkat(parent, name, AtFlags::REMOVEDIR).map_err(ApiError::from_io)
}

fn parent_and_name(path: &Path) -> Result<(&Path, &Path), ApiError> {
    let name = path
        .file_name()
        .ok_or_else(|| ApiError::bad_request("path has no final component"))?;
    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    Ok((parent, Path::new(name)))
}

fn relative_path(root: &Path, requested: &str) -> Result<PathBuf, ApiError> {
    let requested = Path::new(requested);
    let relative = if requested.is_absolute() {
        requested
            .strip_prefix(root)
            .map_err(|_| ApiError::forbidden("path is outside the allowed root"))?
    } else {
        requested
    };
    if relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(ApiError::forbidden("parent traversal is not allowed"));
    }
    Ok(if relative.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        relative.to_path_buf()
    })
}

fn reject_root(path: &Path) -> Result<(), ApiError> {
    if path == Path::new(".") {
        Err(ApiError::forbidden("the allowed root cannot be modified"))
    } else {
        Ok(())
    }
}

fn validate_final_name(path: &Path) -> Result<(), ApiError> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| ApiError::bad_request("path must have a valid final component"))?;
    validate_name(name)
}

fn validate_name(name: &str) -> Result<(), ApiError> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\0') {
        Err(ApiError::bad_request("invalid file name"))
    } else {
        Ok(())
    }
}

fn reject_collision(dir: &impl AsFd, path: &Path) -> Result<(), ApiError> {
    match statat(dir, path, AtFlags::SYMLINK_NOFOLLOW) {
        Ok(_) => Err(ApiError::conflict("destination already exists")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ApiError::from_io(error)),
    }
}

fn fd_path(fd: &impl AsFd) -> PathBuf {
    PathBuf::from(format!("/proc/self/fd/{}", fd.as_fd().as_raw_fd()))
}

fn file_from_fd(fd: OwnedFd) -> File {
    // `OwnedFd` guarantees unique ownership of a valid file descriptor.
    unsafe { File::from_raw_fd(fd.into_raw_fd()) }
}

fn entry_from_metadata(name: String, path: PathBuf, metadata: fs::Metadata) -> FsEntry {
    let file_type = metadata.file_type();
    let kind = if file_type.is_symlink() {
        EntryKind::Symlink
    } else if file_type.is_dir() {
        EntryKind::Dir
    } else {
        EntryKind::File
    };
    FsEntry {
        name,
        path: path_string(&path),
        kind,
        size: metadata.len(),
        modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH).into(),
        permissions: format!("{:o}", metadata.permissions().mode() & 0o7777),
    }
}

fn display_path(root: &Path, relative: &Path) -> PathBuf {
    if relative == Path::new(".") {
        root.to_path_buf()
    } else {
        root.join(relative)
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

async fn run_blocking<T, F>(state: AppState, operation: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(AppState) -> Result<T, ApiError> + Send + 'static,
{
    task::spawn_blocking(move || operation(state))
        .await
        .map_err(|_| ApiError::internal("filesystem task failed"))?
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub(crate) fn bad_request(message: impl Into<String>) -> Self {
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
    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
        }
    }
    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
    pub(crate) fn from_notify(error: notify::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        }
    }
    pub(crate) fn message(&self) -> &str {
        &self.message
    }
    fn from_io<E: Into<io::Error>>(error: E) -> Self {
        let error = error.into();
        let status = match error.raw_os_error() {
            Some(18 | 40) => StatusCode::FORBIDDEN,
            _ => match error.kind() {
                io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
                io::ErrorKind::AlreadyExists => StatusCode::CONFLICT,
                io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            },
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
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
