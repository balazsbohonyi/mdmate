import { commandForEvent, runCommand } from './commands'
import { detectPlatform, type KeyInput, type Platform } from './keybinding'

/** What the handler reads from a keyboard event beyond the key itself. */
type KeyEventLike = Event & KeyInput & { readonly repeat?: boolean; readonly isComposing?: boolean }

function isKeyEvent(event: Event): event is KeyEventLike {
  return 'key' in event && 'code' in event
}

/**
 * Runs the command a key press stands for. A press that matches a shortcut is always taken away
 * from the page, even when the command is disabled or the key is repeating, so the browser's own
 * meaning of that key never leaks through. Returns a function that stops listening.
 */
export function installKeybindings(
  target: EventTarget,
  platform: Platform = detectPlatform(),
): () => void {
  const onKeyDown = (event: Event): void => {
    if (!isKeyEvent(event) || event.defaultPrevented || event.isComposing === true) return
    const command = commandForEvent(event, platform)
    if (command === undefined) return
    event.preventDefault()
    if (event.repeat === true) return
    runCommand(command.id).catch((error: unknown) => {
      console.error(`Command "${command.id}" failed`, error)
    })
  }
  target.addEventListener('keydown', onKeyDown)
  return () => {
    target.removeEventListener('keydown', onKeyDown)
  }
}
