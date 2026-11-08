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

/// How long a close waits for the page to write the session before the app ends anyway.
const CLOSE_GRACE: std::time::Duration = std::time::Duration::from_secs(3);

/// Starts the app and blocks until it exits.
pub fn run() {
    #[cfg(feature = "perf")]
    commands::perf::mark_started();

    let state = Arc::new(AppState::new(platform::current().paths_ignore_case()));
    #[cfg(feature = "perf")]
    commands::perf::allow_fixtures(&state);

    let builder = tauri::Builder::default()
        .manage(state)
        .manage(Arc::new(session::CloseHook::default()))
        .setup(|app| {
            use tauri::Manager as _;
            let dir = paths::data_dir_from_env(|| app.path().app_data_dir().ok());
            app.manage(Arc::new(session::SessionStore::new(dir)));
            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::Manager as _;
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && let Some(hook) = window.app_handle().try_state::<Arc<session::CloseHook>>()
                && hook.ask()
            {
                // The page writes the session and then ends the app. If it never does (it is
                // stuck), the app still ends after a grace period, so a close is never refused.
                api.prevent_close();
                let app = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(CLOSE_GRACE);
                    app.exit(0);
                });
            }
        });
    #[cfg(feature = "perf")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::platform_name,
        commands::read_file,
        commands::pick_files,
        commands::open_file,
        commands::save_file,
        commands::close_document,
        commands::reload_document,
        commands::watch_changes,
        commands::session_write,
        commands::session_load,
        commands::session_recover,
        commands::watch_close,
        commands::quit_app,
        commands::describe_link,
        commands::follow_link,
        commands::perf::perf_config,
        commands::perf::perf_report,
        commands::perf::perf_ready,
        commands::perf::perf_grant_file,
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
        commands::close_document,
        commands::reload_document,
        commands::watch_changes,
        commands::session_write,
        commands::session_load,
        commands::session_recover,
        commands::watch_close,
        commands::quit_app,
        commands::describe_link,
        commands::follow_link
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("the Tauri runtime failed to start");
}
