mod commands;
mod fs;
mod links;
mod paths;
mod platform;
mod search;
mod session;
mod settings;
mod workspace;

/// Starts the app and blocks until it exits.
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::platform_name])
        .run(tauri::generate_context!())
        .expect("the Tauri runtime failed to start");
}
