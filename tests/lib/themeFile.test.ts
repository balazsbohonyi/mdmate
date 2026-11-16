/**
 * A user theme file is data (ISC-448, ISC-449): what a value must look like to reach the page's
 * styles, what a file with bad parts costs, and how one color of a file is changed.
 */
import { describe, expect, it } from 'vitest'
import { BUILT_IN_THEMES } from '@/lib/builtinThemes'
import {
  checkThemeColor,
  editThemeColor,
  newThemeText,
  parseThemeText,
  type UserThemeData,
} from '@/lib/themeFile'
import { effectiveTokens } from '@/lib/themes'
import { THEME_TOKEN_NAMES, THEME_TOKENS } from '@/lib/themeTokens'
import { parseJsonc } from '../helpers/jsonc'

describe('ISC-449: only a hex or an oklch color with plain numbers is a theme color', () => {
  it.each([
    '#fff',
    '#FFFF',
    '#12abEF',
    '#12abef80',
    'oklch(0.7 0.1 200)',
    'oklch(70% 0.1 200)',
    'oklch(0.7 0.1 200deg)',
    'oklch(0.7 0.1 200 / 0.5)',
    'oklch(0.7 0.1 200 / 50%)',
    'OKLCH(.7 .1 200)',
    '  #ffffff  ',
  ])('takes %s', (value) => {
    expect(checkThemeColor(value).ok).toBe(true)
  })

  it.each([
    ['url(https://example.com/x)', 'a url'],
    ['var(--background)', 'a variable'],
    ['#ffffff; background: red', 'a second declaration'],
    ['#ffffff}', 'a closing brace'],
    ['#ffffff !important', 'important'],
    ['expression(alert(1))', 'an expression'],
    ['red', 'a named color'],
    ['rgb(1, 2, 3)', 'an rgb function'],
    ['hsl(10 20% 30%)', 'an hsl function'],
    ['color-mix(in srgb, red, blue)', 'color-mix'],
    ['oklch(0.7 0.1', 'an unclosed oklch'],
    ['oklch(0.7 0.1 200) extra', 'text after the color'],
    ['oklch(2 0.1 200)', 'lightness above 1'],
    ['oklch(0.7 0.9 200)', 'chroma above 0.5'],
    ['oklch(0.7 0.1 400)', 'hue above 360'],
    ['oklch(0.7 0.1 200 / 2)', 'alpha above 1'],
    ['oklch(0.7 -0.1 200)', 'a negative number'],
    ['oklch(var(--x) 0.1 200)', 'a variable inside oklch'],
    ['#12', 'two hex digits'],
    ['#12345', 'five hex digits'],
    ['#1234567', 'seven hex digits'],
    ['#ggg', 'a bad hex digit'],
    ['', 'nothing'],
    ['   ', 'only spaces'],
    [`#${'a'.repeat(10_000)}`, 'a 10 KB string'],
    [`oklch(0.7 0.1 200${' '.repeat(10_000)})`, 'a long gap'],
  ])('refuses %s (%s)', (value) => {
    expect(checkThemeColor(value).ok).toBe(false)
  })

  it.each([42, null, undefined, true, ['#fff'], { a: 1 }])(
    'refuses %j, which is not text',
    (value) => {
      expect(checkThemeColor(value).ok).toBe(false)
    },
  )

  it('hands back the trimmed text it checked', () => {
    expect(checkThemeColor('  #ABCDEF ')).toEqual({ ok: true, value: '#ABCDEF' })
  })
})

