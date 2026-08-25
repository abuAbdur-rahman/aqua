use std::path::{Path, PathBuf};

use image::imageops::FilterType;

const THUMBNAIL_WIDTH: u32 = 480;

pub(crate) struct StoredWallpaper {
    pub(crate) path: PathBuf,
    pub(crate) thumb_path: PathBuf,
}

/// Decode the uploaded bytes as an image and write it back in its original
/// format alongside a fixed-width PNG thumbnail. Decoding first guarantees the
/// stored file is a real image rather than arbitrary bytes.
pub(crate) fn store(directory: &Path, id: &str, bytes: &[u8]) -> Result<StoredWallpaper, String> {
    let decoded = image::load_from_memory(bytes)
        .map_err(|error| format!("not a supported image: {error}"))?;
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("create wallpaper directory: {error}"))?;

    let extension = match image::guess_format(bytes) {
        Ok(image::ImageFormat::Png) => "png",
        Ok(image::ImageFormat::Jpeg) => "jpg",
        Ok(image::ImageFormat::WebP) => "webp",
        Ok(other) => return Err(format!("unsupported wallpaper format: {other:?}")),
        Err(error) => return Err(format!("cannot detect image format: {error}")),
    };

    let path = directory.join(format!("{id}.{extension}"));
    std::fs::write(&path, bytes).map_err(|error| format!("store wallpaper: {error}"))?;

    let thumb_path = directory.join(format!("{id}.thumb.png"));
    if let Err(error) = write_thumbnail(&decoded, &thumb_path) {
        let _ = std::fs::remove_file(&path);
        return Err(error);
    }

    Ok(StoredWallpaper { path, thumb_path })
}

fn write_thumbnail(image: &image::DynamicImage, thumb_path: &Path) -> Result<(), String> {
    let scale = THUMBNAIL_WIDTH as f32 / image.width().max(1) as f32;
    let height = ((image.height() as f32 * scale).round() as u32).max(1);
    let thumbnail = image.resize_exact(THUMBNAIL_WIDTH, height, FilterType::Triangle);
    thumbnail
        .save_with_format(thumb_path, image::ImageFormat::Png)
        .map_err(|error| format!("store thumbnail: {error}"))
}

pub(crate) fn remove_files(path: &Path, thumb_path: &Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(thumb_path);
}
