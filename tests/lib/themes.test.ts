// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { BUILT_IN_THEMES } from '@/lib/builtinThemes'
import {
  applyTheme,
  BUILT_IN_CHOICES,
  effectiveTokens,
  resolveTheme,
  slotKey,
  type UserThemeSlot,
} from '@/lib/themes'
import { THEME_TOKENS } from '@/lib/themeTokens'
import { parseThemeText } from '@/lib/themeFile'
import { checkThemeLabel } from '@/lib/themeNames'

const NOTHING: ReadonlyMap<string, UserThemeSlot> = new Map()
const LOADED = { systemDark: false, loaded: true }

function userSlot(
  id: string,
  base: 'dark' | 'light' | 'sepia' | 'monochrome',
  colors: Record<string, string> = {},
  problems: string[] = [],
): Map<string, UserThemeSlot> {
  return new Map([
    [
      slotKey(id),
      {
        ok: true,
        theme: { id, label: id, base, colors: new Map(Object.entries(colors)), problems },
      },
    ],
  ])
}

describe('the themes a person can choose', () => {
  it('are Dark, Light, Sepia, Monochrome and System, in that order (ISC-798)', () => {
    expect(BUILT_IN_CHOICES.map((theme) => theme.value)).toEqual([
      'dark',
      'light',
      'sepia',
      'monochrome',
      'system',
    ])
  })

  it('keep System on Dark or Light, and let a user theme start from Monochrome (ISC-798)', () => {
    for (const systemDark of [true, false])
      expect(resolveTheme('system', NOTHING, { systemDark, loaded: true }).palette).toBe(
        systemDark ? 'dark' : 'light',
      )
    const mine = userSlot('mine', 'monochrome', { background: '#123456' })
    const shown = resolveTheme('mine', mine, LOADED)
    expect(shown.palette).toBe('monochrome')
    expect(shown.scheme).toBe('dark')
    expect(shown.notice).toBeNull()
    expect(parseThemeText('{ "base": "monochrome" }')).toMatchObject({
      ok: true,
      theme: { base: 'monochrome', problems: [] },
    })
    expect(checkThemeLabel('Monochrome', []).ok).toBe(false)
  })

  it('show the palette a built-in names, with no notice', () => {
    for (const id of ['dark', 'light', 'sepia', 'monochrome'] as const) {
      const shown = resolveTheme(id, NOTHING, LOADED)
      expect(shown.palette).toBe(id)
      expect(shown.scheme).toBe(BUILT_IN_THEMES[id].scheme)
      expect(shown.notice).toBeNull()
    }
  })

  it('follow the system for System, in either direction', () => {
    expect(resolveTheme('system', NOTHING, { systemDark: true, loaded: true }).palette).toBe('dark')
    expect(resolveTheme('system', NOTHING, { systemDark: false, loaded: true }).palette).toBe(
      'light',
    )
  })

  it('take a built-in name in any case', () => {
    expect(resolveTheme('SEPIA', NOTHING, LOADED).palette).toBe('sepia')
    expect(resolveTheme(' System ', NOTHING, { systemDark: true, loaded: true }).palette).toBe(
      'dark',
    )
  })

  it('show a user theme as its base with its colors on top', () => {
    const shown = resolveTheme('mine', userSlot('mine', 'sepia', { background: '#123456' }), LOADED)
    expect(shown.palette).toBe('sepia')
    expect(shown.scheme).toBe('light')
    expect(shown.user?.id).toBe('mine')
    expect(effectiveTokens(shown).get('background')).toBe('#123456')
    expect(effectiveTokens(shown).get('foreground')).toBe(
      effectiveTokens({ palette: 'sepia', overrides: new Map() }).get('foreground'),
    )
  })

  it('find a user theme whatever the case of the name', () => {
    expect(resolveTheme('MINE', userSlot('mine', 'dark'), LOADED).user?.id).toBe('mine')
  })

  it('say what was ignored in a user theme file', () => {
    const shown = resolveTheme(
      'mine',
      userSlot('mine', 'dark', {}, ['colors.background: That is not a color.']),
      LOADED,
    )
    expect(shown.notice).toContain('colors.background')
    expect(shown.notice).toContain('ignored')
  })

  it('show Dark and say why for a theme file that cannot be used', () => {
    const broken = new Map<string, UserThemeSlot>([
      ['mine', { ok: false, id: 'mine', message: 'it is not valid JSON.' }],
    ])
    const shown = resolveTheme('mine', broken, LOADED)
    expect(shown.palette).toBe('dark')
    expect(shown.user).toBeNull()
    expect(shown.notice).toContain('not valid JSON')
    expect(shown.notice).toContain('Showing Dark')
  })

  it('show Dark and say so for a name with no file, but only once the folder was read', () => {
    const before = resolveTheme('gone', NOTHING, { systemDark: false, loaded: false })
    expect(before.palette).toBe('dark')
    expect(before.notice).toBeNull()
    const after = resolveTheme('gone', NOTHING, LOADED)
    expect(after.palette).toBe('dark')
    expect(after.notice).toContain('gone')
  })
})

