mod access;
mod commands;
mod documents;
mod drafts;
mod drops;
mod error;
mod fs;
mod git;
mod images;
mod links;
mod outline;
mod paths;
mod platform;
mod recent;
mod save_as;
mod search;
mod session;
mod settings;
mod window_state;
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
            // Before the page asks for its roots, so a cache file is there to answer from.
            app.state::<Arc<AppState>>()
                .index()
                .set_cache_dir(dir.join("index"));
            app.state::<Arc<AppState>>()
                .drafts()
                .set_root(dir.join("drafts"));
            app.manage(Arc::new(recent::RecentStore::new(
                dir.clone(),
                platform::current().paths_ignore_case(),
            )));
            app.manage(Arc::new(workspace::roots::RootStore::new(dir.clone())));
            app.manage(Arc::new(settings::SettingsStore::new(dir.clone())));
            app.manage(Arc::new(settings::KeybindingsStore::new(dir.clone())));
            app.manage(Arc::new(settings::themes::ThemeStore::new(dir.clone())));
            app.manage(Arc::new(session::SessionStore::new(dir)));
            app.manage(Arc::new(window_state::WindowMemory::default()));
            // Reload, view source and the zoom keys belong to a browser, not to this app.
            if let Some(window) = app.get_webview_window("main") {
                platform::current().disable_browser_keys(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::Manager as _;
            // The only place a dropped path becomes known to Rust: the OS's own drop event. The
            // page hears about the drop too, but anything it asks to open or copy is checked
            // against this record.
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event
                && let Some(state) = window.app_handle().try_state::<Arc<AppState>>()
            {
                state.drops().record(paths);
            }
            // The normal bounds of the window, for the session (window_state.rs).
            if matches!(
                event,
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
            ) && let Some(memory) = window
                .app_handle()
                .try_state::<Arc<window_state::WindowMemory>>()
            {
                window_state::current(window, &memory);
            }
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
                    commands::end_app(&app);
                    // The windows were asked to go; if the loop has not ended soon after, end it.
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
        commands::pick_executable,
        commands::open_file,
        commands::save_file,
        commands::document_new_untitled,
        commands::drafts_sweep,
        commands::document_save_as,
        commands::document_exists,
        commands::recent_list,
        commands::recent_clear,
        commands::recent_open_file,
        commands::recent_open_folder,
        commands::close_document,
        commands::reload_document,
        commands::watch_changes,
        commands::session_write,
        commands::session_load,
        commands::session_recover,
        commands::watch_close,
        commands::quit_app,
        commands::window_geometry,
        commands::window_restore,
        commands::describe_link,
        commands::follow_link,
        commands::check_links,
        commands::open_folder,
        commands::workspace_load,
        commands::remove_root,
        commands::list_dir,
        commands::watch_tree,
        commands::watch_index,
        commands::watch_folders,
        commands::drop_describe,
        commands::drop_open,
        commands::file_kind,
        commands::image_info,
        commands::image_closed,
        commands::image_paste,
        commands::image_drop,
        commands::add_dropped_root,
        commands::create_file,
        commands::create_folder,
        commands::rename_entry,
        commands::move_entry,
        commands::rewrite_check,
        commands::links_on_rename_override,
        commands::settings_read,
        commands::settings_write,
        commands::watch_settings,
        commands::settings_file,
        commands::settings_apply,
        commands::keybindings_read,
        commands::keybindings_write,
        commands::watch_keybindings,
        commands::keybindings_file,
        commands::themes_read,
        commands::theme_read,
        commands::theme_write,
        commands::theme_rename,
        commands::theme_delete,
        commands::watch_themes,
        commands::themes_folder_open,
        commands::devtools_open,
        commands::rewrite_plan,
        commands::find_references,
        commands::search_folders,
        commands::search_cancel,
        commands::outline_scan,
        commands::rewrite_move,
        commands::quick_open_query,
        commands::rewrite_cancel,
        commands::rewrite_discard,
        commands::delete_entry,
        commands::reveal_entry,
        commands::list_font_families,
        commands::git_status,
        commands::drag_out,
        commands::show_folder,
        commands::copy_clashes,
        commands::copy_dropped,
        commands::perf::perf_config,
        commands::perf::perf_report,
        commands::perf::perf_ready,
        commands::perf::perf_grant_file,
        commands::perf::perf_grant_root,
        commands::perf::perf_index_idle,
        commands::perf::perf_index_state,
        commands::perf::perf_index_reconcile,
        commands::perf::perf_index_flush,
        commands::perf::perf_allow_directory,
        commands::perf::perf_toggle_maximize,
        commands::perf::perf_start_dragging
    ]);
    #[cfg(not(feature = "perf"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::platform_name,
        commands::read_file,
        commands::pick_files,
        commands::pick_executable,
        commands::open_file,
        commands::save_file,
        commands::document_new_untitled,
        commands::drafts_sweep,
        commands::document_save_as,
        commands::document_exists,
        commands::recent_list,
        commands::recent_clear,
        commands::recent_open_file,
        commands::recent_open_folder,
        commands::close_document,
        commands::reload_document,
        commands::watch_changes,
        commands::session_write,
        commands::session_load,
        commands::session_recover,
        commands::watch_close,
        commands::quit_app,
        commands::window_geometry,
        commands::window_restore,
        commands::describe_link,
        commands::follow_link,
        commands::check_links,
        commands::open_folder,
        commands::workspace_load,
        commands::remove_root,
        commands::list_dir,
        commands::watch_tree,
        commands::watch_index,
        commands::watch_folders,
        commands::drop_describe,
        commands::drop_open,
        commands::file_kind,
        commands::image_info,
        commands::image_closed,
        commands::image_paste,
        commands::image_drop,
        commands::add_dropped_root,
        commands::create_file,
        commands::create_folder,
        commands::rename_entry,
        commands::move_entry,
        commands::rewrite_check,
        commands::links_on_rename_override,
        commands::settings_read,
        commands::settings_write,
        commands::watch_settings,
        commands::settings_file,
        commands::settings_apply,
        commands::keybindings_read,
        commands::keybindings_write,
        commands::watch_keybindings,
        commands::keybindings_file,
        commands::themes_read,
        commands::theme_read,
        commands::theme_write,
        commands::theme_rename,
        commands::theme_delete,
        commands::watch_themes,
        commands::themes_folder_open,
        commands::devtools_open,
        commands::rewrite_plan,
        commands::find_references,
        commands::search_folders,
        commands::search_cancel,
        commands::outline_scan,
        commands::rewrite_move,
        commands::quick_open_query,
        commands::rewrite_cancel,
        commands::rewrite_discard,
        commands::delete_entry,
        commands::reveal_entry,
        commands::list_font_families,
        commands::git_status,
        commands::drag_out,
        commands::show_folder,
        commands::copy_clashes,
        commands::copy_dropped
    ]);
    builder
        .build(tauri::generate_context!())
        .expect("the Tauri runtime failed to start")
        .run(|app, event| {
            use tauri::Manager as _;
            // The index's cache file is written a moment after each change; an app that ends in
            // that moment writes it now, so the next start finds the newest list.
            if matches!(event, tauri::RunEvent::Exit)
                && let Some(state) = app.try_state::<Arc<AppState>>()
            {
                state.index().flush_cache();
            }
        });
}
