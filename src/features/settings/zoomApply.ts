import { describe } from '@/documents/store'
import { settings } from '@/lib/settings'
import { getHost } from '@/platform'
import { reportWarning } from '@/shell/toasts'

/** Kept apart from `zoom.ts`, which the settings store would otherwise import in a cycle. */

/** The level last given to the web view; null until the first time, which always sends. */
let applied: number | null = null

/**
 * Puts the web view at the level of the setting. The first call always sends, so a window the web
 * view left at some other level starts at the setting. A failure is a notice, and the next change
 * tries again.
 */
export function updateZoom(): void {
  const level = settings.view.zoom
  if (level === applied) return
  applied = level
  void getHost()
    .then((host) => host.setZoom(level))
    .catch((error: unknown) => {
      applied = null
      reportWarning(`Could not zoom the window: ${describe(error)}`)
    })
}

/** Forgets what was sent, so the next `updateZoom` sends again. For a test. */
export function resetZoomApplied(): void {
  applied = null
}