describe('the git colors (ISC-655)', () => {
  const GIT = ['git-added', 'git-untracked', 'git-conflicted', 'git-modified', 'git-ignored']

  it('are in the sidebar group of the color editor', () => {
    const names = THEME_TOKENS.filter((token) => token.group === 'sidebar').map(
      (token) => token.name,
    )
    expect(names).toEqual(expect.arrayContaining(GIT))
  })

  it('come from the base theme for a custom theme that leaves them out', () => {
    for (const base of ['dark', 'light', 'sepia'] as const) {
      const slots = userSlot('Mine', base, { background: '#101418' })
      const colors = effectiveTokens(resolveTheme('Mine', slots, LOADED))
      const own = effectiveTokens({ palette: base, overrides: new Map() })
      for (const token of GIT) {
        expect(colors.get(token), `${base} ${token}`).toBeDefined()
        expect(colors.get(token), `${base} ${token}`).toBe(own.get(token))
      }
    }
  })

  it('take a color from a custom theme that sets them', () => {
    const slots = userSlot('Mine', 'dark', { 'git-added': '#00ff00', 'git-ignored': '#777777' })
    const colors = effectiveTokens(resolveTheme('Mine', slots, LOADED))
    expect([colors.get('git-added'), colors.get('git-ignored')]).toEqual(['#00ff00', '#777777'])
  })
})

describe('the line-number colors (ISC-630)', () => {
  it('are in the editor group of the color editor', () => {
    const names = THEME_TOKENS.filter((token) => token.group === 'editor').map(
      (token) => token.name,
    )
    expect(names).toEqual(expect.arrayContaining(['gutter', 'gutter-foreground', 'table-stripe']))
  })

  it('come from the base theme for a custom theme that leaves them out', () => {
    for (const base of ['dark', 'light', 'sepia'] as const) {
      const slots = userSlot('Mine', base, { background: '#101418' })
      const shown = resolveTheme('Mine', slots, LOADED)
      const colors = effectiveTokens(shown)
      expect(colors.get('gutter'), base).toBe(
        effectiveTokens({ palette: base, overrides: new Map() }).get('gutter'),
      )
      expect(colors.get('gutter-foreground'), base).toBeDefined()
      expect(colors.get('gutter')).not.toBe('#101418')
    }
  })

  it('take a color from a custom theme that sets them', () => {
    const slots = userSlot('Mine', 'dark', { gutter: '#202020', 'gutter-foreground': '#aaaaaa' })
    const colors = effectiveTokens(resolveTheme('Mine', slots, LOADED))
    expect([colors.get('gutter'), colors.get('gutter-foreground')]).toEqual(['#202020', '#aaaaaa'])
  })
})

describe('putting a theme on the page', () => {
  const root = (): HTMLElement => document.createElement('html')

  it('sets the palette, and the dark class only for a dark palette', () => {
    const el = root()
    el.className = 'other'
    applyTheme(resolveTheme('dark', NOTHING, LOADED), el)
    expect(el.dataset.theme).toBe('dark')
    expect(el.classList.contains('dark')).toBe(true)
    applyTheme(resolveTheme('sepia', NOTHING, LOADED), el)
    expect(el.dataset.theme).toBe('sepia')
    expect(el.classList.contains('dark')).toBe(false)
    applyTheme(resolveTheme('light', NOTHING, LOADED), el)
    expect(el.classList.contains('dark')).toBe(false)
    expect(el.classList.contains('other')).toBe(true)
  })

  it('sets each override as a property and takes it off when the next theme has none', () => {
    const el = root()
    const mine = resolveTheme('mine', userSlot('mine', 'dark', { background: '#123456' }), LOADED)
    applyTheme(mine, el)
    expect(el.style.getPropertyValue('--background')).toBe('#123456')
    applyTheme(resolveTheme('dark', NOTHING, LOADED), el)
    expect(el.style.getPropertyValue('--background')).toBe('')
  })

  it('refuses a value that is not a color and a token that does not exist, even from a caller', () => {
    const el = root()
    applyTheme(
      {
        palette: 'dark',
        scheme: 'dark',
        overrides: new Map([
          ['background', 'url(https://example.com/x)'],
          ['foreground', 'red'],
          ['not-a-token', '#ffffff'],
          ['primary', '#abcdef'],
        ]),
      },
      el,
    )
    expect(el.style.getPropertyValue('--background')).toBe('')
    expect(el.style.getPropertyValue('--foreground')).toBe('')
    expect(el.style.getPropertyValue('--not-a-token')).toBe('')
    expect(el.style.getPropertyValue('--primary')).toBe('#abcdef')
  })
})
