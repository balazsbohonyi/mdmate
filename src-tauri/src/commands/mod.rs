//! Thin Tauri handlers. Logic lives in the modules they call.

// Public to the crate, not re-exported: `generate_handler!` finds a command's helper macro by the
// path of the module that defines it.
#[cfg(feature = "perf")]
pub(crate) mod perf;

use crate::access::{self, display_path};
use crate::documents::{self, AppState};
use crate::error::AppError;
use crate::links;
use crate::platform::{self, Platform as _};
use crate::session::{self, CloseHook, SessionStore};
use crate::workspace::ops::{self, ClashAnswer, CopyReport, Moved};
use crate::workspace::roots::{self, RootStore};
use crate::workspace::tree::{self, TreeEntry};
use crate::workspace::watch::DiskChange;
use crate::workspace::{self, DroppedItem};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tauri::ipc::Channel;

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
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<tauri::ipc::Response, AppError> {
    let state = state.inner().clone();
    let (frame, images) = tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);
        let frame = documents::open_document(&state, &path)?;
        // The document opened, so the path was allowed and resolves again.
        let images = state
            .access()
            .check(&path)
            .ok()
            .and_then(|resolved| access::asset_folder(&resolved));
        Ok::<_, AppError>((frame, images))
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))??;
    if let Some(folder) = images {
        allow_images_from(&app, &folder);
    }
    Ok(tauri::ipc::Response::new(frame))
}

