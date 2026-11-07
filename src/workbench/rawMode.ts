import { reactive } from 'vue'

/**
 * Which panes show raw Markdown instead of live preview. A pane's mode is its own: another pane,
 * even one showing the same document, is not affected. Kept for the session only.
 */
const rawPanes = reactive(new Set<string>())

/** True while the pane shows raw Markdown. Reads reactive state. */
export function isRaw(paneId: string): boolean {
  return rawPanes.has(paneId)
}

/** Switches a pane between raw Markdown and live preview. Returns the new state. */
export function toggleRaw(paneId: string): boolean {
  if (rawPanes.delete(paneId)) return false
  rawPanes.add(paneId)
  return true
}

/** Forgets every pane's mode. For tests. */
export function resetRawModes(): void {
  rawPanes.clear()
}
