use std::{
    fs, io,
    os::unix::fs::{PermissionsExt as _, symlink},
    path::{Path, PathBuf},
    time::Duration,
};

use chrono::{DateTime, Utc};
use rustix::fs::{OFlags, renameat};
use serde::Serialize;
use uuid::Uuid;

use super::{
    ApiError, EntryKind, FsContext, parent_and_name,
    safety::{open_safe, reject_root, relative_path},
};
use crate::state::{Store, TrashRecord};

const TRASH_RELATIVE: &str = ".local/share/aqua/Trash";
const PURGE_AGE_DAYS: i64 = 7;
const SWEEP_INTERVAL: Duration = Duration::from_secs(60 * 60);
pub(crate) const EXDEV: i32 = 18;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    id: String,
    original_path: String,
    name: String,
    kind: EntryKind,
    size: u64,
    deleted_at: DateTime<Utc>,
}

pub(crate) fn trash_dir_for(fs_root: &Path) -> PathBuf {
    fs_root.join(TRASH_RELATIVE)
}

pub(crate) fn is_windows_mount(path: &Path) -> bool {
    path == Path::new("/mnt") || path.starts_with("/mnt/")
}

pub(crate) async fn list(
    axum::extract::State(state): axum::extract::State<crate::AppState>,
) -> Result<axum::Json<Vec<TrashEntry>>, ApiError> {
    Ok(axum::Json(
        super::run_blocking(state, |state| list_sync(&state)).await?,
    ))
}

fn list_sync(state: &crate::AppState) -> Result<Vec<TrashEntry>, ApiError> {
    Ok(state
        .state
        .list_trash_entries()
        .map_err(internal_error)?
        .into_iter()
        .map(trash_entry_from_record)
        .collect())
}

fn internal_error(error: crate::state::StateError) -> ApiError {
    ApiError::internal(error.to_string())
}

fn trash_entry_from_record(record: TrashRecord) -> TrashEntry {
    let kind = match record.kind.as_str() {
        "dir" => EntryKind::Dir,
        "symlink" => EntryKind::Symlink,
        _ => EntryKind::File,
    };
    TrashEntry {
        id: record.id,
        original_path: record.original_path,
        name: record.name,
        kind,
        size: record.size.max(0) as u64,
        deleted_at: record.deleted_at,
    }
}

pub(crate) struct TrashOutcome {
    pub(crate) trash_id: Option<String>,
}

impl TrashOutcome {
    pub(crate) fn none() -> Self {
        Self { trash_id: None }
    }
}

pub(crate) fn is_trash_operation(operation: &super::FsOp) -> bool {
    matches!(
        operation,
        super::FsOp::MoveToTrash { .. }
            | super::FsOp::RestoreFromTrash { .. }
            | super::FsOp::PermanentDelete { .. }
            | super::FsOp::EmptyTrash { .. }
    )
}

pub(crate) fn apply_operation(
    state: &crate::AppState,
    operation: super::FsOp,
) -> Result<TrashOutcome, ApiError> {
    let context = FsContext::from_state(state);
    match operation {
        super::FsOp::MoveToTrash { path, .. } => {
            move_to_trash(state, &context, &path).map(|trash_id| TrashOutcome { trash_id })
        }
        super::FsOp::RestoreFromTrash { trash_id, .. } => {
            restore_from_trash(state, &trash_id).map(|_| TrashOutcome { trash_id: None })
        }
        super::FsOp::PermanentDelete { trash_id, .. } => {
            permanent_delete(state, &trash_id).map(|_| TrashOutcome { trash_id: None })
        }
        super::FsOp::EmptyTrash { .. } => {
            empty_trash(state).map(|_| TrashOutcome { trash_id: None })
        }
        _ => Err(ApiError::bad_request("unsupported trash operation")),
    }
}

