import {
  bindingFromEvent,
  bindingText,
  isModifierKey,
  parseKeybinding,
  type KeyInput,
  type Keybinding,
  type Platform,
} from '@/workbench/keybinding'

/** What one key press means while a Keyboard row is recording a shortcut. */
export type RecordedKey =
  /** A modifier on its own: wait for the key that goes with it. */
  | { readonly kind: 'ignore' }
  /** Escape: stop recording and change nothing. */
  | { readonly kind: 'cancel' }
  /** Backspace or Delete on their own: the command gets no shortcut. */
  | { readonly kind: 'unbind' }
  /** Not usable as a shortcut; the reason is for the row. Recording goes on. */
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'binding'; readonly binding: Keybinding }

/**
 * Reads one key press for the recorder. The rules are the file's own: whatever this accepts,
 * `parseKeybinding` reads back from the text that is written, so a recorded shortcut is never one
 * the file would then reject.
 */
export function interpretKey(event: KeyInput, platform: Platform): RecordedKey {
  if (isModifierKey(event)) return { kind: 'ignore' }
  const bare = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey
  if (bare && event.key === 'Escape') return { kind: 'cancel' }
  if (bare && (event.key === 'Backspace' || event.key === 'Delete')) return { kind: 'unbind' }
  const binding = bindingFromEvent(event, platform)
  if (binding === null) {
    return { kind: 'refused', message: 'That key combination cannot be a shortcut.' }
  }
  try {
    parseKeybinding(bindingText(binding))
  } catch (error) {
    return { kind: 'refused', message: error instanceof Error ? error.message : String(error) }
  }
  return { kind: 'binding', binding }
}
