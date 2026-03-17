use std::fs;
use std::path::Path;

use anyhow::{bail, Result};

/// Read file contents, returning numbered lines.
///
/// * `file_path` - Path to the file (absolute or relative to `cwd`).
/// * `cwd` - Current working directory for resolving relative paths.
/// * `offset` - Zero-indexed line to start reading from.
/// * `limit` - Maximum number of lines to return.
///
/// Returns a string with `cat -n` style numbered output.
pub fn read_tool(
    file_path: &str,
    cwd: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<String> {
    let path = if Path::new(file_path).is_absolute() {
        file_path.to_string()
    } else {
        Path::new(cwd).join(file_path).to_string_lossy().to_string()
    };

    let p = Path::new(&path);

    if !p.exists() {
        bail!("File not found: {}", path);
    }
    if p.is_dir() {
        bail!("Path is a directory, not a file: {}", path);
    }

    let content = fs::read_to_string(&path)?;
    let lines: Vec<&str> = content.split('\n').collect();

    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(lines.len());

    let end = std::cmp::min(offset + limit, lines.len());
    let selected = &lines[offset..end];

    // Format with line numbers (1-indexed)
    let numbered: Vec<String> = selected
        .iter()
        .enumerate()
        .map(|(i, line)| {
            let line_num = offset + i + 1;
            format!("{:>6}\t{}", line_num, line)
        })
        .collect();

    Ok(numbered.join("\n"))
}
