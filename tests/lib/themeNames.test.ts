/**
 * ISC-450: the page and Rust read a theme's file name the same way. The cases live in one data
 * file, `tests/data/theme-names.json`; Rust's test reads the same file.
 */
import { describe, expect, it } from 'vitest'
import cases from '../data/theme-names.json'
import { checkThemeLabel, checkThemeName, copyLabel, themeStem } from '@/lib/themeNames'

describe('theme file names', () => {
  it('has the cases Rust is held to', () => {
    expect(cases.length).toBeGreaterThan(40)
    expect(cases.some((entry) => entry.ok)).toBe(true)
    expect(cases.some((entry) => !entry.ok)).toBe(true)
  })

  it.each(cases.map((entry) => [JSON.stringify(entry.name), entry] as const))(
    'reads %s as Rust does',
    (_label, entry) => {
      expect(checkThemeName(entry.name).ok, JSON.stringify(entry.name)).toBe(entry.ok)
    },
  )

  it('gives a reason for a refusal and the name for an accepted one', () => {
    expect(checkThemeName('Night owl')).toEqual({ ok: true, value: 'Night owl' })
    const refused = checkThemeName('..\\x')
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.why.length).toBeGreaterThan(5)
  })
})

describe('ISC-473: what a theme is called, and where it is kept', () => {
  it('accepts 1 to 60 printable characters, trimmed, in any script', () => {
    expect(checkThemeLabel('  Night owl  ', [])).toEqual({ ok: true, value: 'Night owl' })
    expect(checkThemeLabel('Café: 夜 / mode?', []).ok).toBe(true)
    expect(checkThemeLabel('x'.repeat(60), []).ok).toBe(true)
  })

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['x'.repeat(61), 'too long'],
    ['a\u0000b', 'a control character'],
    ['a\tb', 'a tab'],
    ['Dark', 'a built-in name'],
    ['sEpIa', 'a built-in name in another case'],
    ['System', 'System'],
  ])('refuses %j (%s) with a reason', (name) => {
    const checked = checkThemeLabel(name, [])
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.why.length).toBeGreaterThan(5)
  })

  it("refuses the name of another theme in any letter case, but not the theme's own (it is left out)", () => {
    expect(checkThemeLabel('night OWL', ['Night owl']).ok).toBe(false)
    expect(checkThemeLabel('Night owl', []).ok).toBe(true)
  })

  it('derives a file name Rust accepts from any name', () => {
    const names = [
      'Café: night/mode?',
      '..',
      '. . .',
      '???',
      'con',
      'NUL',
      'a'.repeat(60),
      ' lead',
      '夜 mode',
      'a\\b',
      'x..y',
    ]
    for (const name of names) {
      const stem = themeStem(name, new Set())
      expect(checkThemeName(stem), JSON.stringify([name, stem])).toEqual({ ok: true, value: stem })
    }
    expect(themeStem('Café: night/mode?', new Set())).toBe('Café- night-mode-')
    expect(themeStem('a'.repeat(60), new Set())).toHaveLength(50)
  })

  it('adds a number to a file name that is taken or that a built-in theme owns', () => {
    expect(themeStem('Night owl', new Set(['night owl']))).toBe('Night owl 2')
    expect(themeStem('Night owl', new Set(['night owl', 'night owl 2']))).toBe('Night owl 3')
    expect(themeStem('dark', new Set())).toBe('dark 2')
    expect(themeStem('con', new Set())).toBe('con 2')
  })

  it('names copies "<name> copy", then "copy 2", skipping any name a theme has', () => {
    expect(copyLabel('Dark', [])).toBe('Dark copy')
    expect(copyLabel('Dark', ['Dark copy'])).toBe('Dark copy 2')
    expect(copyLabel('dark', ['DARK COPY', 'dark copy 2'])).toBe('dark copy 3')
    expect(checkThemeLabel(copyLabel('x'.repeat(60), []), []).ok).toBe(true)
  })
})
