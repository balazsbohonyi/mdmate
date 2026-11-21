//! The window's size, position and maximised state, kept across runs.
//!
//! The page writes them into the session snapshot and gives them back before the window is shown
//! (`window_geometry`, `window_restore`). Rust owns the two parts the page cannot do well: it knows
//! the monitors, so it decides what a saved rectangle becomes on today's desktop (`fit`, pure and
//! tested), and it remembers the last normal (not maximised, not minimised) bounds, because a
//! maximised window reports the whole screen and the size to come back to is the one before.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, PoisonError};

/// The smallest size the window is restored at. The same as `minWidth` and `minHeight` in
/// `tauri.conf.json`.
pub(crate) const MIN_WIDTH: u32 = 480;
pub(crate) const MIN_HEIGHT: u32 = 320;

/// How much of the window has to lie on a monitor for it to count as reachable: enough to see and
/// grab its title bar. Less than this, and the window is brought back to a monitor.
const REACH_WIDTH: i64 = 100;
const REACH_HEIGHT: i64 = 50;

/// Where the window is, in physical pixels. A maximised window carries its normal bounds, and
/// `maximized` says to maximise it once they are set.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Geometry {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
    #[serde(default)]
    pub(crate) maximized: bool,
}

/// The part of a monitor a window can use (its work area, so not under the taskbar).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Area {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// How much of `[start, start + len)` lies inside `[from, from + span)`.
fn overlap(start: i64, len: i64, from: i64, span: i64) -> i64 {
    ((start + len).min(from + span) - start.max(from)).max(0)
}

/// The overlap of the saved window with a monitor, as width and height.
fn reach(saved: &Geometry, monitor: &Area) -> (i64, i64) {
    (
        overlap(
            i64::from(saved.x),
            i64::from(saved.width),
            i64::from(monitor.x),
            i64::from(monitor.width),
        ),
        overlap(
            i64::from(saved.y),
            i64::from(saved.height),
            i64::from(monitor.y),
            i64::from(monitor.height),
        ),
    )
}

/// What a saved window becomes on the monitors there are now (the first one is the primary).
///
/// A window that is still reachable on a monitor and fits on it stays where it was. One that lies
/// on no monitor (the one it was on is unplugged), or is larger than the monitor it is on, is
/// centred on a monitor at its saved size reduced to fit. The size never goes below the minimum.
pub(crate) fn fit(saved: Geometry, monitors: &[Area]) -> Geometry {
    let width = saved.width.max(MIN_WIDTH);
    let height = saved.height.max(MIN_HEIGHT);
    let saved = Geometry {
        width,
        height,
        ..saved
    };
    let Some(first) = monitors.first() else {
        return saved;
    };
    // The monitor the window mostly lies on; a tie goes to the earlier one.
    let mut best = first;
    let mut best_area = -1_i64;
    for monitor in monitors {
        let (across, down) = reach(&saved, monitor);
        if across * down > best_area {
            best_area = across * down;
            best = monitor;
        }
    }
    let (across, down) = reach(&saved, best);
    let reachable =
        across >= REACH_WIDTH.min(i64::from(width)) && down >= REACH_HEIGHT.min(i64::from(height));
    let monitor = if reachable { best } else { first };
    let fits = width <= monitor.width && height <= monitor.height;
    if reachable && fits {
        return saved;
    }
    let width = width.min(monitor.width).max(MIN_WIDTH);
    let height = height.min(monitor.height).max(MIN_HEIGHT);
    // A monitor smaller than the minimum cannot hold the window; it starts at the monitor's edge.
    let free_across = (i64::from(monitor.width) - i64::from(width)).max(0) / 2;
    let free_down = (i64::from(monitor.height) - i64::from(height)).max(0) / 2;
    Geometry {
        x: i32::try_from(i64::from(monitor.x) + free_across).unwrap_or(monitor.x),
        y: i32::try_from(i64::from(monitor.y) + free_down).unwrap_or(monitor.y),
        width,
        height,
        maximized: saved.maximized,
    }
}

/// The last normal bounds of the window. Updated on every move and resize that is not a maximise
/// or a minimise.
#[derive(Default)]
pub(crate) struct WindowMemory {
    normal: Mutex<Option<Geometry>>,
}

impl WindowMemory {
    pub(crate) fn note(&self, bounds: Geometry) {
        *self.normal.lock().unwrap_or_else(PoisonError::into_inner) = Some(bounds);
    }

