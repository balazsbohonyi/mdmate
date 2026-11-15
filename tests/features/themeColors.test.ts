// @vitest-environment jsdom
/**
 * The color editor on the Appearance page (ISC-454 to ISC-456): every token of the theme in force,
 * in groups; a text field that checks what is typed; a picker only where it can hold the color; a
 * warning when a required pair falls under its floor. Customize is what a built-in theme offers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { baseColorOf, copyTheme, flushThemeColors } from '@/features/themes/customize'
import { loadSettings, resetSettingsState } from '@/features/settings/store'
import {
  loadThemes,
  resetThemesState,
  settledThemes,
  themeForm,
  watchThemesFolder,
} from '@/features/themes/store'
import ThemeColors from '@/features/themes/ThemeColors.vue'
import { formatColor } from '@/lib/color'
import { resetSettings, settings } from '@/lib/settings'
import { THEME_GROUPS, THEME_TOKENS, tokensOf } from '@/lib/themeTokens'
import { setHost } from '@/platform'
import {
  createMockHost,
  MOCK_SETTINGS_FILE,
  MOCK_THEMES_FOLDER,
  type MockHost,
} from '@/platform/mock'
import { parseJsonc } from '../helpers/jsonc'
import { tooltipApp } from '../helpers/tooltips'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const themeFile = (name: string): string => `${MOCK_THEMES_FOLDER}/${name}.json`

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

let host: MockHost
let mounted: { app: App; host: HTMLElement } | undefined
const stops: (() => void)[] = []

async function mount(files: Record<string, string> = {}): Promise<void> {
  host = createMockHost({ files })
  setHost(host)
  await loadSettings()
  await loadThemes()
  stops.push(await watchThemesFolder())
  const element = document.createElement('div')
  document.body.append(element)
  const app = tooltipApp(ThemeColors)
  app.mount(element)
  mounted = { app, host: element }
  await flush()
}

beforeEach(() => {
  resetSettings()
  resetSettingsState()
  resetThemesState()
  document.documentElement.className = 'dark'
  document.documentElement.removeAttribute('style')
})

afterEach(() => {
  while (stops.length > 0) stops.pop()?.()
  mounted?.app.unmount()
  mounted?.host.remove()
  mounted = undefined
  setHost(undefined)
})

const rowOf = (token: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[data-theme-token="${token}"]`)
  if (row === null) throw new Error(`no row for ${token}`)
  return row
}
const fieldOf = (token: string): HTMLInputElement => {
  const field = rowOf(token).querySelector<HTMLInputElement>('[data-theme-text]')
  if (field === null) throw new Error(`no field for ${token}`)
  return field
}

async function type(token: string, text: string, how: 'change' | 'enter' = 'enter'): Promise<void> {
  const field = fieldOf(token)
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  if (how === 'enter')
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  else field.dispatchEvent(new Event('change', { bubbles: true }))
  await flush()
}

const fileColors = (name: string): Record<string, string> =>
  (parseJsonc(host.files.read(themeFile(name)) ?? '{}') as { colors?: Record<string, string> })
    .colors ?? {}

const MINE = '{ "base": "dark", "colors": { "background": "#101418" } }'
const SELECT_MINE = { [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }', [themeFile('mine')]: MINE }

/** The same, with the settings of the color editor spelled out. */
const withThemes = (themes: Record<string, unknown>): Record<string, string> => ({
  [MOCK_SETTINGS_FILE]: JSON.stringify({ theme: 'mine', themes }),
  [themeFile('mine')]: MINE,
})
/** Contrast lines are hidden by default (ISC-465), so the tests of the lines ask for them. */
const SHOW_WARNINGS = (file?: string): Record<string, string> => ({
  ...withThemes({ hideContrastWarnings: false }),
  ...(file === undefined ? {} : { [themeFile('mine')]: file }),
})

describe('a built-in theme', () => {
  it('has no editor, only Customize, which asks for a name for the copy and then opens the copy for editing', async () => {
    await mount()
    expect(document.querySelector('[data-theme-builtin]')?.textContent).toContain('built in')
    expect(document.querySelectorAll('[data-theme-token]')).toHaveLength(0)
    document.querySelector<HTMLElement>('[data-theme-customize]')?.click()
    await flush()
    // Customize writes nothing itself: it opens the name form of the Themes list.
    expect(themeForm.value).toEqual({ kind: 'copy' })
    expect(settings.theme).toBe('dark')
    expect((await copyTheme(undefined, 'Dark copy')).ok).toBe(true)
    await settledThemes()
    await flush()
    expect(settings.theme).toBe('Dark copy')
    expect(document.querySelector('[data-theme-builtin]')).toBeNull()
    expect(document.querySelector('[data-theme-editing]')?.textContent).toContain('Dark copy')
    expect(document.querySelectorAll('[data-theme-token]')).toHaveLength(THEME_TOKENS.length)
  })
})

