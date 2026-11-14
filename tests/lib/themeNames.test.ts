/**
 * ISC-450: the page and Rust read a theme's file name the same way. The cases live in one data
 * file, `tests/data/theme-names.json`; Rust's test reads the same file.
 */
import { describe, expect, it } from 'vitest'
import cases from '../data/theme-names.json'
import { checkThemeName } from '@/lib/themeNames'

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
