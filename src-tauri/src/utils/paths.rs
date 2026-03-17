use std::path::PathBuf;

const APP_IDENTIFIER: &str = "com.pericode.app";
const DATABASE_NAME: &str = "pericode.db";
const SKILLS_DIR: &str = "skills";
const LOGS_DIR: &str = "logs";
const WORKTREE_DIR: &str = ".pericode-worktrees";

/// Returns the platform-specific application data directory.
///
/// - Linux:   `~/.local/share/com.pericode.app`
/// - macOS:   `~/Library/Application Support/com.pericode.app`
/// - Windows: `C:\Users\<user>\AppData\Roaming\com.pericode.app`
pub fn get_app_data_path() -> PathBuf {
    dirs::data_dir()
        .expect("failed to resolve platform data directory")
        .join(APP_IDENTIFIER)
}

/// Returns the path to the SQLite database file.
pub fn get_database_path() -> PathBuf {
    get_app_data_path().join(DATABASE_NAME)
}

/// Returns the path to the skills directory.
pub fn get_skills_path() -> PathBuf {
    get_app_data_path().join(SKILLS_DIR)
}

/// Returns the path to the logs directory.
pub fn get_logs_path() -> PathBuf {
    get_app_data_path().join(LOGS_DIR)
}

/// Returns the worktree base path for a given project.
///
/// The worktree directory sits inside the project root so that
/// git operations can discover it relative to the repository.
pub fn get_worktree_base_path(project_path: &str) -> PathBuf {
    PathBuf::from(project_path).join(WORKTREE_DIR)
}

/// Ensure all core application directories exist on disk.
/// Call this once during application startup.
pub fn ensure_directories() -> std::io::Result<()> {
    std::fs::create_dir_all(get_app_data_path())?;
    std::fs::create_dir_all(get_skills_path())?;
    std::fs::create_dir_all(get_logs_path())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_data_path_ends_with_identifier() {
        let path = get_app_data_path();
        assert!(path.ends_with(APP_IDENTIFIER));
    }

    #[test]
    fn database_path_ends_with_db_file() {
        let path = get_database_path();
        assert_eq!(path.file_name().unwrap(), DATABASE_NAME);
    }

    #[test]
    fn worktree_path_is_inside_project() {
        let path = get_worktree_base_path("/tmp/my-project");
        assert_eq!(path, PathBuf::from("/tmp/my-project/.pericode-worktrees"));
    }
}
