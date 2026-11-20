import { setAppKeyHandler } from '@/editor/appKeys'
import { commandForEvent, runCommand } from './commands'
import { COMMAND_IDS } from './defaultCommands'
import { detectPlatform, type KeyInput, type Platform } from './keybinding'

/** What the handler reads from a keyboard event beyond the key itself. */
type KeyEventLike = Event & KeyInput & { readonly repeat?: boolean; readonly isComposing?: boolean }

function isKeyEvent(event: Event): event is KeyEventLike {
  return 'key' in event && 'code' in event
}

/** The commands a held key keeps running: each repeat of a zoom key is another step. */
const REPEATING: ReadonlySet<string> = new Set([COMMAND_IDS.zoomIn, COMMAND_IDS.zoomOut])

/**
 * The zoom-in command for the press of a plus, which no shortcut text can name (`Mod++` is not
 * a shortcut the parser reads). Ctrl+Shift+= types a plus, and so does the numpad's plus key, so
 * both zoom in like Ctrl+=. Other presses give undefined. The minus and zero keys need no alias:
 * the numpad ones type the same characters as the main row.
 */
function zoomAliasCommand(event: KeyEventLike, platform: Platform): string | undefined {
  const mac = platform === 'mac'
  const modHeld = mac ? event.metaKey : event.ctrlKey
  const otherHeld = mac ? event.ctrlKey : event.metaKey
  if (!modHeld || otherHeld || event.altKey || event.key !== '+') return undefined
  return COMMAND_IDS.zoomIn
}

/**
 * Runs the command a key press stands for, and says whether the press was one. A press that
 * matches a shortcut is always taken away from the page, even when the command is disabled or the
 * key is repeating, so the browser's own meaning of that key never leaks through.
 */
function takeShortcut(event: Event, platform: Platform): boolean {
  if (!isKeyEvent(event) || event.defaultPrevented || event.isComposing === true) return false
  const command = commandForEvent(event, platform)
  const id = command?.id ?? zoomAliasCommand(event, platform)
  if (id === undefined) return false
  event.preventDefault()
  if (event.repeat === true && !REPEATING.has(id)) return true
  runCommand(id).catch((error: unknown) => {
    console.error(`Command "${id}" failed`, error)
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
