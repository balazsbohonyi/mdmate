/**
 * The browser's own right-click menu (the one with "Inspect" in it) has no place in the app: every
 * menu the user sees is the app's own. It is cancelled everywhere, editor text and text boxes
 * included. Cut, copy and paste still work from the keyboard; a menu for them, if the app ever
 * needs one, will be the app's own (ISC-251).
 */

/**
 * The elements an app menu opens from. Reka opens its menu only if nobody has cancelled the event
 * by then, so cancelling here would shut every app menu. They are left alone: the menu cancels the
 * browser's own when it opens, and one that decides to stay shut (the tree, away from a row)
 * cancels it itself.
 */
const OWN_MENU = '[data-slot="context-menu-trigger"]'

/** True where one of the app's own menus is in charge of the right click. */
export function opensAppMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OWN_MENU) !== null
}

/**
 * Cancels the browser's menu everywhere except where an app menu is in charge. Runs in the capture
 * phase on the document and only cancels the default action. Returns the function that removes it.
 */
export function blockNativeMenu(root: Document = document): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    if (opensAppMenu(event.target)) return
    event.preventDefault()
  }
  root.addEventListener('contextmenu', onContextMenu, true)
  return () => {
    root.removeEventListener('contextmenu', onContextMenu, true)
  }
}