/// Lets the page load the images in a document's folder (and below) through the asset protocol.
/// Rust does this itself when a document opens; the page has no command to widen the scope. The
/// scope only grows while the app runs, which is the most the protocol supports. A failure leaves
/// the images unloadable, so the document shows its placeholders and everything else works.
fn allow_images_from(app: &tauri::AppHandle, folder: &std::path::Path) {
    use tauri::Manager as _;
    // The folder is escaped by Tauri before it becomes a pattern, so a name with `[` is safe.
    let _ = app.asset_protocol_scope().allow_directory(folder, true);
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

/// Reads an open document's file again and returns it as a frame, like `open_file`. The document
/// is then in step with what is on disk, so no change is reported for it.
#[tauri::command]
pub(crate) async fn reload_document(
    state: State<'_, Arc<AppState>>,
    id: u32,
) -> Result<tauri::ipc::Response, AppError> {
    let state = state.inner().clone();
    let frame =
        tauri::async_runtime::spawn_blocking(move || documents::reload_document(&state, id))
            .await
            .map_err(|error| AppError::Task(error.to_string()))??;
    Ok(tauri::ipc::Response::new(frame))
}

/// Starts telling the page about every change another program makes to a file it has open. The
/// page calls this once at startup; calling it again replaces the channel.
#[tauri::command]
pub(crate) fn watch_changes(
    state: State<'_, Arc<AppState>>,
    on_event: Channel<DiskChange>,
) -> Result<(), AppError> {
    state.start_watcher(Box::new(move |change| {
        // A page that has gone away has nobody to tell; the next subscription replaces this one.
        let _ = on_event.send(change);
    }))
}

/// Writes the page's snapshot of the session (layout, tabs, carets, unsaved buffers) to the data
/// folder. The body is the snapshot's JSON as raw UTF-8, so a large buffer is not escaped a second
/// time on its way through the invoke layer. Rust adds the paths of the documents it has open.
#[tauri::command]
pub(crate) async fn session_write(
    state: State<'_, Arc<AppState>>,
    store: State<'_, Arc<SessionStore>>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), AppError> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(AppError::Invalid("the body must be raw bytes".into()));
    };
    let body = body.clone();
    let (state, store) = (state.inner().clone(), store.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        let json = std::str::from_utf8(&body)
            .map_err(|error| AppError::Invalid(format!("the snapshot is not UTF-8: {error}")))?;
        session::write(&state, &store, json)
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

/// Returns the last run's snapshot, or nothing on a first start, and grants the files that run
/// had open so the page can open them again.
#[tauri::command]
pub(crate) async fn session_load(
    state: State<'_, Arc<AppState>>,
    store: State<'_, Arc<SessionStore>>,
) -> Result<Option<String>, AppError> {
    let (state, store) = (state.inner().clone(), store.inner().clone());
    tauri::async_runtime::spawn_blocking(move || session::load(&state, &store))
        .await
        .map_err(|error| AppError::Task(error.to_string()))
}

/// Keeps text that could not be put back in a tab, in a file of its own. Returns where it went.
#[tauri::command]
pub(crate) async fn session_recover(
    store: State<'_, Arc<SessionStore>>,
    name: String,
    text: String,
) -> Result<String, AppError> {
    let store = store.inner().clone();
    let path = tauri::async_runtime::spawn_blocking(move || store.recover(&name, &text))
        .await
        .map_err(|error| AppError::Task(error.to_string()))??;
    Ok(display_path(&path))
}

/// The page calls this once at startup. When the window is asked to close, the page is told over
/// `on_close` and ends the app with `quit_app` after writing the session. A second call replaces
/// the channel.
#[tauri::command]
pub(crate) fn watch_close(hook: State<'_, Arc<CloseHook>>, on_close: Channel<()>) {
    hook.set(Box::new(move || on_close.send(()).is_ok()));
}

/// Ends the app. The page calls it once the session is written.
#[tauri::command]
pub(crate) fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// The folder of an open document, from Rust's own record of it. Links resolve against it.
fn document_folder(state: &AppState, id: u32) -> Result<PathBuf, AppError> {
    let documents = state.documents();
    let entry = documents.get(id).ok_or(AppError::NotOpen(id))?;
    entry
        .path
        .parent()
        .map(std::path::Path::to_path_buf)
        .ok_or_else(|| AppError::Invalid("the document has no folder".into()))
}

/// Says where a link written in a document leads, without opening or granting anything.
#[tauri::command]
pub(crate) async fn describe_link(
    state: State<'_, Arc<AppState>>,
    id: u32,
    href: String,
) -> Result<links::LinkInfo, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let folder = document_folder(&state, id)?;
        Ok(links::describe(
            &href,
            &folder,
            &links::guard::RealFileSystem,
        ))
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

/// For each link target written in a document, whether it points at a file that is not there.
/// The page asks for the links on screen, in the background, to draw the missing ones as broken.
/// At most [`links::CHECK_LIMIT`] targets per call.
#[tauri::command]
pub(crate) async fn check_links(
    state: State<'_, Arc<AppState>>,
    id: u32,
    hrefs: Vec<String>,
) -> Result<Vec<bool>, AppError> {
    if hrefs.len() > links::CHECK_LIMIT {
        return Err(AppError::Invalid(format!(
            "at most {} links per check",
            links::CHECK_LIMIT
        )));
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let folder = document_folder(&state, id)?;
        Ok(links::missing(
            &hrefs,
            &folder,
            &links::guard::RealFileSystem,
        ))
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

/// Follows a link written in a document. The page sends the document id and the target as
/// written, never a path or a URL of its own; the guard decides everything else. A Markdown
/// target becomes readable here, and only that one file.
#[tauri::command]
pub(crate) async fn follow_link(
    state: State<'_, Arc<AppState>>,
    id: u32,
    href: String,
    confirmed: bool,
) -> Result<links::Followed, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let folder = document_folder(&state, id)?;
        links::follow(
            &href,
            &folder,
            confirmed,
            &links::guard::RealFileSystem,
            &links::PlatformOpener,
            |path| Ok(display_path(&state.access().grant_file(path)?.path)),
        )
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

/// Grants a folder to the sidebar and to the image protocol, and returns it as people read it.
fn add_root_and_allow_images(
    app: &tauri::AppHandle,
    state: &AppState,
    store: &RootStore,
    path: &std::path::Path,
) -> Result<String, AppError> {
    let shown = roots::add(state, store, path)?;
    // The images of a workspace folder load without opening a document first. The scope can only
    // grow while the app runs (Tauri has no way to shrink it), so removing the folder later
    // revokes Rust's file access but not this.
    allow_images_from(app, std::path::Path::new(&shown));
    Ok(shown)
}

/// Shows the system's folder dialog and makes the chosen folder a workspace root. Choosing is what
/// grants it, here and never on the page's say-so. Returns the folder, or nothing when the user
/// cancels.
#[tauri::command]
pub(crate) async fn open_folder(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Arc<AppState>>,
    store: State<'_, Arc<RootStore>>,
) -> Result<Option<String>, AppError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Open Folder")
            .pick_folder()
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let (state, store) = (state.inner().clone(), store.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        add_root_and_allow_images(&app, &state, &store, &picked).map(Some)
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

/// Grants the folders the last run had open and returns the workspace roots, in order. The page
/// calls it once at startup; the list comes from Rust's own record, never from the session
/// snapshot the page wrote.
#[tauri::command]
pub(crate) async fn workspace_load(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    store: State<'_, Arc<RootStore>>,
) -> Result<Vec<String>, AppError> {
    let (state, store) = (state.inner().clone(), store.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        let restored = roots::restore(&state, &store);
        for root in &restored {
            allow_images_from(&app, std::path::Path::new(root));
        }
        restored
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))
}

/// Takes a folder out of the workspace and revokes the page's access to it.
#[tauri::command]
pub(crate) async fn remove_root(
    state: State<'_, Arc<AppState>>,
    store: State<'_, Arc<RootStore>>,
    path: String,
) -> Result<(), AppError> {
    let (state, store) = (state.inner().clone(), store.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        roots::remove(&state, &store, &PathBuf::from(path))
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

/// Lists one folder of the workspace: its files and folders, folders first. Only a folder inside
/// a workspace root can be listed.
#[tauri::command]
pub(crate) async fn list_dir(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Vec<TreeEntry>, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let resolved = state.access().check(&PathBuf::from(path))?;
        tree::list_dir(&resolved.path)
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

/// Starts telling the page which folder of the sidebar went out of date. Once at startup; calling
/// it again replaces the channel.
#[tauri::command]
pub(crate) fn watch_tree(
    state: State<'_, Arc<AppState>>,
    on_event: Channel<String>,
) -> Result<(), AppError> {
    state.start_folder_watcher(Box::new(move |folder| {
        // A page that has gone away has nobody to tell; the next subscription replaces this one.
        let _ = on_event.send(folder);
    }))
}

/// Says which folders the sidebar has open, so Rust watches exactly those. A folder outside the
/// workspace is skipped.
#[tauri::command]
pub(crate) fn watch_folders(
    state: State<'_, Arc<AppState>>,
    paths: Vec<String>,
) -> Result<(), AppError> {
    let watcher = state
        .folder_watcher()
        .ok_or_else(|| AppError::Invalid("watch_tree comes first".into()))?;
    let folders: Vec<PathBuf> = paths
        .iter()
        .filter_map(|path| state.access().check(&PathBuf::from(path)).ok())
        .filter(|resolved| resolved.path.is_dir())
        .map(|resolved| PathBuf::from(display_path(&resolved.path)))
        .collect();
    watcher.set_folders(&folders);
    Ok(())
}

/// Says what each path of a drop is. Every path must be one a native drop delivered.
#[tauri::command]
pub(crate) fn drop_describe(
    state: State<'_, Arc<AppState>>,
    paths: Vec<String>,
) -> Result<Vec<DroppedItem>, AppError> {
    workspace::describe_drops(&state, &paths)
}

/// Lets the page open the files of a native drop. Every path must be one a native drop delivered.
#[tauri::command]
pub(crate) fn drop_open(
    state: State<'_, Arc<AppState>>,
    paths: Vec<String>,
) -> Result<Vec<DroppedItem>, AppError> {
    workspace::open_drops(&state, &paths)
}

/// What a file the page may read opens as: Markdown, an image or plain text.
#[tauri::command]
pub(crate) fn file_kind(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<crate::fs::kind::FileKind, AppError> {
    workspace::file_kind(&state, &path)
}

/// Checks that an image may be shown, lets the image protocol serve that one file, and says how
/// big it is. The page has no command that widens the scope any further.
#[tauri::command]
pub(crate) async fn image_info(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<workspace::ImageInfo, AppError> {
    let state = state.inner().clone();
    let (info, resolved) =
        tauri::async_runtime::spawn_blocking(move || workspace::image_info(&state, &path))
            .await
            .map_err(|error| AppError::Task(error.to_string()))??;
    use tauri::Manager as _;
    // A failure leaves the image unloadable; the tab says so, and nothing else breaks.
    let _ = app.asset_protocol_scope().allow_file(&resolved);
    Ok(info)
}

/// Says that no tab shows this image any more, so the next session does not grant it again.
#[tauri::command]
pub(crate) fn image_closed(state: State<'_, Arc<AppState>>, path: String) {
    state.forget_image(std::path::Path::new(&path));
}

/// Makes an empty file in a folder of the workspace. Returns its path.
#[tauri::command]
pub(crate) fn create_file(
    state: State<'_, Arc<AppState>>,
    parent: String,
    name: String,
) -> Result<String, AppError> {
    ops::create_file(&state, std::path::Path::new(&parent), &name)
}

/// Makes a folder in a folder of the workspace. Returns its path.
#[tauri::command]
pub(crate) fn create_folder(
    state: State<'_, Arc<AppState>>,
    parent: String,
    name: String,
) -> Result<String, AppError> {
    ops::create_folder(&state, std::path::Path::new(&parent), &name)
}

/// Renames a file or folder of the workspace; open documents under it follow.
#[tauri::command]
pub(crate) fn rename_entry(
    state: State<'_, Arc<AppState>>,
    path: String,
    new_name: String,
) -> Result<Moved, AppError> {
    ops::rename_entry(&state, std::path::Path::new(&path), &new_name)
}

/// Moves a file or folder of the workspace into another folder of it; open documents follow.
#[tauri::command]
pub(crate) fn move_entry(
    state: State<'_, Arc<AppState>>,
    path: String,
    into: String,
) -> Result<Moved, AppError> {
    ops::move_entry(
        &state,
        std::path::Path::new(&path),
        std::path::Path::new(&into),
    )
}

/// Checks a rename or move and reads the workspace for the links it would change, without
/// changing anything. `on_progress` hears how many files were read, a few times a second; the
/// answer says how many links in how many files, and names the plan for [`rewrite_move`].
/// `buffers` are the open documents with edits not yet saved: their text is read instead of the
/// file's.
#[tauri::command]
pub(crate) async fn rewrite_plan(
    state: State<'_, Arc<AppState>>,
    path: String,
    change: links::flow::Change,
    buffers: Vec<links::flow::Buffer>,
    on_progress: Channel<usize>,
) -> Result<links::flow::Planned, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut last = std::time::Instant::now();
        links::flow::plan(
            &state,
            std::path::Path::new(&path),
            &change,
            &buffers,
            |read| {
                if last.elapsed() >= std::time::Duration::from_millis(75) {
                    last = std::time::Instant::now();
                    // A page that has gone away has nobody to tell.
                    let _ = on_progress.send(read);
                }
            },
        )
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

/// Does the rename or move a plan was made for, and rewrites the links it said it would. Open
/// documents are not written: `buffers` carries the text of every one the page holds edits in.
#[tauri::command]
pub(crate) async fn rewrite_move(
    state: State<'_, Arc<AppState>>,
    token: u64,
    buffers: Vec<links::flow::Buffer>,
) -> Result<links::flow::Done, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || links::flow::finish(&state, token, &buffers))
        .await
        .map_err(|error| AppError::Task(error.to_string()))?
}

/// Stops a scan that [`rewrite_plan`] is running. The plan then answers `cancelled`.
#[tauri::command]
pub(crate) fn rewrite_cancel(state: State<'_, Arc<AppState>>) {
    state
        .rewrite_stop()
        .store(true, std::sync::atomic::Ordering::Relaxed);
}

/// Forgets a plan the user said no to.
#[tauri::command]
pub(crate) fn rewrite_discard(state: State<'_, Arc<AppState>>, token: u64) {
    links::flow::discard(&state, token);
}

/// Sends a file or folder of the workspace to the Recycle Bin.
#[tauri::command]
pub(crate) async fn delete_entry(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<(), AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        ops::delete_entry(&state, &platform::current(), std::path::Path::new(&path))
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

/// Shows a file or folder in the system's file manager.
#[tauri::command]
pub(crate) fn reveal_entry(state: State<'_, Arc<AppState>>, path: String) -> Result<(), AppError> {
    ops::reveal_entry(&state, &platform::current(), std::path::Path::new(&path))
}

/// Says which names of a drop already exist in a folder, so the page can ask what to do about
/// them. Changes nothing. Every path must be one a native drop delivered.
#[tauri::command]
pub(crate) fn copy_clashes(
    state: State<'_, Arc<AppState>>,
    into: String,
    paths: Vec<String>,
) -> Result<Vec<String>, AppError> {
    ops::copy_clashes(&state, std::path::Path::new(&into), &paths)
}

/// Copies the paths of a native drop into a folder of the workspace, with an answer for each name
/// that is already there.
#[tauri::command]
pub(crate) async fn copy_dropped(
    state: State<'_, Arc<AppState>>,
    into: String,
    paths: Vec<String>,
    answers: Vec<ClashAnswer>,
) -> Result<CopyReport, AppError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        ops::copy_into(
            &state,
            &platform::current(),
            std::path::Path::new(&into),
            &paths,
            &answers,
        )
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

/// Makes a dropped folder a workspace root.
#[tauri::command]
pub(crate) async fn add_dropped_root(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    store: State<'_, Arc<RootStore>>,
    path: String,
) -> Result<String, AppError> {
    let (state, store) = (state.inner().clone(), store.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        let shown = workspace::add_dropped_root(&state, &store, &path)?;
        allow_images_from(&app, std::path::Path::new(&shown));
        Ok(shown)
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}
