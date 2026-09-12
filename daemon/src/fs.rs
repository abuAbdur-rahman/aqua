use std::{
    fs::{self, File},
    io::{self, Read, Write},
    os::{fd::AsFd, unix::fs::PermissionsExt as _},
    path::{Path, PathBuf},
    sync::Arc,
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
    AtFlags, Mode, OFlags, fchmod, mkdirat, openat2, readlinkat, renameat, statat, symlinkat,
};
use serde::{Deserialize, Serialize};
use tokio::task;

use crate::AppState;

pub(crate) mod safety;
pub(crate) mod trash;

use trash::{TrashOutcome, is_windows_mount};

const READ_LIMIT: usize = 1024 * 1024;
use safety::{
    RESOLVE_SAFE, fd_path, file_from_fd, open_safe, reject_collision, reject_root, relative_path,
    validate_final_name, validate_name,
};

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
    is_trashable: bool,
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

#[derive(Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FsOp {
    CreateFile {
        path: String,
        #[serde(default)]
        elevated: bool,
    },
    CreateDir {
        path: String,
        #[serde(default)]
        elevated: bool,
    },
    Rename {
        path: String,
        new_name: String,
        #[serde(default)]
        elevated: bool,
    },
    Move {
        path: String,
        to: String,
        #[serde(default)]
        elevated: bool,
    },
    Copy {
        path: String,
        to: String,
        #[serde(default)]
        elevated: bool,
    },
    MoveToTrash {
        path: String,
        #[serde(default)]
        elevated: bool,
    },
    RestoreFromTrash {
        trash_id: String,
        #[serde(default)]
        elevated: bool,
    },
    PermanentDelete {
        trash_id: String,
        #[serde(default)]
        elevated: bool,
    },
    EmptyTrash {
        #[serde(default)]
        elevated: bool,
    },
    Chmod {
        path: String,
        mode: String,
        #[serde(default)]
        elevated: bool,
    },
}