describe('a user theme: every token, in groups', () => {
  it('lists all tokens under Core, Sidebar, Chrome, Editor and Syntax, each with a swatch and a field', async () => {
    await mount(SELECT_MINE)
    const groups = [...document.querySelectorAll('[data-theme-group]')].map((group) =>
      group.getAttribute('data-theme-group'),
    )
    expect(groups).toEqual(THEME_GROUPS.map((group) => group.id))
    for (const group of THEME_GROUPS) {
      const rows = [
        ...document.querySelectorAll(`[data-theme-group="${group.id}"] [data-theme-token]`),
      ]
      expect(rows.map((row) => row.getAttribute('data-theme-token'))).toEqual(
        tokensOf(group.id).map((token) => token.name),
      )
    }
    expect(document.querySelectorAll('[data-theme-swatch]')).toHaveLength(THEME_TOKENS.length)
    expect(document.querySelectorAll('[data-theme-text]')).toHaveLength(THEME_TOKENS.length)
  })

  it('shows the file’s color for a token it holds and the base’s for one it leaves out', async () => {
    await mount(SELECT_MINE)
    expect(fieldOf('background').value).toBe('#101418')
    expect(fieldOf('foreground').value).not.toBe('')
    expect(document.querySelector('[data-theme-editing]')?.textContent).toContain('based on Dark')
  })
})

