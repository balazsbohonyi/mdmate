import { shallowRef } from 'vue'
import { getHost, type WindowGeometry } from '@/platform'
import { sameGeometry } from '@/platform/windowGeometry'

/**
 * The window's normal bounds and maximised state as the session should keep them (P9.1-T17). Rust
 * holds the real values (it hears every move and resize); this is the page's copy of them, so the
 * snapshot, which is built in one go, has something to read. It is refreshed when the window moves
 * or resizes, once the journal starts, and once more when the window is asked to close.
 */
export const windowShape = shallowRef<WindowGeometry | null>(null)

let reading = false
let again = false

/** Asks the host where the window is now and keeps the answer. A failure keeps the last answer. */
export async function refreshWindowShape(): Promise<void> {
  // Many moves come in a row while a window is dragged: one read at a time, and one more after.
  if (reading) {
    again = true
    return
  }
  reading = true
  try {
    do {
      again = false
      const host = await getHost()
      const found = await host.windowGeometry()
      if (found !== null && !sameGeometry(found, windowShape.value)) windowShape.value = found
    } while (again)
  } catch (error) {
    console.error('Could not read the window geometry', error)
  } finally {
    reading = false
  }
}

/** Follows the window as it is moved and resized. Returns the stop function. */
export async function watchWindowShape(): Promise<() => void> {
  const host = await getHost()
  return host.windowControls.onGeometryChange(() => {
    void refreshWindowShape()
  })
}

/** Forgets the geometry. Tests use it. */
export function resetWindowShape(): void {
  windowShape.value = null
  reading = false
  again = false
}