fn move_to_trash(
    state: &crate::AppState,
    context: &FsContext,
    requested: &str,
) -> Result<Option<String>, ApiError> {
    let candidate = absolute_candidate(context, requested);
    let parent = candidate
        .parent()
        .ok_or_else(|| ApiError::bad_request("path has no parent"))?;
    let resolved_parent = fs::canonicalize(parent).map_err(ApiError::from_io)?;
    let name = candidate
        .file_name()
        .ok_or_else(|| ApiError::bad_request("path has no final component"))?;
    let resolved = resolved_parent.join(name);
    if is_windows_mount(&resolved) {
        remove_path_tree(&resolved)?;
        return Ok(None);
    }
    let relative = relative_path(&context.fs_root, &resolved.to_string_lossy())?;
    reject_root(&relative)?;
    let (parent, name) = parent_and_name(&relative)?;
    let metadata = fs::symlink_metadata(display_path(&context.fs_root, &relative))
        .map_err(ApiError::from_io)?;
    ensure_trash_dir(&state.trash_dir)?;
    let id = Uuid::new_v4().to_string();
    let record = TrashRecord {
        id: id.clone(),
        original_path: resolved.to_string_lossy().into_owned(),
        name: name.to_string_lossy().into_owned(),
        kind: kind_string(&metadata.file_type()),
        size: metadata.len() as i64,
        deleted_at: Utc::now(),
        trash_path: state.trash_dir.join(&id),
    };
    let parent_fd = open_safe(
        &context.fs_root_fd,
        parent,
        OFlags::RDONLY | OFlags::DIRECTORY,
    )?;
    let trash_relative = relative_path(&context.fs_root, &state.trash_dir.to_string_lossy())?;
    let trash_fd = open_safe(
        &context.fs_root_fd,
        &trash_relative,
        OFlags::RDONLY | OFlags::DIRECTORY,
    )?;
    match renameat(&parent_fd, name, &trash_fd, Path::new(id.as_str())) {
        Ok(()) => {}
        Err(error) if error.raw_os_error() == EXDEV => {
            // Cross-device source: copy into the trash
            // directory, then remove the original.
            let source = display_path(&context.fs_root, &relative);
            copy_path_tree(&source, &record.trash_path)?;
            remove_path_tree(&source)?;
        }
        Err(error) => return Err(ApiError::from_io(error)),
    }
    if let Err(error) = state.state.insert_trash_entry(&record) {
        let source = display_path(&context.fs_root, &relative);
        if let Err(rollback_error) = move_path(&record.trash_path, &source) {
            tracing::error!(
                error = rollback_error.message(),
                path = %source.display(),
                "failed to roll back untracked trash entry"
            );
        }
        return Err(internal_error(error));
    }
    Ok(Some(id))
}

fn restore_from_trash(state: &crate::AppState, trash_id: &str) -> Result<(), ApiError> {
    let record = load_record(state, trash_id)?;
    if record.trash_path.symlink_metadata().is_err() {
        let _ = state.state.delete_trash_entry(trash_id);
        return Err(ApiError::bad_request("trashed item no longer exists"));
    }
    let original = PathBuf::from(&record.original_path);
    let parent = original
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    fs::create_dir_all(&parent).map_err(ApiError::from_io)?;
    let destination = conflict_free_destination(&parent, &record.name)?;
    move_path(&record.trash_path, &destination)?;
    state
        .state
        .delete_trash_entry(trash_id)
        .map_err(internal_error)?;
    Ok(())
}

fn permanent_delete(state: &crate::AppState, trash_id: &str) -> Result<(), ApiError> {
    let record = load_record(state, trash_id)?;
    remove_path_tree(&record.trash_path)?;
    state
        .state
        .delete_trash_entry(trash_id)
        .map_err(internal_error)?;
    Ok(())
}

fn empty_trash(state: &crate::AppState) -> Result<(), ApiError> {
    let records = state.state.list_trash_entries().map_err(internal_error)?;
    let mut first_error = None;
    for record in records {
        if let Err(error) = remove_path_tree(&record.trash_path) {
            if first_error.is_none() {
                first_error = Some(error);
            }
            continue;
        }
        state
            .state
            .delete_trash_entry(&record.id)
            .map_err(internal_error)?;
    }
    first_error.map_or(Ok(()), Err)
}

fn load_record(state: &crate::AppState, trash_id: &str) -> Result<TrashRecord, ApiError> {
    state
        .state
        .get_trash_entry(trash_id)
        .map_err(internal_error)?
        .ok_or_else(|| ApiError::bad_request("unknown trash entry"))
}

fn absolute_candidate(context: &FsContext, requested: &str) -> PathBuf {
    let requested = Path::new(requested);
    if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        context.fs_root.join(requested)
    }
}