describe('ISC-455: typing a color', () => {
  it.each([
    ['#ff8800', 'hex', '#ff8800'],
    ['oklch(0.7 0.1 200)', 'oklch', 'oklch(0.7 0.1 200)'],
    // Either format can be typed in either mode, and what is written follows the mode (ISC-469).
    ['oklch(0.7 0.1 200)', 'hex', formatColor('oklch(0.7 0.1 200)', 'hex')],
    ['#ff8800', 'oklch', formatColor('#ff8800', 'oklch')],
  ])('writes and applies %s on Enter in %s mode as %s', async (typed, mode, written) => {
    await mount(withThemes({ colorFormat: mode }))
    await type('primary', typed)
    await settledThemes()
    expect(fileColors('mine').primary).toBe(written)
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe(written)
    expect(rowOf('primary').querySelector('[data-theme-error]')).toBeNull()
  })

  it('writes on leaving the field, too', async () => {
    await mount(SELECT_MINE)
    await type('primary', '#ff8800', 'change')
    await settledThemes()
    expect(fileColors('mine').primary).toBe('#ff8800')
  })

  it.each([
    ['red', 'a named color'],
    ['#12', 'a short hex'],
    ['', 'nothing'],
    ['url(x)', 'a url'],
  ])('refuses %j (%s), shows why, and writes nothing', async (value) => {
    await mount(SELECT_MINE)
    await type('primary', value)
    await settledThemes()
    expect(host.files.read(themeFile('mine'))).toBe(MINE)
    expect(
      rowOf('primary').querySelector('[data-theme-error]')?.textContent?.length,
    ).toBeGreaterThan(5)
    expect(fieldOf('primary').getAttribute('aria-invalid')).toBe('true')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
  })

  it('drops a refused value on Escape and shows the file’s color again', async () => {
    await mount(SELECT_MINE)
    const before = fieldOf('primary').value
    await type('primary', 'red')
    fieldOf('primary').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    expect(rowOf('primary').querySelector('[data-theme-error]')).toBeNull()
    expect(fieldOf('primary').value).toBe(before)
  })

  it('writes nothing when the value typed is the one already there', async () => {
    await mount(SELECT_MINE)
    await type('background', '#101418')
    await settledThemes()
    expect(host.files.read(themeFile('mine'))).toBe(MINE)
  })

  it('has a picker for an opaque color and none for a color with alpha', async () => {
    await mount({
      [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
      [themeFile('mine')]: '{ "colors": { "background": "#101418", "border": "#ffffff80" } }',
    })
    expect(rowOf('background').querySelector('[data-theme-picker]')).not.toBeNull()
    expect(rowOf('border').querySelector('[data-theme-picker]')).toBeNull()
    expect(rowOf('border').querySelector('[data-theme-text]')).not.toBeNull()
    const picker = rowOf('background').querySelector<HTMLInputElement>('[data-theme-picker]')
    expect(picker?.value).toBe('#101418')
  })

  it('applies and writes what the picker chooses', async () => {
    await mount(SELECT_MINE)
    const picker = rowOf('background').querySelector<HTMLInputElement>('[data-theme-picker]')
    if (picker === null) throw new Error('no picker')
    picker.value = '#224466'
    picker.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('#224466')
    await flushThemeColors()
    await settledThemes()
    expect(fileColors('mine').background).toBe('#224466')
  })

  it('writes what the picker chooses in the chosen format (ISC-469)', async () => {
    await mount(withThemes({ colorFormat: 'oklch' }))
    const picker = rowOf('background').querySelector<HTMLInputElement>('[data-theme-picker]')
    if (picker === null) throw new Error('no picker')
    picker.value = '#224466'
    picker.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await flushThemeColors()
    await settledThemes()
    expect(fileColors('mine').background).toBe(formatColor('#224466', 'oklch'))
    expect(fileColors('mine').background).toMatch(/^oklch\(/)
  })
})

describe('ISC-467: every color in the chosen format', () => {
  const MIXED = JSON.stringify({
    base: 'dark',
    colors: {
      background: '#101418',
      foreground: 'oklch(0.9 0.01 262)',
      primary: '#FFF',
      border: '#ffffff80',
      accent: 'oklch(0.7 0.1 200 / 50%)',
    },
  })
  const mixed = (themes: Record<string, unknown>): Record<string, string> => ({
    ...withThemes(themes),
    [themeFile('mine')]: MIXED,
  })

  it('shows hex by default: a hex color as written, an oklch color converted, alpha kept', async () => {
    await mount(mixed({}))
    expect(fieldOf('background').value).toBe('#101418')
    expect(fieldOf('primary').value).toBe('#FFF')
    expect(fieldOf('foreground').value).toBe(formatColor('oklch(0.9 0.01 262)', 'hex'))
    expect(fieldOf('foreground').value).toMatch(/^#[0-9a-f]{6}$/)
    expect(fieldOf('border').value).toBe('#ffffff80')
    expect(fieldOf('accent').value).toMatch(/^#[0-9a-f]{8}$/)
  })

  it('shows oklch when asked: an oklch color as written, a hex color converted, alpha kept', async () => {
    await mount(mixed({ colorFormat: 'oklch' }))
    expect(fieldOf('foreground').value).toBe('oklch(0.9 0.01 262)')
    expect(fieldOf('accent').value).toBe('oklch(0.7 0.1 200 / 50%)')
    expect(fieldOf('background').value).toMatch(/^oklch\(/)
    expect(fieldOf('border').value).toMatch(/^oklch\(.* \/ 0\.502\)$/)
    // Every field holds a color a theme file accepts.
    for (const field of document.querySelectorAll<HTMLInputElement>('[data-theme-text]'))
      expect(field.value).toMatch(/^oklch\(|^#/)
  })

  it('changes the fields as soon as the setting changes', async () => {
    await mount(mixed({}))
    expect(fieldOf('foreground').value).toMatch(/^#/)
    settings.themes.colorFormat = 'oklch'
    await flush()
    expect(fieldOf('foreground').value).toBe('oklch(0.9 0.01 262)')
  })
})

describe('ISC-470: the format only changes how colors are shown', () => {
  it('writes no theme file when the setting changes', async () => {
    await mount(withThemes({}))
    const before = host.files.read(themeFile('mine'))
    settings.themes.colorFormat = 'oklch'
    await flush()
    settings.themes.colorFormat = 'hex'
    await flush()
    expect(host.files.read(themeFile('mine'))).toBe(before)
  })

  it('keeps an oklch color in the file when what is typed converts to the hex it shows', async () => {
    const original = 'oklch(0.9 0.01 262)'
    const file = JSON.stringify({ base: 'dark', colors: { foreground: original } })
    await mount({ ...withThemes({}), [themeFile('mine')]: file })
    expect(fieldOf('foreground').value).toBe(formatColor(original, 'hex'))
    // The same color in the other format: a draft is made, and nothing is written for it.
    await type('foreground', original)
    await type('foreground', original, 'change')
    await settledThemes()
    await flushThemeColors()
    expect(host.files.read(themeFile('mine'))).toBe(file)
    expect(fieldOf('foreground').value).toBe(formatColor(original, 'hex'))
  })
})

describe('ISC-456: a pair under its floor, with the warnings on', () => {
  const warningsOf = (token: string): string[] =>
    [...rowOf(token).querySelectorAll('[data-theme-warning]')].map((line) =>
      line.textContent.trim(),
    )

  it('says nothing for a theme that passes', async () => {
    await mount(SHOW_WARNINGS())
    expect(document.querySelectorAll('[data-theme-warning]')).toHaveLength(0)
  })

  it('names the pair, the ratio and the floor, writes the value anyway, and clears when fixed', async () => {
    await mount(SHOW_WARNINGS())
    await type('foreground', '#111418')
    await settledThemes()
    expect(fileColors('mine').foreground).toBe('#111418')
    const lines = warningsOf('foreground')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]).toMatch(/on .*contrast \d+\.\d{2}.* at least 7/)
    expect(warningsOf('background').length).toBeGreaterThan(0)
    await type('foreground', '#f0f0f0')
    await settledThemes()
    expect(warningsOf('foreground')).toEqual([])
    expect(warningsOf('background')).toEqual([])
  })

  it('checks a pair through the base for the tokens the file leaves out', async () => {
    // Only the page is overridden: it is made as light as the base's light text.
    await mount(SHOW_WARNINGS('{ "base": "dark", "colors": { "background": "#eeeeee" } }'))
    expect(warningsOf('foreground').length).toBeGreaterThan(0)
    expect(warningsOf('background').length).toBeGreaterThan(0)
  })
})

describe('ISC-465: the warnings are hidden by default', () => {
  const LOW = '{ "base": "dark", "colors": { "background": "#eeeeee" } }'

  it('is true by default, and shows no contrast line for a pair under its floor', async () => {
    expect(settings.themes.hideContrastWarnings).toBe(true)
    await mount({ ...SELECT_MINE, [themeFile('mine')]: LOW })
    expect(document.querySelectorAll('[data-theme-warning]')).toHaveLength(0)
  })

  it('shows the lines when the setting is false, and hides them again when it is true', async () => {
    await mount(SHOW_WARNINGS(LOW))
    expect(document.querySelectorAll('[data-theme-warning]').length).toBeGreaterThan(0)
    settings.themes.hideContrastWarnings = true
    await flush()
    expect(document.querySelectorAll('[data-theme-warning]')).toHaveLength(0)
  })

  it('still writes a color that brings a pair under its floor, whatever the setting', async () => {
    await mount(SELECT_MINE)
    await type('foreground', '#111418')
    await settledThemes()
    expect(fileColors('mine').foreground).toBe('#111418')
  })
})

describe('ISC-480: Reset a color to its palette', () => {
  const resetOf = (token: string): HTMLElement | null =>
    rowOf(token).querySelector<HTMLElement>('[data-theme-reset]')

  it('shows a reset button on a color that differs from the base, and none on one that equals it or is left out', async () => {
    const equal = baseColorOf('dark', 'foreground') ?? ''
    await mount({
      [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
      [themeFile('mine')]: JSON.stringify({
        base: 'dark',
        colors: { background: '#101418', foreground: equal },
      }),
    })
    expect(resetOf('background')).not.toBeNull()
    expect(resetOf('foreground')).toBeNull()
    expect(resetOf('primary')).toBeNull()
  })

  it('takes a color that is the same one in another format as equal', async () => {
    const hex = formatColor(baseColorOf('dark', 'primary') ?? '', 'hex')
    await mount({
      [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
      [themeFile('mine')]: JSON.stringify({ base: 'dark', colors: { primary: hex } }),
    })
    expect(resetOf('primary')).toBeNull()
  })

  it('writes the palette color back, in the chosen format, and the button goes', async () => {
    await mount(withThemes({ colorFormat: 'oklch' }))
    expect(resetOf('background')).not.toBeNull()
    resetOf('background')?.click()
    await flush()
    await settledThemes()
    await flush()
    expect(fileColors('mine').background).toBe(
      formatColor(baseColorOf('dark', 'background') ?? '', 'oklch'),
    )
    expect(resetOf('background')).toBeNull()
  })

  it('shows the button on a color just typed, and it undoes it', async () => {
    await mount(SELECT_MINE)
    await type('primary', '#ff8800')
    await settledThemes()
    await flush()
    expect(resetOf('primary')).not.toBeNull()
    resetOf('primary')?.click()
    await flush()
    await settledThemes()
    await flush()
    expect(resetOf('primary')).toBeNull()
  })
})

describe('ISC-479: the Based on switch', () => {
  it('shows Dark, Light and Sepia with the base pressed, and changes it keeping the colors', async () => {
    await mount(SELECT_MINE)
    const buttons = [...document.querySelectorAll<HTMLElement>('[data-theme-base]')]
    expect(buttons.map((one) => one.dataset.themeBase)).toEqual(['dark', 'light', 'sepia'])
    expect(
      buttons
        .filter((one) => one.getAttribute('aria-pressed') === 'true')
        .map((one) => one.dataset.themeBase),
    ).toEqual(['dark'])
    const before = fieldOf('foreground').value
    document.querySelector<HTMLElement>('[data-theme-base="light"]')?.click()
    await flush()
    await settledThemes()
    await flush()
    expect(document.querySelector('[data-theme-base="light"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(fieldOf('foreground').value).toBe(before)
    expect(fileColors('mine').foreground).toBeDefined()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('is not there for a built-in theme', async () => {
    await mount()
    expect(document.querySelector('[data-theme-base-switch]')).toBeNull()
  })
})
