//! Commands only the perf harness uses. They compile with `--features perf`, which `pnpm perf`
//! turns on, so a shipped build holds none of this.

use crate::documents::AppState;
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

/// The harness reads fixtures by path, so its fixtures folder counts as an open workspace. Only a
/// perf build does this, and the folder comes from the environment the harness launched us with.
pub(crate) fn allow_fixtures(state: &AppState) {
    if let Some(dir) = std::env::var_os("MDMATE_PERF_FIXTURES") {
        // A missing folder just leaves the harness unable to read fixtures, which it will report.
        // Access only: the harness's fixtures folder holds a generated workspace of thousands of
        // files, and indexing it in every run would put a walk under scenarios that do not ask
        // for one. A scenario that wants a folder indexed grants it with `perf_grant_root`.
        let _ = state.access().grant_root(std::path::Path::new(&dir));
    }
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

/// Like `perf_report`, but the app keeps running, so a harness can kill it where it stands. The
/// crash-restore scenario reports here once its edits are journaled.
#[tauri::command]
pub(crate) async fn perf_ready(json: String) -> Result<(), AppError> {
    let out = std::env::var_os("MDMATE_PERF_OUT")
        .map(PathBuf::from)
        .ok_or_else(|| AppError::Task("MDMATE_PERF_OUT is not set".into()))?;
    tauri::async_runtime::spawn_blocking(move || std::fs::write(out, json))
        .await
        .map_err(|error| AppError::Task(error.to_string()))??;
    Ok(())
}

/// Lets the page open a file without the native dialog, which no harness can drive. The path comes
/// from whoever launched the perf build and is the only thing it gains access to.
#[tauri::command]
pub(crate) fn perf_grant_file(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    path: String,
) -> Result<(), AppError> {
    state.access().grant_file(std::path::Path::new(&path))?;
    Ok(())
}

/// Makes a folder a workspace root without the native dialog, so a perf scenario can run a rewrite
/// scan over it. The path comes from whoever launched the perf build.
#[tauri::command]
pub(crate) fn perf_grant_root(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    path: String,
) -> Result<(), AppError> {
    crate::workspace::roots::grant(&state, std::path::Path::new(&path))?;
    Ok(())
}

/// What the index held when it went quiet.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IndexIdle {
    /// Files held across every root.
    files: usize,
    /// How long this call waited, in milliseconds.
    waited_ms: u64,
}

/// Waits until the workspace index has nothing left to read, and says how many files it holds. A
/// scenario calls it after `perf_grant_root` to time a first index, or after
/// `perf_index_reconcile` to time a reconcile.
#[tauri::command]
pub(crate) async fn perf_index_idle(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
) -> Result<IndexIdle, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started = std::time::Instant::now();
        let limit = std::time::Duration::from_secs(900);
        while state.index().status().indexing {
            if started.elapsed() > limit {
                return Err(AppError::Task(
                    "the index did not go quiet in 15 minutes".into(),
                ));
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        Ok(IndexIdle {
            files: state.index().file_count(),
            waited_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        })
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

/// How the index stands right now, without waiting.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IndexNow {
    files: usize,
    indexing: bool,
    /// Walks the index has finished, and the milliseconds it has spent walking so far.
    walks: u64,
    walking_ms: f64,
}

#[tauri::command]
pub(crate) fn perf_index_state(state: tauri::State<'_, std::sync::Arc<AppState>>) -> IndexNow {
    let (walks, walking_ms) = state.index().walk_stats();
    IndexNow {
        files: state.index().file_count(),
        indexing: state.index().status().indexing,
        walks,
        walking_ms,
    }
}

/// Reads a root again, as the start-up reconcile does. Returns at once; `perf_index_idle` waits.
#[tauri::command]
pub(crate) fn perf_index_reconcile(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    path: String,
) -> Result<(), AppError> {
    // The index knows a root by the path Access resolved when it was granted, not by the text the
    // page holds.
    let resolved = state.access().check(std::path::Path::new(&path))?;
    if state.index().reconcile(&resolved.path) {
        Ok(())
    } else {
        Err(AppError::Task(format!("{path} is not an indexed root")))
    }
}

/// Writes every cache file that is behind its list, now. A scenario that ends the app right after
/// indexing calls it so the next launch finds a cache.
#[tauri::command]
pub(crate) async fn perf_index_flush(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
) -> Result<(), AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.index().flush_cache())
        .await
        .map_err(|error| AppError::Task(error.to_string()))
}

/// P0 lab: grows the asset protocol scope while the app runs, which is what opening a folder
/// would need to do for the images inside it.
#[tauri::command]
pub(crate) fn perf_allow_directory(app: tauri::AppHandle, path: String) -> Result<(), AppError> {
    use tauri::Manager;
    app.asset_protocol_scope()
        .allow_directory(path, true)
        .map_err(|error| AppError::Task(error.to_string()))
}

/// P0 lab: a custom maximize button, to see whether Windows 11 snap layouts appear for it.
#[tauri::command]
pub(crate) fn perf_toggle_maximize(window: tauri::WebviewWindow) -> Result<(), AppError> {
    let maximized = window
        .is_maximized()
        .map_err(|error| AppError::Task(error.to_string()))?;
    let result = if maximized {
        window.unmaximize()
    } else {
        window.maximize()
    };
    result.map_err(|error| AppError::Task(error.to_string()))
}

/// P0 lab: starts an OS window drag from the page's own title bar, to see whether the window
/// then snaps to screen edges.
#[tauri::command]
pub(crate) fn perf_start_dragging(window: tauri::WebviewWindow) -> Result<(), AppError> {
    window
        .start_dragging()
        .map_err(|error| AppError::Task(error.to_string()))
}
