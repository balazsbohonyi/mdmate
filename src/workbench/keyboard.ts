import { setAppKeyHandler } from '@/editor/appKeys'
import { commandForEvent, runCommand } from './commands'
import { detectPlatform, type KeyInput, type Platform } from './keybinding'

/** What the handler reads from a keyboard event beyond the key itself. */
type KeyEventLike = Event & KeyInput & { readonly repeat?: boolean; readonly isComposing?: boolean }

function isKeyEvent(event: Event): event is KeyEventLike {
  return 'key' in event && 'code' in event
}

/**
 * Runs the command a key press stands for, and says whether the press was one. A press that
 * matches a shortcut is always taken away from the page, even when the command is disabled or the
 * key is repeating, so the browser's own meaning of that key never leaks through.
 */
function takeShortcut(event: Event, platform: Platform): boolean {
  if (!isKeyEvent(event) || event.defaultPrevented || event.isComposing === true) return false
  const command = commandForEvent(event, platform)
  if (command === undefined) return false
  event.preventDefault()
  if (event.repeat === true) return true
  runCommand(command.id).catch((error: unknown) => {
    console.error(`Command "${command.id}" failed`, error)
  })
  return true
}

/**
 * Listens for the app's shortcuts on `target`, and has the editor ask first as well, so a shortcut
 * also wins over a key CodeMirror uses. Returns a function that stops both.
 */
export function installKeybindings(
  target: EventTarget,
  platform: Platform = detectPlatform(),
): () => void {
  const onKeyDown = (event: Event): void => {
    takeShortcut(event, platform)
  }
  target.addEventListener('keydown', onKeyDown)
  const stopEditor = setAppKeyHandler((event) => takeShortcut(event, platform))
  return () => {
    target.removeEventListener('keydown', onKeyDown)
    stopEditor()
  }
}
