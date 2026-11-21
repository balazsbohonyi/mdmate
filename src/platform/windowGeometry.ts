/**
 * Where the window is, in physical pixels (P9.1-T17). Rust fits it to the monitors when it is put
 * back, so the page only passes it along; what it must do is refuse a value that is not one.
 */
export interface WindowGeometry {
  readonly x: number
  readonly y: number
  /** The size of the window's content, which is what Tauri's `set_size` takes. */
  readonly width: number
  readonly height: number
  /** True when the window is maximised. The bounds are then the ones it returns to. */
  readonly maximized: boolean
}

/** The farthest from the origin a position is believed: far past any desktop. */
const MAX_COORDINATE = 1_000_000
/** The largest a size is believed. */
const MAX_SIZE = 100_000

const whole = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= low && value <= high

/** A window geometry from untrusted data (a session file, Rust's reply), or null. */
export function parseWindowGeometry(value: unknown): WindowGeometry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { x, y, width, height, maximized } = value as Record<string, unknown>
  if (!whole(x, -MAX_COORDINATE, MAX_COORDINATE) || !whole(y, -MAX_COORDINATE, MAX_COORDINATE))
    return null
  if (!whole(width, 1, MAX_SIZE) || !whole(height, 1, MAX_SIZE)) return null
  if (maximized !== undefined && typeof maximized !== 'boolean') return null
  return { x, y, width, height, maximized: maximized === true }
}

/** Whether two geometries are the same window. */
export function sameGeometry(a: WindowGeometry | null, b: WindowGeometry | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.maximized === b.maximized
  )
}
