# Rust standard

Read this before writing or reviewing Rust, `Cargo.toml` or Tauri commands. Sources verified 2026-11-07; "project call" marks our own conventions.

Sources: [API Guidelines](https://rust-lang.github.io/api-guidelines/checklist.html), [panic vs Result](https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html), [Clippy lints](https://doc.rust-lang.org/clippy/lints.html), [Clippy config](https://doc.rust-lang.org/clippy/lint_configuration.html), [Cargo lints](https://doc.rust-lang.org/cargo/reference/manifest.html), [spawn_blocking](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html), [Tokio Mutex](https://docs.rs/tokio/latest/tokio/sync/struct.Mutex.html), [Tauri commands](https://tauri.app/develop/calling-rust/)

## Enforced by tools

`src-tauri/Cargo.toml`:

```toml
[lints.rust]
unsafe_code = "deny"            # platform/ modules opt in locally

[lints.clippy]
unwrap_used = "deny"
print_stdout = "deny"
dbg_macro = "deny"
undocumented_unsafe_blocks = "deny"
await_holding_lock = "deny"
```

`src-tauri/clippy.toml` sets `allow-unwrap-in-tests = true`.

Leave Clippy's restriction and nursery groups off as groups, and cherry-pick lints from them. Fix correctness lints. Give any other `#[allow]` a reason comment.

## Errors

- Return `Result` wherever failure is expected: bad input, disk, parsing. `?` carries it up.
- Panic only on a broken invariant. `expect` states why failure is impossible.
- One `AppError` enum built with `thiserror`, with a hand-written `Serialize`, so the frontend receives a stable `kind` and a message.

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
```

## Tauri commands

- `commands/` holds thin handlers that call modules.
- Any command touching disk is `async`. Tauri runs non-async commands on the main thread, which freezes the UI.
- Async commands taking `State` return `Result`.
- Take owned types such as `String` rather than `&str`.
- File content crosses IPC as raw bytes: return `tauri::ipc::Response`, and read raw request bodies. Normal returns are JSON-serialized.

## Concurrency

- Short blocking work runs in `spawn_blocking`.
- Long-lived loops, such as the file watcher, get a dedicated thread.
- Limit CPU-heavy scans with a semaphore, because the blocking pool's cap is very high.
- Started `spawn_blocking` tasks cannot be aborted, so long scans poll a cancel flag.
- Use `std::sync::Mutex` by default, and release it before `.await`.
- Use `tokio::sync::Mutex` only when a guard must cross an `.await`.

## Types

- Use newtypes for distinct IDs and paths.
- Use enums in place of `bool` or `Option` flags.
- Constructors validate, and fields stay private when they guard an invariant.
- Derive `Debug` on all types.
- Return values rather than using out-parameters.
- Conversions follow `as_`, `to_`, `into_`.

## Project calls

- File content is `Vec<u8>` and paths are `Path` or `PathBuf`. Treat bytes as text only after the encoding layer.
- `unsafe` lives only in `platform/`, with a `// SAFETY:` comment.
- OS-specific code lives only in `platform/`, behind a trait.
- Default visibility is `pub(crate)`.
- Logs carry paths and error kinds, and leave out document text.
- Dependencies use stable releases with minimal features. Tauri plugins stay on major 2.
- Unit tests sit beside the code, with `tempfile` for disk.
