use std::path::Path;

use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::error::{AppError, AppResult};

// ── Types ──────────────────────────────────────────────────

/// Parsed skill definition from a SKILL.md file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedSkillDefinition {
    pub name: String,
    pub description: String,
    pub model: Option<String>,
    pub tools: Option<Vec<String>>,
    pub max_budget_usd: Option<f64>,
    pub instructions: String,
    pub raw_content: String,
}

/// Entry found when scanning a skills directory.
#[derive(Debug, Clone)]
pub struct ScannedSkill {
    pub dir_name: String,
    pub path: String,
    pub parsed: ParsedSkillDefinition,
}

// ── Public API ─────────────────────────────────────────────

/// Parse a SKILL.md file content into a structured skill definition.
///
/// Expected format:
/// ```text
/// ---
/// name: Skill Name
/// description: >
///     Multi-line description
/// model: sonnet
/// tools:
///     - Read
///     - Grep
/// max_budget_usd: 0.50
/// ---
///
/// ## Instructions
/// ...body content...
/// ```
pub fn parse_skill_md(content: &str) -> AppResult<ParsedSkillDefinition> {
    let trimmed = content.trim();

    if !trimmed.starts_with("---") {
        return Err(AppError::InvalidInput(
            "SKILL.md must start with --- frontmatter delimiter".into(),
        ));
    }

    let second_delimiter = trimmed[3..].find("---");
    let second_delimiter = match second_delimiter {
        Some(pos) => pos + 3,
        None => {
            return Err(AppError::InvalidInput(
                "SKILL.md missing closing --- frontmatter delimiter".into(),
            ));
        }
    };

    let frontmatter = trimmed[3..second_delimiter].trim();
    let body = trimmed[second_delimiter + 3..].trim();

    let parsed = parse_simple_yaml(frontmatter);

    let name = parsed
        .get("name")
        .and_then(|v| match v {
            YamlValue::Scalar(s) => Some(s.clone()),
            _ => None,
        })
        .ok_or_else(|| {
            AppError::InvalidInput("SKILL.md frontmatter must include 'name'".into())
        })?;

    let description = parsed
        .get("description")
        .and_then(|v| match v {
            YamlValue::Scalar(s) => Some(s.clone()),
            _ => None,
        })
        .unwrap_or_default();

    let model = parsed.get("model").and_then(|v| match v {
        YamlValue::Scalar(s) => Some(s.clone()),
        _ => None,
    });

    let tools = parsed.get("tools").and_then(|v| match v {
        YamlValue::List(items) => Some(items.clone()),
        YamlValue::Scalar(s) => Some(vec![s.clone()]),
    });

    let max_budget_usd = parsed
        .get("max_budget_usd")
        .and_then(|v| match v {
            YamlValue::Scalar(s) => s.parse::<f64>().ok(),
            _ => None,
        })
        .filter(|v| v.is_finite());

    Ok(ParsedSkillDefinition {
        name,
        description,
        model,
        tools,
        max_budget_usd,
        instructions: body.to_string(),
        raw_content: content.to_string(),
    })
}

/// Load and parse a SKILL.md file from disk.
pub fn load_skill_file(file_path: &str) -> Option<ParsedSkillDefinition> {
    let path = Path::new(file_path);
    if !path.exists() {
        return None;
    }

    match std::fs::read_to_string(path) {
        Ok(content) => match parse_skill_md(&content) {
            Ok(parsed) => Some(parsed),
            Err(e) => {
                warn!(target: "skill-parser", "Failed to parse {}: {}", file_path, e);
                None
            }
        },
        Err(e) => {
            warn!(target: "skill-parser", "Failed to read {}: {}", file_path, e);
            None
        }
    }
}

