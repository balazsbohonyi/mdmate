mod commands;
mod error;
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
    #[cfg(feature = "perf")]
    commands::perf::mark_started();

    let builder = tauri::Builder::default();
    #[cfg(feature = "perf")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::platform_name,
        commands::read_file,
        commands::perf::perf_config,
        commands::perf::perf_report
    ]);
    #[cfg(not(feature = "perf"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::platform_name,
        commands::read_file
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("the Tauri runtime failed to start");
}
