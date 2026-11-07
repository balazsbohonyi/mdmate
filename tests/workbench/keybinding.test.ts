import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalKeybinding,
  detectPlatform,
  formatKeybinding,
  matchesKey,
  parseKeybinding,
  type KeyInput,
} from '@/workbench/keybinding'

/** A key press with every modifier off unless the test turns it on. */
function press(key: string, extra: Partial<KeyInput> = {}): KeyInput {
  return {
    key,
    code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...extra,
  }
}

describe('parsing', () => {
  it('reads modifiers in any order and any case', () => {
    expect(parseKeybinding('Mod+Shift+B')).toEqual({ mod: true, alt: false, shift: true, key: 'b' })
    expect(parseKeybinding('shift+MOD+b')).toEqual(parseKeybinding('Mod+Shift+B'))
    expect(parseKeybinding('Alt+Shift+2')).toEqual({ mod: false, alt: true, shift: true, key: '2' })
  })

  it('reads named keys, and a function key with no modifier', () => {
    expect(parseKeybinding('Mod+escape').key).toBe('Escape')
    expect(parseKeybinding('Mod+ArrowLeft').key).toBe('ArrowLeft')
    expect(parseKeybinding('F5')).toEqual({ mod: false, alt: false, shift: false, key: 'F5' })
    expect(parseKeybinding('Mod+Space').key).toBe('Space')
  })

  it.each([
    ['empty', ''],
    ['no key', 'Mod+'],
    ['a bare letter', 'b'],
    ['shift and a letter, which would swallow typing', 'Shift+B'],
    ['a repeated modifier', 'Mod+Mod+B'],
    ['a modifier this app does not know', 'Ctrl+B'],
    ['an unknown key name', 'Mod+Nope'],
    ['F13, which does not exist here', 'F13'],
  ])('rejects %s', (_name, text) => {
    expect(() => parseKeybinding(text)).toThrow()
  })
})

describe('matching', () => {
  const sidebar = parseKeybinding('Mod+Shift+B')

  it('needs exactly the modifiers the shortcut names', () => {
    const want = press('B', { ctrlKey: true, shiftKey: true })
    expect(matchesKey(sidebar, want, 'other')).toBe(true)
    expect(matchesKey(sidebar, { ...want, shiftKey: false }, 'other')).toBe(false)
    expect(matchesKey(sidebar, { ...want, ctrlKey: false }, 'other')).toBe(false)
    expect(matchesKey(sidebar, { ...want, altKey: true }, 'other')).toBe(false)
    expect(matchesKey(sidebar, { ...want, metaKey: true }, 'other')).toBe(false)
    expect(matchesKey(sidebar, press('C', { ctrlKey: true, shiftKey: true }), 'other')).toBe(false)
  })

  it('maps Mod to Cmd on a Mac and to Ctrl elsewhere', () => {
    const ctrl = press('B', { ctrlKey: true, shiftKey: true })
    const cmd = press('B', { metaKey: true, shiftKey: true })
    expect(matchesKey(sidebar, ctrl, 'other')).toBe(true)
    expect(matchesKey(sidebar, cmd, 'other')).toBe(false)
    expect(matchesKey(sidebar, cmd, 'mac')).toBe(true)
    expect(matchesKey(sidebar, ctrl, 'mac')).toBe(false)
  })

  it('matches a letter by what it types, not by where the key sits', () => {
    const undo = parseKeybinding('Mod+Z')
    // On a QWERTZ keyboard the key that types "z" is the one a QWERTY layout calls KeyY.
    expect(matchesKey(undo, { ...press('z', { ctrlKey: true }), code: 'KeyY' }, 'other')).toBe(true)
    expect(matchesKey(undo, { ...press('y', { ctrlKey: true }), code: 'KeyZ' }, 'other')).toBe(
      false,
    )
  })

  it('matches a digit by its position, since Shift and Alt change what it types', () => {
    const split = parseKeybinding('Alt+Shift+2')
    const event = { ...press('@', { altKey: true, shiftKey: true }), code: 'Digit2' }
    expect(matchesKey(split, event, 'other')).toBe(true)
    expect(matchesKey(split, { ...event, code: 'Digit8' }, 'other')).toBe(false)
  })

  it('does not take AltGr, which Windows reports as Ctrl and Alt together, for an Alt shortcut', () => {
    const split = parseKeybinding('Alt+Shift+2')
    const altGr = {
      ...press('@', { ctrlKey: true, altKey: true, shiftKey: true }),
      code: 'Digit2',
    }
    expect(matchesKey(split, altGr, 'other')).toBe(false)
  })

  it('matches named keys and the space bar', () => {
    const escape = parseKeybinding('Mod+Escape')
    expect(matchesKey(escape, press('Escape', { ctrlKey: true }), 'other')).toBe(true)
    const space = parseKeybinding('Mod+Space')
    expect(matchesKey(space, press(' ', { ctrlKey: true }), 'other')).toBe(true)
    expect(matchesKey(parseKeybinding('F5'), press('F5'), 'other')).toBe(true)
  })
})

describe('canonical form and display', () => {
  it('is the same for the same shortcut however it was written', () => {
    const a = canonicalKeybinding(parseKeybinding('Shift+Mod+b'))
    const b = canonicalKeybinding(parseKeybinding('mod+shift+B'))
    expect(a).toBe(b)
    expect(a).not.toBe(canonicalKeybinding(parseKeybinding('Mod+B')))
  })

  it('reads as Ctrl+Shift+B off a Mac and as symbols on one', () => {
    const sidebar = parseKeybinding('Mod+Shift+B')
    expect(formatKeybinding(sidebar, 'other')).toBe('Ctrl+Shift+B')
    expect(formatKeybinding(sidebar, 'mac')).toBe('⇧⌘B')
    const split = parseKeybinding('Alt+Shift+2')
    expect(formatKeybinding(split, 'other')).toBe('Alt+Shift+2')
    expect(formatKeybinding(split, 'mac')).toBe('⌥⇧2')
    expect(formatKeybinding(parseKeybinding('Mod+Escape'), 'other')).toBe('Ctrl+Esc')
  })
})

describe('platform detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a Mac from the user agent and everything else as other', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
    expect(detectPlatform()).toBe('mac')
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    expect(detectPlatform()).toBe('other')
    vi.stubGlobal('navigator', undefined)
    expect(detectPlatform()).toBe('other')
  })
})
