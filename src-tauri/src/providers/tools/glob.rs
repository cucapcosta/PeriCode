use std::path::Path;

use anyhow::Result;

/// Find files matching a glob pattern.
///
/// * `pattern` - The glob pattern (e.g., `"**/*.ts"`).
/// * `path` - Optional base directory to search in (absolute or relative to `cwd`).
/// * `cwd` - Current working directory for resolving relative paths.
///
/// Returns a sorted `Vec<String>` of matching file paths (newest first).
pub fn glob_tool(
    pattern: &str,
    path: Option<&str>,
    cwd: &str,
) -> Result<Vec<String>> {
    let base_path = match path {
        Some(p) if Path::new(p).is_absolute() => p.to_string(),
        Some(p) => Path::new(cwd).join(p).to_string_lossy().to_string(),
        None => cwd.to_string(),
    };

    let walker = globwalk::GlobWalkerBuilder::from_patterns(&base_path, &[pattern])
        .max_depth(20)
        .follow_links(false)
        .build()?;

    let mut entries: Vec<(String, std::time::SystemTime)> = Vec::new();

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();

        // Skip hidden files/dirs, node_modules, __pycache__
        let skip = path.components().any(|c| {
            let s = c.as_os_str().to_string_lossy();
            s.starts_with('.') || s == "node_modules" || s == "__pycache__"
        });
        if skip {
            continue;
        }

        if path.is_file() {
            let mtime = path
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            entries.push((path.to_string_lossy().to_string(), mtime));
        }
    }

    // Sort by modification time (newest first)
    entries.sort_by(|a, b| b.1.cmp(&a.1));

    let files: Vec<String> = entries.into_iter().map(|(path, _)| path).collect();
    Ok(files)
}
