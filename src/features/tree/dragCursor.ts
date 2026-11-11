/**
 * The mouse cursor while a row of the tree is dragged. The drag follows the pointer over the whole
 * window (pointer events, since the browser's own drag and drop does not work under Tauri's file
 * drop), so the cursor has to be set on everything the pointer can reach, not on the row. The state
 * is one attribute on the root element and `tokens.css` turns it into a cursor: a closed hand where
 * the row would land, a "not allowed" sign anywhere it would not.
 */
export type DragCursor = 'move' | 'blocked' | null

export const DRAG_CURSOR_ATTRIBUTE = 'data-tree-drag'

export function setDragCursor(state: DragCursor): void {
  const root = document.documentElement
  if (state === null) root.removeAttribute(DRAG_CURSOR_ATTRIBUTE)
  else root.setAttribute(DRAG_CURSOR_ATTRIBUTE, state)
}
