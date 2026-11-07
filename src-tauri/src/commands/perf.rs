//! Commands only the perf harness uses. They compile with `--features perf`, which `pnpm perf`
//! turns on, so a shipped build holds none of this.

use crate::error::AppError;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static STARTED_MS: OnceLock<u64> = OnceLock::new();

/// Wall-clock milliseconds since the Unix epoch. The harness, Rust and the page share this clock.
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

/// Records when Rust first ran. Call it as early as possible in `run`.
pub(crate) fn mark_started() {
    STARTED_MS.get_or_init(now_ms);
}

/// What the harness asked this run to do, read from the environment it launched us with.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PerfConfig {
    scenario: String,
    fixtures_dir: String,
    /// JSON text from the harness; the page parses it.
    params: String,
    rust_started_ms: u64,
}

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

#[tauri::command]
pub(crate) fn perf_config() -> PerfConfig {
    PerfConfig {
        scenario: env("MDMATE_PERF_SCENARIO"),
        fixtures_dir: env("MDMATE_PERF_FIXTURES"),
        params: env("MDMATE_PERF_PARAMS"),
        rust_started_ms: STARTED_MS.get().copied().unwrap_or(0),
    }
}

/// Writes the page's result where the harness said, then quits. The path comes from the
/// environment and never from the page, so the page cannot choose where to write.
#[tauri::command]
pub(crate) async fn perf_report(app: tauri::AppHandle, json: String) -> Result<(), AppError> {
    let out = std::env::var_os("MDMATE_PERF_OUT")
        .map(PathBuf::from)
        .ok_or_else(|| AppError::Task("MDMATE_PERF_OUT is not set".into()))?;
    tauri::async_runtime::spawn_blocking(move || std::fs::write(out, json))
        .await
        .map_err(|error| AppError::Task(error.to_string()))??;
    app.exit(0);
    Ok(())
}
