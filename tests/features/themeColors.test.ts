// @vitest-environment jsdom
/**
 * The color editor on the Appearance page (ISC-454 to ISC-456): every token of the theme in force,
 * in groups; a text field that checks what is typed; a picker only where it can hold the color; a
 * warning when a required pair falls under its floor. Customize is what a built-in theme offers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { flushThemeColors } from '@/features/themes/customize'
import { loadSettings, resetSettingsState } from '@/features/settings/store'
import {
  loadThemes,
  resetThemesState,
  settledThemes,
  watchThemesFolder,
} from '@/features/themes/store'
import ThemeColors from '@/features/themes/ThemeColors.vue'
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
  const app = createApp(ThemeColors)
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

describe('a built-in theme', () => {
  it('has no editor, only Customize, which copies it and opens the copy for editing', async () => {
    await mount()
    expect(document.querySelector('[data-theme-builtin]')?.textContent).toContain('built in')
    expect(document.querySelectorAll('[data-theme-token]')).toHaveLength(0)
    document.querySelector<HTMLElement>('[data-theme-customize]')?.click()
    await flush()
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
  it.each(['#ff8800', 'oklch(0.7 0.1 200)'])('writes and applies %s on Enter', async (value) => {
    await mount(SELECT_MINE)
    await type('primary', value)
    await settledThemes()
    expect(fileColors('mine').primary).toBe(value)
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe(value)
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
})

describe('ISC-456: a pair under its floor', () => {
  const warningsOf = (token: string): string[] =>
    [...rowOf(token).querySelectorAll('[data-theme-warning]')].map((line) =>
      line.textContent.trim(),
    )

  it('says nothing for a theme that passes', async () => {
    await mount(SELECT_MINE)
    expect(document.querySelectorAll('[data-theme-warning]')).toHaveLength(0)
  })

  it('names the pair, the ratio and the floor, writes the value anyway, and clears when fixed', async () => {
    await mount(SELECT_MINE)
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
    await mount({
      [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
      [themeFile('mine')]: '{ "base": "dark", "colors": { "background": "#eeeeee" } }',
    })
    expect(warningsOf('foreground').length).toBeGreaterThan(0)
    expect(warningsOf('background').length).toBeGreaterThan(0)
  })
})
