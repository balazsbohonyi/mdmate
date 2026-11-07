/**
 * Keyboard shortcuts as text, such as `Mod+Shift+B`. `Mod` is Ctrl, or Cmd on macOS. Everything
 * here is pure: tests pass plain objects in place of keyboard events.
 */

export type Platform = 'mac' | 'other'

export interface Keybinding {
  readonly mod: boolean
  readonly alt: boolean
  readonly shift: boolean
  /** One lower-case character, or a name from `NAMED_KEYS`. */
  readonly key: string
}

/** The parts of a `KeyboardEvent` that matching reads. */
export interface KeyInput {
  readonly key: string
  readonly code: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
}

const NAMED_KEYS = new Set([
  'Escape',
  'Enter',
  'Tab',
  'Space',
  'Backspace',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
])

const FUNCTION_KEY = /^F([1-9]|1[0-2])$/

/**
 * Reads `Mod+Shift+B`. The last part is the key and the rest are modifiers, in any order. Throws on
 * anything it cannot make sense of. A shortcut needs Mod or Alt (or is a function key), because
 * anything else would swallow ordinary typing.
 */
export function parseKeybinding(text: string): Keybinding {
  const parts = text.split('+').map((part) => part.trim())
  const rawKey = parts.pop() ?? ''
  if (rawKey === '') throw new Error(`Keybinding "${text}" has no key`)
  let mod = false
  let alt = false
  let shift = false
  for (const part of parts) {
    const name = part.toLowerCase()
    if (name === 'mod' && !mod) mod = true
    else if (name === 'alt' && !alt) alt = true
    else if (name === 'shift' && !shift) shift = true
    else throw new Error(`Keybinding "${text}" has an unknown or repeated modifier "${part}"`)
  }
  const key = normalizeKeyName(rawKey)
  if (key === null) throw new Error(`Keybinding "${text}" has an unknown key "${rawKey}"`)
  if (!mod && !alt && !FUNCTION_KEY.test(key)) {
    throw new Error(`Keybinding "${text}" needs Mod or Alt, or it would swallow typing`)
  }
  return { mod, alt, shift, key }
}

function normalizeKeyName(name: string): string | null {
  if (name.length === 1) return name === ' ' ? 'Space' : name.toLowerCase()
  const named = [...NAMED_KEYS].find((known) => known.toLowerCase() === name.toLowerCase())
  return named ?? null
}

/** The key an event stands for. Digits go by position, since Shift and Alt change what they type. */
function eventKey(event: KeyInput): string {
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  if (event.key === ' ') return 'Space'
  if (event.key.length === 1) return event.key.toLowerCase()
  return event.key
}

/** True when the event is exactly this shortcut: the same key, and no other modifier held. */
export function matchesKey(binding: Keybinding, event: KeyInput, platform: Platform): boolean {
  const mac = platform === 'mac'
  const modHeld = mac ? event.metaKey : event.ctrlKey
  const otherHeld = mac ? event.ctrlKey : event.metaKey
  return (
    modHeld === binding.mod &&
    !otherHeld &&
    event.altKey === binding.alt &&
    event.shiftKey === binding.shift &&
    eventKey(event) === binding.key
  )
}

/** A form that is equal for equal shortcuts, so two commands cannot hold the same one by accident. */
export function canonicalKeybinding(binding: Keybinding): string {
  const parts = [binding.mod ? 'Mod' : '', binding.alt ? 'Alt' : '', binding.shift ? 'Shift' : '']
  return [...parts.filter(Boolean), binding.key].join('+')
}

/** How a shortcut reads in a menu: `Ctrl+Shift+B`, or `⇧⌘B` on a Mac. */
export function formatKeybinding(binding: Keybinding, platform: Platform): string {
  const key = binding.key.length === 1 ? binding.key.toUpperCase() : displayName(binding.key)
  if (platform === 'mac') {
    return `${binding.alt ? '⌥' : ''}${binding.shift ? '⇧' : ''}${binding.mod ? '⌘' : ''}${key}`
  }
  const parts = [binding.mod ? 'Ctrl' : '', binding.alt ? 'Alt' : '', binding.shift ? 'Shift' : '']
  return [...parts.filter(Boolean), key].join('+')
}

function displayName(key: string): string {
  return key === 'Escape' ? 'Esc' : key
}

/** Mac or not, from the browser's own report. Anything unknown counts as `other`. */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'mac' : 'other'
}
