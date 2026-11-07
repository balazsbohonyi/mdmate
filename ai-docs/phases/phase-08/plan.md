# Phase 8: Configuration

**Goal:** everything changeable is a file, applied the moment it is saved.

## P8-T1: Settings

`settings.json` opens inside mdmate, validates on save and applies live. Invalid input keeps the last good values with a notice. Common toggles appear in the palette.

**Done when:** a saved change applies with no restart.

## P8-T2: Keybindings

`keybindings.json` overrides the default command map, using `Mod` so bindings carry across OSes.

**Done when:** a saved rebinding works immediately.

## P8-T3: Themes

Add dark and light switching, and user theme files that override any token, reloaded on save. Theme files set token values only, read as data. They load from the settings folder, so an opened workspace cannot supply one.

**Done when:** saving a theme updates the running app, and the built-ins are reviewed as original.

## P8-T4: Portable mode

A `mdmate.portable` file beside the exe moves all data there, following Riftle's `paths.rs` approach.

**Done when:** path tests pass with and without the marker.