fn ensure_trash_dir(trash_dir: &Path) -> Result<(), ApiError> {
    fs::create_dir_all(trash_dir).map_err(ApiError::from_io)
}

fn conflict_free_destination(parent: &Path, name: &str) -> Result<PathBuf, ApiError> {
    let direct = parent.join(name);
    if path_is_available(&direct)? {
        return Ok(direct);
    }
    let file_name = Path::new(name);
    let stem = file_name
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = file_name
        .extension()
        .map(|extension| extension.to_string_lossy().into_owned());
    for counter in 1..u32::MAX {
        let candidate = match &extension {
            Some(extension) => format!("{stem} ({counter}).{extension}"),
            None => format!("{stem} ({counter})"),
        };
        let candidate_path = parent.join(candidate);
        if path_is_available(&candidate_path)? {
            return Ok(candidate_path);
        }
    }
    Err(ApiError::conflict("no free destination name"))
}

fn path_is_available(path: &Path) -> Result<bool, ApiError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(false),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(ApiError::from_io(error)),
    }
}

fn kind_string(file_type: &std::fs::FileType) -> String {
    if file_type.is_symlink() {
        "symlink"
    } else if file_type.is_dir() {
        "dir"
    } else {
        "file"
    }
    .to_string()
}

fn display_path(root: &Path, relative: &Path) -> PathBuf {
    if relative == Path::new(".") {
        root.to_path_buf()
    } else {
        root.join(relative)
    }
}

/// Moves `source` to `destination`, falling back to copy+remove across devices.
fn move_path(source: &Path, destination: &Path) -> Result<(), ApiError> {
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(EXDEV) => {
            copy_path_tree(source, destination)?;
            remove_path_tree(source)?;
            Ok(())
        }
        Err(error) => Err(ApiError::from_io(error)),
    }
}

pub(crate) fn copy_path_tree(source: &Path, destination: &Path) -> Result<(), ApiError> {
    let metadata = match fs::symlink_metadata(source) {
        Ok(metadata) => metadata,
        Err(error) => return Err(ApiError::from_io(error)),
    };
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        let target = fs::read_link(source).map_err(ApiError::from_io)?;
        symlink(target, destination).map_err(ApiError::from_io)?;
    } else if file_type.is_dir() {
        fs::create_dir_all(destination).map_err(ApiError::from_io)?;
        for entry in fs::read_dir(source).map_err(ApiError::from_io)? {
            let entry = entry.map_err(ApiError::from_io)?;
            copy_path_tree(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(ApiError::from_io)?;
        }
        fs::copy(source, destination).map_err(ApiError::from_io)?;
    }
    if !file_type.is_symlink() {
        fs::set_permissions(
            destination,
            fs::Permissions::from_mode(metadata.permissions().mode()),
        )
        .map_err(ApiError::from_io)?;
    }
    Ok(())
}

pub(crate) fn remove_path_tree(path: &Path) -> Result<(), ApiError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(ApiError::from_io(error)),
    };
    if metadata.file_type().is_dir() {
        fs::remove_dir_all(path).map_err(ApiError::from_io)
    } else {
        fs::remove_file(path).map_err(ApiError::from_io)
    }
}
pub(crate) fn purge_expired(store: &Store, cutoff: DateTime<Utc>) -> usize {
    let Ok(records) = store.list_trash_entries() else {
        tracing::warn!("trash purge could not read expired entries");
        return 0;
    };
    let mut purged = 0;
    for record in records
        .into_iter()
        .filter(|record| record.deleted_at < cutoff)
    {
        if let Err(error) = remove_path_tree(&record.trash_path) {
            tracing::warn!(
                error = error.message(),
                path = %record.trash_path.display(),
                "failed to purge trashed item"
            );
            continue;
        }
        if store.delete_trash_entry(&record.id).is_ok() {
            purged += 1;
        }
    }
    purged
}

pub(crate) fn spawn_sweep(store: Store) {
    std::thread::Builder::new()
        .name("trash-sweep".into())
        .spawn(move || {
            loop {
                purge_expired(&store, Utc::now() - chrono::Duration::days(PURGE_AGE_DAYS));
                std::thread::sleep(SWEEP_INTERVAL);
            }
        })
        .expect("failed to spawn trash sweep thread");
}
