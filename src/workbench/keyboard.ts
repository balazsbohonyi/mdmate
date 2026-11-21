import { setAppKeyHandler } from '@/editor/appKeys'
import { commandForEvent, runCommand } from './commands'
import { COMMAND_IDS } from './defaultCommands'
import { detectPlatform, type KeyInput, type Platform } from './keybinding'
import { cancelCycle, cycleKey, heldModifiers, noteChord, releaseKey } from './tabCycle'

/** What the handler reads from a keyboard event beyond the key itself. */
type KeyEventLike = Event & KeyInput & { readonly repeat?: boolean; readonly isComposing?: boolean }

function isKeyEvent(event: Event): event is KeyEventLike {
  return 'key' in event && 'code' in event
}

/**
 * The commands a held key keeps running: each repeat of a zoom key is another step, and a held
 * Ctrl+PageDown or Ctrl+PageUp keeps going through the tabs.
 */
const REPEATING: ReadonlySet<string> = new Set([
  COMMAND_IDS.zoomIn,
  COMMAND_IDS.zoomOut,
  COMMAND_IDS.nextTab,
  COMMAND_IDS.previousTab,
])

/** The commands that open the tab list and step through it; they wait for the modifier to go up. */
const CYCLING: ReadonlySet<string> = new Set([COMMAND_IDS.cycleTabs, COMMAND_IDS.cycleTabsBack])

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
  if (id === undefined) {
    // While the tab list is open from Ctrl+Tab, Tab, the arrows, Escape and Enter belong to it.
    if (event.repeat === true || !cycleKey(event)) return false
    event.preventDefault()
    return true
  }
  event.preventDefault()
  if (event.repeat === true && !REPEATING.has(id)) return true
  // The cycle ends when the modifiers of the key that began it go up, so it is told which they are.
  if (CYCLING.has(id)) noteChord(heldModifiers(event))
  runCommand(id)
    .catch((error: unknown) => {
      console.error(`Command "${id}" failed`, error)
    })
    .finally(() => {
      noteChord(null)
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
  const onKeyUp = (event: Event): void => {
    if (isKeyEvent(event)) releaseKey(event.key)
  }
  // A window that loses focus never sees the release, so the tab list would stay open.
  const onBlur = (): void => {
    cancelCycle()
  }
  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)
  const stopEditor = setAppKeyHandler((event) => takeShortcut(event, platform))
  const blurTarget = typeof window === 'undefined' ? undefined : window
  blurTarget?.addEventListener('blur', onBlur)
  return () => {
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('keyup', onKeyUp)
    blurTarget?.removeEventListener('blur', onBlur)
    stopEditor()
  }
}
