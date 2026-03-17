use std::fs;
use std::path::Path;

use anyhow::Result;
use ignore::WalkBuilder;
use regex::Regex;

/// Maximum number of files to search.
const MAX_FILES: usize = 1000;
/// Maximum file size to search (1 MB).
const MAX_FILE_SIZE: u64 = 1_024 * 1_024;

/// A single grep match entry.
pub struct GrepMatch {
    pub file: String,
    pub line: usize,
    pub content: String,
}

/// Result of a grep search.
pub struct GrepResult {
    pub matches: Vec<GrepMatch>,
    pub file_count: usize,
    pub match_count: usize,
}

/// Search for text in files using regex.
///
/// * `pattern` - Regular expression pattern to search for.
/// * `path` - Optional file or directory to search in (absolute or relative to `cwd`).
/// * `glob_filter` - Optional glob pattern to filter files (e.g., `"*.ts"`).
/// * `context` - Number of context lines around each match (for "content" mode).
/// * `output_mode` - One of "content", "files_with_matches", or "count".
/// * `cwd` - Current working directory for resolving relative paths.
pub fn grep_tool(
    pattern: &str,
    path: Option<&str>,
    glob_filter: Option<&str>,
    context: Option<usize>,
    output_mode: &str,
    cwd: &str,
) -> Result<GrepResult> {
    let base_path = match path {
        Some(p) if Path::new(p).is_absolute() => p.to_string(),
        Some(p) => Path::new(cwd).join(p).to_string_lossy().to_string(),
        None => cwd.to_string(),
    };

    let re = Regex::new(pattern)?;
    let context = context.unwrap_or(0);

    let mut matches = Vec::new();
    let mut matched_files = std::collections::HashSet::new();
    let mut total_matches: usize = 0;

    // If the base path is a file, search just that file
    let base = Path::new(&base_path);
    if base.is_file() {
        search_file(
            &base_path,
            &re,
            context,
            output_mode,
            &mut matches,
            &mut matched_files,
            &mut total_matches,
        );

        return Ok(GrepResult {
            matches,
            file_count: matched_files.len(),
            match_count: total_matches,
        });
    }

    // Walk directory tree using the `ignore` crate (respects .gitignore etc.)
    let mut builder = WalkBuilder::new(&base_path);
    builder
        .hidden(true)       // skip hidden files
        .max_depth(Some(15))
        .follow_links(false);

    // Standard ignore patterns
    builder.filter_entry(|entry| {
        let name = entry.file_name().to_string_lossy();
        !(name == "node_modules"
            || name == "__pycache__"
            || name == "dist"
            || name == "build")
    });

    let files: Vec<String> = builder
        .build()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|ft| ft.is_file()).unwrap_or(false))
        .filter(|entry| {
            // Apply glob filter if specified
            if let Some(glob) = glob_filter {
                let name = entry.file_name().to_string_lossy();
                let glob_ext = glob.replace('*', "");
                name.ends_with(&glob_ext) || glob.contains("*.*")
            } else {
                true
            }
        })
        .filter(|entry| {
            // Skip files that are too large
            entry
                .metadata()
                .map(|m| m.len() <= MAX_FILE_SIZE)
                .unwrap_or(false)
        })
        .map(|entry| entry.path().to_string_lossy().to_string())
        .take(MAX_FILES)
        .collect();

    for file in &files {
        search_file(
            file,
            &re,
            context,
            output_mode,
            &mut matches,
            &mut matched_files,
            &mut total_matches,
        );
    }

    Ok(GrepResult {
        matches,
        file_count: matched_files.len(),
        match_count: total_matches,
    })
}

/// Search a single file for matches.
fn search_file(
    file_path: &str,
    re: &Regex,
    context: usize,
    output_mode: &str,
    matches: &mut Vec<GrepMatch>,
    matched_files: &mut std::collections::HashSet<String>,
    total_matches: &mut usize,
) {
    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return, // Skip unreadable files
    };

    let lines: Vec<&str> = content.split('\n').collect();
    let mut file_matched = false;

    for (i, line) in lines.iter().enumerate() {
        if re.is_match(line) {
            *total_matches += 1;
            file_matched = true;

            if output_mode == "content" {
                let mut match_entry = GrepMatch {
                    file: file_path.to_string(),
                    line: i + 1,
                    content: line.to_string(),
                };

                // Add context lines if requested
                if context > 0 {
                    let start = i.saturating_sub(context);
                    let end = std::cmp::min(lines.len(), i + context + 1);
                    let context_str: Vec<String> = (start..end)
                        .filter(|&j| j != i)
                        .map(|j| format!("{}: {}", j + 1, lines[j]))
                        .collect();
                    if !context_str.is_empty() {
                        match_entry.content =
                            format!("{}\n{}", match_entry.content, context_str.join("\n"));
                    }
                }

                matches.push(match_entry);
            }
        }
    }

    // For files_with_matches mode, just record the file
    if file_matched {
        matched_files.insert(file_path.to_string());

        if output_mode == "files_with_matches" {
            matches.push(GrepMatch {
                file: file_path.to_string(),
                line: 0,
                content: String::new(),
            });
        }
    }
}