describe('ISC-448: a theme file is read as data', () => {
  const parse = (text: string): UserThemeData => {
    const parsed = parseThemeText(text)
    if (!parsed.ok) throw new Error(parsed.message)
    return parsed.theme
  }

  it('takes the name, the base and every good color of a known token', () => {
    const theme = parse(
      '{ "name": "Night owl", "base": "sepia", "colors": { "background": "#101418", "foreground": "oklch(0.9 0.02 90)" } }',
    )
    expect(theme.name).toBe('Night owl')
    expect(theme.base).toBe('sepia')
    expect([...theme.colors]).toEqual([
      ['background', '#101418'],
      ['foreground', 'oklch(0.9 0.02 90)'],
    ])
    expect(theme.problems).toEqual([])
  })

  it('has Dark for a base when there is none, and no name', () => {
    const theme = parse('{ "colors": {} }')
    expect(theme.base).toBe('dark')
    expect(theme.name).toBeNull()
  })

  it('reads comments and trailing commas, as settings.json does', () => {
    const theme = parse(
      '// mine\n{ "base": "light", /* x */ "colors": { "primary": "#112233", }, }',
    )
    expect(theme.base).toBe('light')
    expect(theme.colors.get('primary')).toBe('#112233')
  })

  it('drops a bad value and says which token, keeping the good ones', () => {
    const theme = parse(
      '{ "colors": { "background": "url(x)", "foreground": "#ffffff", "primary": "red" } }',
    )
    expect([...theme.colors.keys()]).toEqual(['foreground'])
    expect(theme.problems).toHaveLength(2)
    expect(theme.problems[0]).toContain('colors.background')
    expect(theme.problems[1]).toContain('colors.primary')
  })

  it('ignores a key and a token it does not know, saying nothing about them', () => {
    const theme = parse(
      '{ "future": 1, "colors": { "not-a-token": "#ffffff", "__proto__": "#fff", "constructor": "#fff", "background": "#000000" } }',
    )
    expect([...theme.colors.keys()]).toEqual(['background'])
    expect(theme.problems).toEqual([])
  })

  it('falls back to Dark for a base it does not know, and says so', () => {
    const theme = parse('{ "base": "neon" }')
    expect(theme.base).toBe('dark')
    expect(theme.problems[0]).toContain('base')
  })

  it('refuses a name that is not a short text, but keeps the rest', () => {
    const theme = parse(
      `{ "name": ${JSON.stringify('x'.repeat(61))}, "colors": { "primary": "#112233" } }`,
    )
    expect(theme.name).toBeNull()
    expect(theme.problems[0]).toContain('name')
    expect(theme.colors.get('primary')).toBe('#112233')
  })

  it('takes "colors" that is not an object as no colors, with a notice', () => {
    const theme = parse('{ "colors": ["#fff"] }')
    expect(theme.colors.size).toBe(0)
    expect(theme.problems[0]).toContain('colors')
  })

  it('refuses a file that is not JSON, naming the line', () => {
    const parsed = parseThemeText('{\n  "colors": {\n    "background": #fff\n  }\n}')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.message).toContain('JSON')
      expect(parsed.spot.line).toBe(3)
    }
  })

  it.each(['[]', '"text"', '12', 'null', ''])('refuses %j, which is not one object', (text) => {
    expect(parseThemeText(text).ok).toBe(false)
  })

  it('reads a file that starts with a byte-order mark', () => {
    expect(parseThemeText('﻿{ "base": "light" }').ok).toBe(true)
  })

  it('runs nothing in a file: a function-looking value is only text that fails the check', () => {
    const theme = parse('{ "colors": { "background": "(() => { throw new Error() })()" } }')
    expect(theme.colors.size).toBe(0)
  })
})

