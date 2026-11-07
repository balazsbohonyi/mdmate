//! Thin Tauri handlers. Logic lives in the modules they call.

// Public to the crate, not re-exported: `generate_handler!` finds a command's helper macro by the
// path of the module that defines it.
#[cfg(feature = "perf")]
pub(crate) mod perf;

use crate::access::display_path;
use crate::documents::{self, AppState};
use crate::error::AppError;
use crate::platform::{self, Platform as _};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

/// Reports the OS name from the platform layer.
#[tauri::command]
pub(crate) fn platform_name() -> &'static str {
    platform::current().name()
}

/// Returns a file's bytes untouched. The page receives an `ArrayBuffer`, with no JSON in between.
///
/// Only a file the user opened, or one inside an open workspace folder, can be read.
#[tauri::command]
pub(crate) async fn read_file(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<tauri::ipc::Response, AppError> {
    let state = state.inner().clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        documents::read_allowed(&state, &PathBuf::from(path))
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Shows the system's open dialog and returns the files the user chose. Choosing a file is what
/// lets the page open it, so the grant happens here and never on the page's say-so.
#[tauri::command]
pub(crate) async fn pick_files(
    window: tauri::WebviewWindow,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<String>, AppError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Open")
            .add_filter(
                "Markdown and text",
                &["md", "markdown", "mdown", "mkd", "mdx", "txt"],
            )
            .add_filter("All files", &["*"])
            .pick_files()
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
    .unwrap_or_default();
    let mut access = state.access();
    let mut paths = Vec::with_capacity(picked.len());
    for path in picked {
        paths.push(display_path(&access.grant_file(&path)?.path));
    }
    Ok(paths)
}

/// Opens a file and returns its document frame: header, line endings and text with a plain newline as its only break.
#[tauri::command]
pub(crate) async fn open_file(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<tauri::ipc::Response, AppError> {
    let state = state.inner().clone();
    let frame = tauri::async_runtime::spawn_blocking(move || {
        documents::open_document(&state, &PathBuf::from(path))
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))??;
    Ok(tauri::ipc::Response::new(frame))
}

/// What a save wrote, for the page to remember.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveResult {
    hash: String,
    size: u64,
}

/// Saves a document frame into the open document named by the `x-document-id` header. The id is
/// a plain number, so the header stays ASCII whatever the file is called.
#[tauri::command]
pub(crate) async fn save_file(
    state: State<'_, Arc<AppState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<SaveResult, AppError> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(AppError::Invalid("the body must be raw bytes".into()));
    };
    let id = request
        .headers()
        .get("x-document-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| AppError::Invalid("missing or bad x-document-id header".into()))?;
    let body = body.clone();
    let state = state.inner().clone();
    let saved =
        tauri::async_runtime::spawn_blocking(move || documents::save_document(&state, id, &body))
            .await
            .map_err(|error| AppError::Task(error.to_string()))??;
    Ok(SaveResult {
        hash: documents::hash_hex(saved.hash),
        size: saved.size,
    })
}

/// Forgets a document once its last tab is gone.
#[tauri::command]
pub(crate) fn close_document(state: State<'_, Arc<AppState>>, id: u32) {
    documents::close_document(&state, id);
}