impl FsOp {
    fn elevated(&self) -> bool {
        match self {
            Self::CreateFile { elevated, .. }
            | Self::CreateDir { elevated, .. }
            | Self::Rename { elevated, .. }
            | Self::Move { elevated, .. }
            | Self::Copy { elevated, .. }
            | Self::MoveToTrash { elevated, .. }
            | Self::RestoreFromTrash { elevated, .. }
            | Self::PermanentDelete { elevated, .. }
            | Self::EmptyTrash { elevated }
            | Self::Chmod { elevated, .. } => *elevated,
        }
    }
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
    Success {
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none", rename = "trashId")]
        trash_id: Option<String>,
    },
    Failure {
        success: bool,
        error: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "needsElevation")]
        needs_elevation: Option<bool>,
    },
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
    match run_blocking(state, move |state| {
        apply_operation_request(&state, operation)
    })
    .await
    {
        Ok(outcome) => Json(FsOpResponse::Success {
            success: true,
            trash_id: outcome.trash_id,
        })
        .into_response(),
        Err(error) => (
            error.status,
            Json(FsOpResponse::Failure {
                success: false,
                error: error.message,
                needs_elevation: error.needs_elevation.then_some(true),
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

pub fn run_privileged_operation(root: &Path, operation: FsOp) -> Result<(), ApiError> {
    let root = fs::canonicalize(root).map_err(ApiError::from_io)?;
    let root_file = File::open(&root).map_err(ApiError::from_io)?;
    let root_fd = openat2(
        &root_file,
        ".",
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
        Mode::empty(),
        safety::RESOLVE_SAFE,
    )
    .map_err(ApiError::from_io)?;
    let context = FsContext {
        fs_root: Arc::from(root),
        fs_root_fd: Arc::new(file_from_fd(root_fd)),
    };
    apply_operation(&context, operation)?;
    Ok(())
}

fn apply_operation_request(state: &AppState, operation: FsOp) -> Result<TrashOutcome, ApiError> {
    // Irreversible deletion is password-gated by design: permanentDelete and
    // emptyTrash require an active elevation grant even when the trash
    // contents are user-owned and no Linux privileges would be needed.
    let password_gated = operation.elevated()
        || matches!(
            operation,
            FsOp::PermanentDelete { .. } | FsOp::EmptyTrash { .. }
        );
    if password_gated && !state.elevation.is_active() {
        return Err(ApiError::elevation_required("elevation is required"));
    }
    if trash::is_trash_operation(&operation) {
        return trash::apply_operation(state, operation);
    }
    if operation.elevated() {
        return crate::system::run_elevated_fs(&state.elevation, &state.fs_root, &operation)
            .map(|()| TrashOutcome::none());
    }
    apply_operation(&FsContext::from_state(state), operation)
}

struct FsContext {
    fs_root: Arc<Path>,
    fs_root_fd: Arc<File>,
}

impl FsContext {
    fn from_state(state: &AppState) -> Self {
        Self {
            fs_root: Arc::clone(&state.fs_root),
            fs_root_fd: Arc::clone(&state.fs_root_fd),
        }
    }
}

fn apply_operation(context: &FsContext, operation: FsOp) -> Result<TrashOutcome, ApiError> {
    match operation {
        FsOp::CreateFile { path, .. } => {
            let relative = relative_path(&context.fs_root, &path)?;
            reject_root(&relative)?;
            validate_final_name(&relative)?;
            let (parent, name) = parent_and_name(&relative)?;
            let parent_fd = open_safe(
                &context.fs_root_fd,
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
        FsOp::CreateDir { path, .. } => {
            let relative = relative_path(&context.fs_root, &path)?;
            reject_root(&relative)?;
            validate_final_name(&relative)?;
            let (parent, name) = parent_and_name(&relative)?;
            let parent_fd = open_safe(
                &context.fs_root_fd,
                parent,
                OFlags::RDONLY | OFlags::DIRECTORY,
            )?;
            mkdirat(&parent_fd, name, Mode::from_bits_truncate(0o777))
                .map_err(ApiError::from_io)?;
        }
        FsOp::Rename { path, new_name, .. } => {
            validate_name(&new_name)?;
            let source = relative_path(&context.fs_root, &path)?;
            reject_root(&source)?;
            let (parent, name) = parent_and_name(&source)?;
            let parent_fd = open_safe(
                &context.fs_root_fd,
                parent,
                OFlags::RDONLY | OFlags::DIRECTORY,
            )?;
            reject_collision(&parent_fd, Path::new(&new_name))?;
            renameat(&parent_fd, name, &parent_fd, Path::new(&new_name))
                .map_err(ApiError::from_io)?;
        }
        FsOp::Move { path, to, .. } => {
            let source = relative_path(&context.fs_root, &path)?;
            let destination = relative_path(&context.fs_root, &to)?;
            reject_root(&source)?;
            reject_root(&destination)?;
            validate_final_name(&destination)?;
            let (source_parent, source_name) = parent_and_name(&source)?;
            let (destination_parent, destination_name) = parent_and_name(&destination)?;
            let source_fd = open_safe(
                &context.fs_root_fd,
                source_parent,
                OFlags::RDONLY | OFlags::DIRECTORY,
            )?;
            let destination_fd = open_safe(
                &context.fs_root_fd,
                destination_parent,
                OFlags::RDONLY | OFlags::DIRECTORY,
            )?;
            reject_collision(&destination_fd, destination_name)?;
            match renameat(&source_fd, source_name, &destination_fd, destination_name) {
                Ok(()) => {}
                Err(error) if error.raw_os_error() == trash::EXDEV => {
                    let source_display = display_path(&context.fs_root, &source);
                    let destination_display = display_path(&context.fs_root, &destination);
                    trash::copy_path_tree(&source_display, &destination_display)?;
                    trash::remove_path_tree(&source_display)?;
                }
                Err(error) => return Err(ApiError::from_io(error)),
            }
        }
        FsOp::Copy { path, to, .. } => {
            let source = relative_path(&context.fs_root, &path)?;
            let destination = relative_path(&context.fs_root, &to)?;
            reject_root(&source)?;
            reject_root(&destination)?;
            validate_final_name(&destination)?;
            let (source_parent, source_name) = parent_and_name(&source)?;
            let (destination_parent, destination_name) = parent_and_name(&destination)?;
            let source_fd = open_safe(
                &context.fs_root_fd,
                source_parent,
                OFlags::RDONLY | OFlags::DIRECTORY,
            )?;
            let destination_fd = open_safe(
                &context.fs_root_fd,
                destination_parent,
                OFlags::RDONLY | OFlags::DIRECTORY,
            )?;
            let unique = auto_rename_destination(&destination_fd, destination_name)?;
            copy_entry(&source_fd, source_name, &destination_fd, &unique)?;
        }
        FsOp::MoveToTrash { .. }
        | FsOp::RestoreFromTrash { .. }
        | FsOp::PermanentDelete { .. }
        | FsOp::EmptyTrash { .. } => {
            return Err(ApiError::bad_request(
                "trash operations are not available in this context",
            ));
        }
        FsOp::Chmod { path, mode, .. } => {
            let relative = relative_path(&context.fs_root, &path)?;
            let mode = u32::from_str_radix(&mode, 8)
                .map_err(|_| ApiError::bad_request("mode must be an octal string"))?;
            if mode > 0o7777 {
                return Err(ApiError::bad_request("mode is outside the supported range"));
            }
            let fd = open_safe(&context.fs_root_fd, &relative, OFlags::RDONLY)?;
            fchmod(&fd, Mode::from_bits_truncate(mode)).map_err(ApiError::from_io)?;
        }
    }
    Ok(TrashOutcome::none())
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

fn copy_entry(
    source_parent: &impl AsFd,
    source_name: &Path,
    destination_parent: &impl AsFd,
    destination_name: &Path,
) -> Result<(), ApiError> {
    let stat =
        statat(source_parent, source_name, AtFlags::SYMLINK_NOFOLLOW).map_err(ApiError::from_io)?;
    let file_type = rustix::fs::FileType::from_raw_mode(stat.st_mode);
    if file_type.is_symlink() {
        let target =
            readlinkat(source_parent, source_name, Vec::new()).map_err(ApiError::from_io)?;
        symlinkat(target, destination_parent, destination_name).map_err(ApiError::from_io)?;
        return Ok(());
    }
    if file_type.is_dir() {
        mkdirat(
            destination_parent,
            destination_name,
            Mode::from_bits_truncate(stat.st_mode & 0o7777),
        )
        .map_err(ApiError::from_io)?;
        let source_fd = openat2(
            source_parent,
            source_name,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
            Mode::empty(),
            RESOLVE_SAFE,
        )
        .map_err(ApiError::from_io)?;
        let destination_fd = openat2(
            destination_parent,
            destination_name,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
            Mode::empty(),
            RESOLVE_SAFE,
        )
        .map_err(ApiError::from_io)?;
        let source_directory = file_from_fd(source_fd);
        let destination_directory = file_from_fd(destination_fd);
        for entry in fs::read_dir(fd_path(&source_directory)).map_err(ApiError::from_io)? {
            let entry = entry.map_err(ApiError::from_io)?;
            let child_name = entry.file_name();
            copy_entry(
                &source_directory,
                Path::new(&child_name),
                &destination_directory,
                Path::new(&child_name),
            )?;
        }
        return Ok(());
    }

    let source_fd = openat2(
        source_parent,
        source_name,
        OFlags::RDONLY | OFlags::CLOEXEC,
        Mode::empty(),
        RESOLVE_SAFE,
    )
    .map_err(ApiError::from_io)?;
    let destination_fd = openat2(
        destination_parent,
        destination_name,
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::CLOEXEC,
        Mode::from_bits_truncate(stat.st_mode & 0o7777),
        RESOLVE_SAFE,
    )
    .map_err(ApiError::from_io)?;
    io::copy(
        &mut file_from_fd(source_fd),
        &mut file_from_fd(destination_fd),
    )
    .map_err(ApiError::from_io)?;
    Ok(())
}

fn auto_rename_destination(parent: &impl AsFd, name: &Path) -> Result<PathBuf, ApiError> {
    if destination_is_available(parent, name)? {
        return Ok(name.to_path_buf());
    }
    let original = name.to_string_lossy().into_owned();
    let source = Path::new(&original);
    let (stem, extension) = match source.extension() {
        Some(extension) => (
            source
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| original.clone()),
            format!(".{}", extension.to_string_lossy()),
        ),
        None => (original, String::new()),
    };
    for n in 1..u32::MAX {
        let candidate = format!("{stem} ({n}){extension}");
        if destination_is_available(parent, Path::new(&candidate))? {
            return Ok(PathBuf::from(candidate));
        }
    }
    Err(ApiError::conflict("no free destination name"))
}

fn destination_is_available(parent: &impl AsFd, name: &Path) -> Result<bool, ApiError> {
    match statat(parent, name, AtFlags::SYMLINK_NOFOLLOW) {
        Ok(_) => Ok(false),
        Err(error) if error == rustix::io::Errno::NOENT => Ok(true),
        Err(error) => Err(ApiError::from_io(error)),
    }
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
        is_trashable: !is_windows_mount(&path),
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
    needs_elevation: bool,
}

impl ApiError {
    pub(crate) fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
            needs_elevation: false,
        }
    }
    pub(crate) fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
            needs_elevation: false,
        }
    }
    pub(crate) fn elevation_required(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
            needs_elevation: true,
        }
    }
    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
            needs_elevation: false,
        }
    }
    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
            needs_elevation: false,
        }
    }
    pub(crate) fn from_notify(error: notify::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
            needs_elevation: false,
        }
    }
    pub fn message(&self) -> &str {
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
            needs_elevation: false,
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