    pub(crate) fn normal(&self) -> Option<Geometry> {
        *self.normal.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The window now: its normal bounds and whether it is maximised. A minimised or full-screen
/// window reports positions that are not its own, so it keeps the bounds it had.
pub(crate) fn current(window: &tauri::Window, memory: &WindowMemory) -> Option<Geometry> {
    let maximized = window.is_maximized().unwrap_or(false);
    let resting = !maximized
        && !window.is_minimized().unwrap_or(false)
        && !window.is_fullscreen().unwrap_or(false);
    if resting && let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) {
        memory.note(Geometry {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            maximized: false,
        });
    }
    memory.normal().map(|bounds| Geometry {
        maximized,
        ..bounds
    })
}

/// The work areas of the monitors, the primary one first.
fn areas(window: &tauri::Window) -> Vec<Area> {
    let mut monitors = window.available_monitors().unwrap_or_default();
    if let Ok(Some(primary)) = window.primary_monitor()
        && let Some(at) = monitors
            .iter()
            .position(|monitor| monitor.position() == primary.position())
    {
        monitors.swap(0, at);
    }
    monitors
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            Area {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .collect()
}

/// Puts the window where `saved` says on today's monitors, and maximises it if it was. The window
/// is still hidden when this runs, so nothing is seen moving.
pub(crate) fn restore(window: &tauri::Window, memory: &WindowMemory, saved: Geometry) {
    use tauri::{PhysicalPosition, PhysicalSize};
    let fitted = fit(saved, &areas(window));
    // Position, size, position: moving a window to a monitor with another scale can resize it, and
    // the second move puts it where it was meant to be.
    let place = || {
        let _ = window.set_position(PhysicalPosition::new(fitted.x, fitted.y));
    };
    place();
    let _ = window.set_size(PhysicalSize::new(fitted.width, fitted.height));
    place();
    memory.note(Geometry {
        maximized: false,
        ..fitted
    });
    if saved.maximized {
        let _ = window.maximize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn monitor(x: i32, y: i32, width: u32, height: u32) -> Area {
        Area {
            x,
            y,
            width,
            height,
        }
    }

    const fn window(x: i32, y: i32, width: u32, height: u32) -> Geometry {
        Geometry {
            x,
            y,
            width,
            height,
            maximized: false,
        }
    }

    const MAIN: Area = monitor(0, 0, 1920, 1040);
    const SECOND: Area = monitor(1920, 0, 2560, 1400);

    #[test]
    fn a_window_that_fits_stays_where_it_was() {
        let saved = window(300, 120, 1100, 720);
        assert_eq!(fit(saved, &[MAIN]), saved);
        assert_eq!(fit(saved, &[MAIN, SECOND]), saved);
    }

    #[test]
    fn a_window_on_a_second_monitor_stays_there() {
        let saved = window(2200, 100, 1100, 720);
        assert_eq!(fit(saved, &[MAIN, SECOND]), saved);
    }

    #[test]
    fn a_window_partly_off_one_edge_stays_while_its_title_bar_can_be_grabbed() {
        let saved = window(-300, 20, 1100, 720);
        assert_eq!(fit(saved, &[MAIN]), saved);
    }

    #[test]
    fn the_maximised_flag_survives_and_the_bounds_are_the_normal_ones() {
        let saved = Geometry {
            maximized: true,
            ..window(300, 120, 1100, 720)
        };
        assert_eq!(fit(saved, &[MAIN]), saved);
    }

    #[test]
    fn a_window_on_no_monitor_is_centred_on_the_first_at_its_saved_size() {
        // The second monitor was unplugged.
        let saved = window(2200, 100, 1100, 720);
        assert_eq!(fit(saved, &[MAIN]), window(410, 160, 1100, 720));
    }

    #[test]
    fn a_window_hanging_so_far_off_that_its_title_bar_is_gone_is_brought_back() {
        let saved = window(-1050, 20, 1100, 720);
        assert_eq!(fit(saved, &[MAIN]), window(410, 160, 1100, 720));
        let saved = window(300, 1030, 1100, 720);
        assert_eq!(fit(saved, &[MAIN]), window(410, 160, 1100, 720));
    }

    #[test]
    fn a_window_larger_than_its_monitor_is_reduced_and_centred() {
        let saved = window(0, 0, 3000, 1500);
        assert_eq!(fit(saved, &[MAIN]), window(0, 0, 1920, 1040));
        let saved = window(100, 100, 2000, 600);
        assert_eq!(fit(saved, &[MAIN]), window(0, 220, 1920, 600));
    }

    #[test]
    fn the_size_never_goes_below_the_minimum() {
        let saved = window(100, 100, 10, 10);
        let fitted = fit(saved, &[MAIN]);
        assert_eq!((fitted.width, fitted.height), (MIN_WIDTH, MIN_HEIGHT));
        // Reduced to a small monitor, it still keeps the minimum.
        let small = monitor(0, 0, 400, 300);
        let fitted = fit(window(0, 0, 1100, 720), &[small]);
        assert_eq!((fitted.width, fitted.height), (MIN_WIDTH, MIN_HEIGHT));
        assert_eq!((fitted.x, fitted.y), (0, 0));
    }

    #[test]
    fn no_monitor_at_all_changes_only_the_size() {
        assert_eq!(
            fit(window(5, 6, 100, 100), &[]),
            window(5, 6, MIN_WIDTH, MIN_HEIGHT)
        );
    }

    #[test]
    fn the_monitor_it_mostly_lies_on_is_the_one_it_is_fitted_to() {
        // Mostly on the second monitor, and too tall for it.
        let saved = window(2000, 0, 1800, 1500);
        assert_eq!(fit(saved, &[MAIN, SECOND]), window(2300, 0, 1800, 1400));
    }

    #[test]
    fn a_session_value_reads_with_or_without_the_flag() {
        let with: Geometry =
            serde_json::from_str(r#"{"x":1,"y":2,"width":900,"height":700,"maximized":true}"#)
                .expect("reads");
        assert_eq!(
            with,
            Geometry {
                maximized: true,
                ..window(1, 2, 900, 700)
            }
        );
        let without: Geometry =
            serde_json::from_str(r#"{"x":-4,"y":2,"width":900,"height":700}"#).expect("reads");
        assert_eq!(without, window(-4, 2, 900, 700));
        assert!(serde_json::from_str::<Geometry>(r#"{"x":1}"#).is_err());
    }

    #[test]
    fn the_memory_keeps_the_last_normal_bounds() {
        let memory = WindowMemory::default();
        assert_eq!(memory.normal(), None);
        memory.note(window(1, 2, 800, 600));
        memory.note(window(3, 4, 900, 700));
        assert_eq!(memory.normal(), Some(window(3, 4, 900, 700)));
    }
}
