use tracing_subscriber::{fmt, EnvFilter};

use super::paths;

/// Initialise the global tracing subscriber.
///
/// The log level is controlled by the `PERICODE_LOG` environment variable
/// (accepts standard `tracing` directives such as `debug`, `pericode=trace`,
/// etc.). When the variable is absent the default level is `info`.
///
/// Logs are written to stderr so they do not interfere with any structured
/// output on stdout.
pub fn init_logger() {
    let log_dir = paths::get_logs_path();
    // Best-effort: create the logs directory if it doesn't exist yet.
    let _ = std::fs::create_dir_all(&log_dir);

    let env_filter = EnvFilter::try_from_env("PERICODE_LOG")
        .unwrap_or_else(|_| EnvFilter::new("info"));

    fmt()
        .with_env_filter(env_filter)
        .with_target(true)
        .with_thread_ids(false)
        .with_thread_names(false)
        .with_file(false)
        .with_line_number(false)
        .with_ansi(true)
        .init();

    tracing::info!(log_dir = %log_dir.display(), "logger initialised");
}
