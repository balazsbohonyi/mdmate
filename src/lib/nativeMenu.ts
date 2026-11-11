/**
 * The browser's own right-click menu (the one with "Inspect" in it) has no place in the app: every
 * menu the user sees is the app's own. It is kept only where it does something the app has no menu
 * for, which is cutting, copying and pasting text: the editor text and text boxes.
 */
const TEXT_SURFACE =
  '.cm-content, input, textarea, [contenteditable]:not([contenteditable="false"])'

/**
 * The elements an app menu opens from. Reka opens its menu only if nobody has cancelled the event
 * by then, so cancelling here would shut every app menu. They are left alone: the menu cancels the
 * browser's own when it opens, and one that decides to stay shut (the tree, away from a row)
 * cancels it itself.
 */
const OWN_MENU = '[data-slot="context-menu-trigger"]'

function within(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null
}

/** True where the browser's menu stays, because it is the only way to cut, copy or paste there. */
export function keepsNativeMenu(target: EventTarget | null): boolean {
  return within(target, TEXT_SURFACE)
}

/** True where one of the app's own menus is in charge of the right click. */
export function opensAppMenu(target: EventTarget | null): boolean {
  return within(target, OWN_MENU)
}

/**
 * Cancels the browser's menu everywhere except on text and where an app menu is in charge. Runs in
 * the capture phase on the document and only cancels the default action. Returns the function that
 * removes it.
 */
export function blockNativeMenu(root: Document = document): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    if (keepsNativeMenu(event.target) || opensAppMenu(event.target)) return
    event.preventDefault()
  }
  root.addEventListener('contextmenu', onContextMenu, true)
  return () => {
    root.removeEventListener('contextmenu', onContextMenu, true)
  }
}
