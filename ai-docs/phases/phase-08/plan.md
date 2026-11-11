# Phase 8: Configuration

**Goal:** everything changeable is a file, applied the moment it is saved.

## P8-T1: Settings

`settings.json` opens inside mdmate, validates on save and applies live. Invalid input keeps the last good values with a notice. Common toggles appear in the palette.

**Developer tools (ISC-249).** A `devtools` setting, with a palette toggle, turns the F12 developer tools on or off. Today they open only in a debug build and never in a release build, because `Cargo.toml` does not enable Tauri's `devtools` feature. The setting needs that feature compiled in and then switches the tools at runtime on the window (`open_devtools`, `close_devtools`), and F12 only does something while the setting is on. The release default is off.

**Done when:** a saved change applies with no restart, and F12 follows the `devtools` setting in a release build.

## P8-T2: Keybindings

`keybindings.json` overrides the default command map, using `Mod` so bindings carry across OSes.

**Done when:** a saved rebinding works immediately.

## P8-T3: Themes

Add dark and light switching, and user theme files that override any token, reloaded on save. Theme files set token values only, read as data. They load from the settings folder, so an opened workspace cannot supply one.

**Done when:** saving a theme updates the running app, and the built-ins are reviewed as original.

## P8-T4: Portable mode

A `mdmate.portable` file beside the exe moves all data there, following Riftle's `paths.rs` approach.

**Done when:** path tests pass with and without the marker.