/// Write a skill definition to a SKILL.md file.
pub fn write_skill_file(dir_path: &str, definition: &ParsedSkillDefinition) {
    let dir = Path::new(dir_path);
    if !dir.exists() {
        let _ = std::fs::create_dir_all(dir);
    }

    let mut frontmatter = format!("---\nname: {}\n", definition.name);
    frontmatter.push_str(&format!("description: >\n  {}\n", definition.description));

    if let Some(ref model) = definition.model {
        frontmatter.push_str(&format!("model: {}\n", model));
    }

    if let Some(ref tools) = definition.tools {
        if !tools.is_empty() {
            frontmatter.push_str("tools:\n");
            for tool in tools {
                frontmatter.push_str(&format!("  - {}\n", tool));
            }
        }
    }

    if let Some(budget) = definition.max_budget_usd {
        frontmatter.push_str(&format!("max_budget_usd: {}\n", budget));
    }

    frontmatter.push_str("---\n\n");

    let content = format!("{}{}", frontmatter, definition.instructions);
    let file_path = dir.join("SKILL.md");
    let _ = std::fs::write(file_path, content);
}

/// Scan a directory for SKILL.md files (one level deep).
///
/// Returns an array of scanned skills for each subdirectory containing
/// a valid SKILL.md file.
pub fn scan_skills_directory(base_path: &str) -> Vec<ScannedSkill> {
    let base = Path::new(base_path);
    if !base.exists() {
        return Vec::new();
    }

    let entries = match std::fs::read_dir(base) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut results = Vec::new();

    for entry in entries.flatten() {
        if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            continue;
        }

        let dir_name = entry.file_name().to_string_lossy().to_string();
        let skill_file = entry.path().join("SKILL.md");
        let skill_file_str = skill_file.to_string_lossy().to_string();

        if let Some(parsed) = load_skill_file(&skill_file_str) {
            results.push(ScannedSkill {
                dir_name,
                path: entry.path().to_string_lossy().to_string(),
                parsed,
            });
        }
    }

    results
}

// ── Simple YAML parser (internal) ──────────────────────────

#[derive(Debug, Clone)]
enum YamlValue {
    Scalar(String),
    List(Vec<String>),
}

fn parse_simple_yaml(yaml: &str) -> std::collections::HashMap<String, YamlValue> {
    let mut result = std::collections::HashMap::new();
    let lines: Vec<&str> = yaml.lines().collect();
    let mut current_key = String::new();
    let mut current_value = String::new();
    let mut in_multiline = false;
    let mut in_list = false;
    let mut list_items: Vec<String> = Vec::new();

    for line in &lines {
        let trimmed = line.trim();

        if in_list {
            if let Some(item) = trimmed.strip_prefix("- ") {
                list_items.push(item.trim().to_string());
                continue;
            } else {
                // End of list
                result.insert(current_key.clone(), YamlValue::List(list_items.clone()));
                in_list = false;
                list_items.clear();
            }
        }

        if in_multiline {
            if trimmed.is_empty()
                || (!line.starts_with(' ')
                    && !line.starts_with('\t')
                    && trimmed.contains(':'))
            {
                // End of multiline
                result.insert(
                    current_key.clone(),
                    YamlValue::Scalar(current_value.trim().to_string()),
                );
                in_multiline = false;
            } else {
                current_value.push(' ');
                current_value.push_str(trimmed);
                continue;
            }
        }

        // Parse key: value
        if let Some(colon_idx) = trimmed.find(':') {
            if colon_idx > 0 {
                current_key = trimmed[..colon_idx].trim().to_string();
                let value = trimmed[colon_idx + 1..].trim().to_string();

                if value == ">" || value == "|" {
                    in_multiline = true;
                    current_value = String::new();
                } else if value.is_empty() {
                    // Could be start of a list
                    in_list = true;
                    list_items = Vec::new();
                } else {
                    result.insert(current_key.clone(), YamlValue::Scalar(value));
                }
            }
        }
    }

    // Handle trailing values
    if in_multiline && !current_key.is_empty() {
        result.insert(
            current_key.clone(),
            YamlValue::Scalar(current_value.trim().to_string()),
        );
    } else if in_list && !current_key.is_empty() {
        result.insert(current_key.clone(), YamlValue::List(list_items));
    }

    result
}
