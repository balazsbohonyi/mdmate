mod access;
mod commands;
mod documents;
mod error;
mod fs;
mod links;
mod paths;
mod platform;
mod search;
mod session;
mod settings;
mod workspace;

use documents::AppState;
use platform::Platform as _;
use std::sync::Arc;

/// Starts the app and blocks until it exits.
pub fn run() {
    #[cfg(feature = "perf")]
    commands::perf::mark_started();

    let state = Arc::new(AppState::new(platform::current().paths_ignore_case()));
    #[cfg(feature = "perf")]
    commands::perf::allow_fixtures(&state);

    let builder = tauri::Builder::default().manage(state);
    #[cfg(feature = "perf")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::platform_name,
        commands::read_file,
        commands::pick_files,
        commands::open_file,
        commands::save_file,
        commands::close_document,
        commands::perf::perf_config,
        commands::perf::perf_report,
        commands::perf::perf_allow_directory,
        commands::perf::perf_toggle_maximize,
        commands::perf::perf_start_dragging
    ]);
    #[cfg(not(feature = "perf"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::platform_name,
        commands::read_file,
        commands::pick_files,
        commands::open_file,
        commands::save_file,
        commands::close_document
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("the Tauri runtime failed to start");
}
