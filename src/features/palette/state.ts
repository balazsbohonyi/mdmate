import { nextTick, ref } from 'vue'

/**
 * Which picker is open: the file picker (Ctrl+P) or the command palette (Ctrl+Shift+P). This module
 * is all the rest of the app knows of them; the pickers themselves load the first time one opens.
 */
export type PaletteMode = 'files' | 'commands'

export const paletteMode = ref<PaletteMode | null>(null)

/** What had focus when the picker opened, so closing it can give focus back. */
let openedFrom: HTMLElement | null = null

/** The ids of the two commands that open a picker. */
export const PALETTE_COMMAND_IDS: ReadonlySet<string> = new Set([
  'file.quickOpen',
  'view.commandPalette',
])

/**
 * Opens a picker. Asking for the one that is already open closes it, as pressing its key again
 * does; asking for the other one switches to it.
 */
export function togglePalette(mode: PaletteMode): void {
  if (paletteMode.value === mode) {
    closePalette()
    return
  }
  if (paletteMode.value === null) {
    const active = document.activeElement
    openedFrom = active instanceof HTMLElement && active !== document.body ? active : null
  }
  paletteMode.value = mode
}

/**
 * Closes the picker and, unless something else took focus meanwhile (opening a file does, because
 * the editor focuses itself), puts focus back where it was.
 */
export function closePalette(): void {
  if (paletteMode.value === null) return
  paletteMode.value = null
  const back = openedFrom
  openedFrom = null
  void nextTick(() => {
    const now = document.activeElement
    if (now !== null && now !== document.body) return
    if (back?.isConnected === true) back.focus()
  })
}
