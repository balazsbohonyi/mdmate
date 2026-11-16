import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'

/**
 * Lets the app's own shortcuts win inside the editor. CodeMirror's keymap reads keys before the
 * page's listener does, so a command bound to a key the editor also uses (`Mod+Shift+K` deletes a
 * line) would never run once the user rebinds a command onto it. The workbench installs the one
 * handler that knows the commands; the editor only asks it first, so it stays plain TypeScript
 * with no dependency on the registry.
 */
export type AppKeyHandler = (event: KeyboardEvent) => boolean

let handler: AppKeyHandler = () => false

/** Sets who answers for the app's shortcuts. The function it returns puts the previous one back. */
export function setAppKeyHandler(next: AppKeyHandler): () => void {
  const before = handler
  handler = next
  return () => {
    if (handler === next) handler = before
  }
}

/** Asks the app first about every key press, ahead of every other binding of the editor. */
export const appKeys: Extension = Prec.highest(
  keymap.of([{ any: (_view, event) => handler(event) }]),
)
