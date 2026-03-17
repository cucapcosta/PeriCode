use std::fs;
use std::path::Path;

use anyhow::Result;

/// Write content to a file, creating parent directories as needed.
///
/// * `file_path` - Path to the file (absolute or relative to `cwd`).
/// * `content` - The content to write.
/// * `cwd` - Current working directory for resolving relative paths.
///
/// Returns the number of bytes written.
pub fn write_tool(
    file_path: &str,
    content: &str,
    cwd: &str,
) -> Result<usize> {
    let path = if Path::new(file_path).is_absolute() {
        file_path.to_string()
    } else {
        Path::new(cwd).join(file_path).to_string_lossy().to_string()
    };

    // Ensure parent directory exists
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)?;
        }
    }

    fs::write(&path, content)?;

    Ok(content.len())
}
