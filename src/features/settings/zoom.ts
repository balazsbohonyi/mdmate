import { shallowRef } from 'vue'
import { settings } from '@/lib/settings'
import { stepZoom } from '@/lib/zoom'
import { changeSettingFromCommand } from './quick'

/**
 * The zoom of the whole window. The level lives in `view.zoom`, like any setting, so the keys, the
 * wheel, the Settings row and a hand edit of the file all end in the same place; `updateZoom`
 * (`zoomApply.ts`) hands that level to the web view, which does the scaling.
 */

/** How long the percentage stays in the status bar after a change. */
export const ZOOM_NOTE_MS = 1500

/** "Zoom 120%" for a moment after a change, else empty. The status bar shows it. */
export const zoomNote = shallowRef('')
let noteTimer: ReturnType<typeof setTimeout> | undefined

function showNote(level: number): void {
  zoomNote.value = `Zoom ${String(level)}%`
  clearTimeout(noteTimer)
  noteTimer = setTimeout(() => {
    zoomNote.value = ''
  }, ZOOM_NOTE_MS)
}

/**
 * The level that was asked for and has not reached the setting yet. A burst of wheel ticks asks
 * for several steps before the first write is done, so each step starts from the last one asked
 * for, not from the setting.
 */
let asked: number | null = null

/** Sets the level, writes it to settings.json and shows it. */
export async function zoomTo(level: number): Promise<void> {
  asked = level
  showNote(level)
  try {
    await changeSettingFromCommand('view.zoom', level)
  } finally {
    if (asked === level) asked = null
  }
}

/** One step in or out from where the level is going. */
export function zoomBy(direction: 1 | -1): Promise<void> {
  return zoomTo(stepZoom(asked ?? settings.view.zoom, direction))
}
