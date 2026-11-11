import { nextTick, readonly, ref } from 'vue'

/**
 * Where keyboard focus goes when a tab is shown. An editor takes focus when its tab is shown in
 * the active pane, as a side effect of `EditorHost`. A tree click or a tree key that only wants to
 * show a file must leave focus on the tree, as the sidebar of VS Code does, so the code that opens
 * the file holds the editor's focus for exactly as long as the open takes (ISC-255).
 */

let holds = 0

/** True while `holdingEditorFocus` is running: an editor must not take focus now. */
export function isEditorFocusHeld(): boolean {
  return holds > 0
}

/**
 * Runs `work`, and keeps every editor from taking focus until the screen has caught up with what it
 * changed. The hold ends in `finally`, so an open that fails, or one that shows a tab that is
 * already on screen (and so wakes no editor), never leaves it on.
 */
export async function holdingEditorFocus<T>(work: () => T | Promise<T>): Promise<T> {
  holds += 1
  try {
    return await work()
  } finally {
    // The editor hosts react in the render that follows the change; wait for it to finish.
    await nextTick()
    await nextTick()
    holds -= 1
  }
}

const request = ref(0)

/** Counts the calls to `focusActiveEditor`; each editor host watches it. */
export const editorFocusRequest = readonly(request)

/** Puts the caret in the editor of the active pane, whether or not its tab just changed. */
export function focusActiveEditor(): void {
  request.value += 1
}
