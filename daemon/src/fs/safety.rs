use std::{
    fs::File,
    io,
    os::fd::{AsFd, AsRawFd, FromRawFd, IntoRawFd, OwnedFd},
    path::{Component, Path, PathBuf},
};

use rustix::fs::{AtFlags, OFlags, ResolveFlags, openat2, statat};

use super::ApiError;

pub(crate) const RESOLVE_SAFE: ResolveFlags =
    ResolveFlags::BENEATH.union(ResolveFlags::NO_SYMLINKS);

pub(crate) fn open_safe(root: &File, path: &Path, flags: OFlags) -> Result<OwnedFd, ApiError> {
    openat2(
        root,
        path,
        flags | OFlags::CLOEXEC,
        rustix::fs::Mode::empty(),
        RESOLVE_SAFE,
    )
    .map_err(ApiError::from_io)
}

pub(crate) fn relative_path(root: &Path, requested: &str) -> Result<PathBuf, ApiError> {
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

pub(crate) fn reject_root(path: &Path) -> Result<(), ApiError> {
    if path == Path::new(".") {
        Err(ApiError::forbidden("the allowed root cannot be modified"))
    } else {
        Ok(())
    }
}

pub(crate) fn validate_final_name(path: &Path) -> Result<(), ApiError> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| ApiError::bad_request("path must have a valid final component"))?;
    validate_name(name)
}

pub(crate) fn validate_name(name: &str) -> Result<(), ApiError> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\0') {
        Err(ApiError::bad_request("invalid file name"))
    } else {
        Ok(())
    }
}

pub(crate) fn reject_collision(dir: &impl AsFd, path: &Path) -> Result<(), ApiError> {
    match statat(dir, path, AtFlags::SYMLINK_NOFOLLOW) {
        Ok(_) => Err(ApiError::conflict("destination already exists")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ApiError::from_io(error)),
    }
}

pub(crate) fn file_from_fd(fd: OwnedFd) -> File {
    // OwnedFd guarantees unique ownership of a valid descriptor.
    unsafe { File::from_raw_fd(fd.into_raw_fd()) }
}

pub(crate) fn fd_path(fd: &impl AsFd) -> PathBuf {
    PathBuf::from(format!("/proc/self/fd/{}", fd.as_fd().as_raw_fd()))
}
