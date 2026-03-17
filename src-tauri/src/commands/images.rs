use tauri::AppHandle;

use crate::db::models::ImageAttachment;
use crate::utils::paths::get_app_data_path;

// ── Commands ──────────────────────────────────────────────────

/// Open a native file picker to select images.
#[tauri::command]
pub async fn image_pick(app_handle: AppHandle) -> Result<Option<Vec<ImageAttachment>>, String> {
    use tauri_plugin_dialog::DialogExt;

    let files = app_handle
        .dialog()
        .file()
        .set_title("Select Images")
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .blocking_pick_files();

    let files = match files {
        Some(f) => f,
        None => return Ok(None),
    };

    let mut attachments = Vec::new();

    for file_path in &files {
        let path = match file_path.as_path() {
            Some(p) => p,
            None => continue,
        };
        let path_str = path.to_string_lossy().to_string();

        if let Some(attachment) = build_image_attachment(&path_str) {
            attachments.push(attachment);
        }
    }

    if attachments.is_empty() {
        Ok(None)
    } else {
        Ok(Some(attachments))
    }
}

/// Read a file and return its contents as a base64-encoded string.
#[tauri::command]
pub fn image_read_base64(file_path: String) -> Result<Option<String>, String> {
    use base64::Engine;

    let data = match std::fs::read(&file_path) {
        Ok(d) => d,
        Err(_) => return Ok(None),
    };

    let encoded = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(Some(encoded))
}

/// Validate that a path points to an existing image file.
#[tauri::command]
pub fn image_validate_path(file_path: String) -> Result<bool, String> {
    let path = std::path::Path::new(&file_path);

    if !path.exists() || !path.is_file() {
        return Ok(false);
    }

    let valid_extensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    Ok(valid_extensions.contains(&ext.as_str()))
}

/// Save image data from the clipboard to a temporary file.
#[tauri::command]
pub fn image_save_from_clipboard() -> Result<Option<ImageAttachment>, String> {
    // Clipboard image handling requires platform-specific code.
    // For now, we return None indicating no clipboard image available.
    // A full implementation would use arboard or tauri-plugin-clipboard-manager.
    //
    // TODO: Implement clipboard image capture using tauri-plugin-clipboard-manager
    Ok(None)
}

/// Save an image from a base64 data URL to a temporary file.
#[tauri::command]
pub fn image_save_from_base64(
    data_url: String,
    mime_type: String,
) -> Result<Option<ImageAttachment>, String> {
    use base64::Engine;

    // Strip the data URL prefix if present (e.g., "data:image/png;base64,...")
    let base64_data = if let Some(pos) = data_url.find(",") {
        &data_url[pos + 1..]
    } else {
        &data_url
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;

    // Determine file extension from MIME type
    let ext = match mime_type.as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "png",
    };

    let images_dir = get_app_data_path().join("images");
    std::fs::create_dir_all(&images_dir)
        .map_err(|e| format!("Failed to create images directory: {}", e))?;

    let file_name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    let file_path = images_dir.join(&file_name);
    let file_path_str = file_path.to_string_lossy().to_string();

    std::fs::write(&file_path, &bytes)
        .map_err(|e| format!("Failed to write image: {}", e))?;

    // Generate a small thumbnail (just use the first chunk of base64 as a preview)
    let thumbnail = base64::engine::general_purpose::STANDARD.encode(
        &bytes[..bytes.len().min(4096)],
    );

    Ok(Some(ImageAttachment {
        file_path: file_path_str,
        file_name,
        mime_type,
        size_bytes: bytes.len() as u64,
        base64_thumbnail: thumbnail,
    }))
}

// ── Helpers ───────────────────────────────────────────────────

/// Build an ImageAttachment from a file path.
fn build_image_attachment(path: &str) -> Option<ImageAttachment> {
    use base64::Engine;

    let path_obj = std::path::Path::new(path);
    let metadata = std::fs::metadata(path).ok()?;
    let file_name = path_obj
        .file_name()?
        .to_string_lossy()
        .to_string();

    let ext = path_obj
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let mime_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    };

    // Read a small portion for the thumbnail
    let data = std::fs::read(path).ok()?;
    let thumbnail = base64::engine::general_purpose::STANDARD.encode(
        &data[..data.len().min(4096)],
    );

    Some(ImageAttachment {
        file_path: path.to_string(),
        file_name,
        mime_type: mime_type.to_string(),
        size_bytes: metadata.len(),
        base64_thumbnail: thumbnail,
    })
}
