/**
 * The zoom of the whole window, in percent. Pure: the page keeps the level in the `view.zoom`
 * setting and the web view does the scaling (`host.setZoom`).
 */

export const ZOOM_MIN = 50
export const ZOOM_MAX = 300
export const ZOOM_STEP = 10
export const ZOOM_DEFAULT = 100

/** The level kept inside the range the setting allows. */
export function clampZoom(level: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level))
}

/**
 * The next level up (`1`) or down (`-1`). The levels are the multiples of the step: from one that
 * is not (a hand-written 105) the step goes to the next multiple in that direction, so 105 goes to
 * 110 and to 100, and it never lands where it started. The result stays in range, so a step at the
 * end of the range returns the end.
 */
export function stepZoom(level: number, direction: 1 | -1): number {
  const onGrid = level / ZOOM_STEP
  const next = direction === 1 ? Math.floor(onGrid) + 1 : Math.ceil(onGrid) - 1
  return clampZoom(next * ZOOM_STEP)
}
