use std::fs;
use std::path::Path;

use anyhow::{bail, Result};

/// Search and replace text in a file.
///
/// * `file_path` - Path to the file (absolute or relative to `cwd`).
/// * `old_string` - The exact string to search for.
/// * `new_string` - The replacement string.
/// * `replace_all` - If true, replace all occurrences; otherwise replace
///   exactly one (and error if the match is ambiguous).
/// * `cwd` - Current working directory for resolving relative paths.
///
/// Returns the number of replacements made.
pub fn edit_tool(
    file_path: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
    cwd: &str,
) -> Result<usize> {
    let path = if Path::new(file_path).is_absolute() {
        file_path.to_string()
    } else {
        Path::new(cwd).join(file_path).to_string_lossy().to_string()
    };

    if !Path::new(&path).exists() {
        bail!("File not found: {}", path);
    }

    let content = fs::read_to_string(&path)?;

    // Count occurrences
    let match_count = content.matches(old_string).count();

    if match_count == 0 {
        let preview = if old_string.len() > 50 {
            format!("{}...", &old_string[..50])
        } else {
            old_string.to_string()
        };
        bail!("String not found in file: \"{}\"", preview);
    }

    if !replace_all && match_count > 1 {
        let preview = if old_string.len() > 50 {
            format!("{}...", &old_string[..50])
        } else {
            old_string.to_string()
        };
        bail!(
            "String \"{}\" found {} times. Use replace_all=true to replace all, \
             or provide more context to make it unique.",
            preview,
            match_count
        );
    }

    let new_content = if replace_all {
        content.replace(old_string, new_string)
    } else {
        content.replacen(old_string, new_string, 1)
    };

    fs::write(&path, new_content)?;

    let replacements = if replace_all { match_count } else { 1 };
    Ok(replacements)
}
