use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),
    #[error("Request error: {0}")]
    Request(#[from] reqwest::Error),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    #[error("Agent error: {0}")]
    Agent(String),
    #[error("{0}")]
    Other(String),
}

// Make AppError serializable for Tauri commands
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::Serializer {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        // Try downcasting to known error types, consuming the anyhow::Error
        match err.downcast::<rusqlite::Error>() {
            Ok(e) => return AppError::Database(e),
            Err(err) => match err.downcast::<std::io::Error>() {
                Ok(e) => return AppError::Io(e),
                Err(err) => match err.downcast::<serde_json::Error>() {
                    Ok(e) => return AppError::Json(e),
                    Err(err) => AppError::Other(err.to_string()),
                },
            },
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