describe('a new theme file', () => {
  const dark = effectiveTokens({ palette: 'dark', overrides: new Map() })

  it('holds the base and a color for every token, and reads back as the same theme', () => {
    const text = newThemeText('Dark copy', 'dark', dark)
    const parsed = parseThemeText(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.theme.name).toBe('Dark copy')
    expect(parsed.theme.base).toBe('dark')
    expect(parsed.theme.problems).toEqual([])
    expect([...parsed.theme.colors.keys()].sort()).toEqual([...THEME_TOKEN_NAMES].sort())
    expect(parsed.theme.colors.size).toBe(THEME_TOKENS.length)
  })

  it('writes literal colors only, never a reference to another token', () => {
    for (const id of ['dark', 'light', 'sepia'] as const) {
      const text = newThemeText(id, id, effectiveTokens({ palette: id, overrides: new Map() }))
      expect(text).not.toContain('var(')
      const colors = (parseJsonc(text) as { colors: Record<string, string> }).colors
      for (const value of Object.values(colors)) expect(checkThemeColor(value).ok).toBe(true)
    }
  })

  it('carries the comments that say what the file is, and a heading for each group', () => {
    const text = newThemeText(
      'x',
      'light',
      effectiveTokens({ palette: 'light', overrides: new Map() }),
    )
    expect(text).toContain('// An mdmate theme.')
    for (const heading of ['Core', 'Sidebar', 'Chrome', 'Editor', 'Syntax'])
      expect(text).toContain(`// ${heading}`)
  })

  it('quotes a name that needs it', () => {
    const text = newThemeText('A "quoted" \\ name', 'dark', dark)
    expect((parseJsonc(text) as { name: string }).name).toBe('A "quoted" \\ name')
  })

  it('resolves every built-in token to a color the file check accepts', () => {
    for (const theme of Object.values(BUILT_IN_THEMES)) {
      expect(theme.tokens.size).toBe(THEME_TOKENS.length)
      for (const [token, value] of effectiveTokens({ palette: theme.id, overrides: new Map() })) {
        expect(checkThemeColor(value).ok, `${theme.id} ${token}: ${value}`).toBe(true)
      }
    }
  })
})

describe('ISC-454: changing one color of a file', () => {
  const FILE = `{
  // my theme
  "name": "Mine",
  "base": "dark",
  "future": { "keep": [1, 2] },
  "colors": {
    // the page
    "background": "#101418",
    "foreground": "#eeeeee"
  }
}
`

  it('changes only that value and leaves the comments, the unknown key and the layout', () => {
    const edited = editThemeColor(FILE, 'background', '#202428')
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.text).toBe(FILE.replace('#101418', '#202428'))
  })

  it('adds a token the file does not hold, inside "colors"', () => {
    const edited = editThemeColor(FILE, 'primary', '#336699')
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    const parsed = parseJsonc(edited.text) as { colors: Record<string, string>; future: unknown }
    expect(parsed.colors).toEqual({
      background: '#101418',
      foreground: '#eeeeee',
      primary: '#336699',
    })
    expect(parsed.future).toEqual({ keep: [1, 2] })
    expect(edited.text).toContain('// my theme')
    expect(edited.text).toContain('// the page')
  })

  it('makes "colors" when the file has none', () => {
    const edited = editThemeColor('{ "base": "light" }', 'primary', '#336699')
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(parseJsonc(edited.text)).toEqual({ base: 'light', colors: { primary: '#336699' } })
  })

  it('keeps Windows line endings', () => {
    const crlf = FILE.replace(/\n/g, '\r\n')
    const edited = editThemeColor(crlf, 'primary', '#336699')
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.text).not.toMatch(/(?<!\r)\n/)
  })

  it('refuses a file that is not valid JSON and a value that is not a color', () => {
    const broken = editThemeColor('{ "colors": { "background": #fff } }', 'primary', '#336699')
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.message).toContain('not valid JSON')
    expect(editThemeColor(FILE, 'primary', 'red').ok).toBe(false)
    expect(editThemeColor(FILE, 'primary', 'url(x)').ok).toBe(false)
  })

  it('refuses a token that is not one of the theme', () => {
    expect(editThemeColor(FILE, 'not-a-token', '#336699').ok).toBe(false)
    expect(editThemeColor(FILE, '__proto__', '#336699').ok).toBe(false)
  })

  it('names the file in a refusal when it is given', () => {
    const broken = editThemeColor('nope', 'primary', '#336699', 'mine.json')
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.message).toContain('mine.json')
  })
})
