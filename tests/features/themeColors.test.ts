// @vitest-environment jsdom
/**
 * The color editor on the Appearance page (ISC-454 to ISC-456): every token of the theme in force,
 * in groups; a text field that checks what is typed; a picker popover for every color, with alpha; a
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
import { formatColor, fromHsv, parseColor, toHexString, toHsv, tryParseColor } from '@/lib/color'
import { resetSettings, settings } from '@/lib/settings'
import { THEME_GROUPS, THEME_TOKENS, tokensOf } from '@/lib/themeTokens'
import { usageOf } from '@/lib/themeTokenUsage'
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
    expect(document.querySelector('[data-theme-base-name]')?.textContent?.trim()).toBe('Dark')
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

describe('ISC-541: the base of a theme is a name', () => {
  it('reads "Based on Dark" with no control that changes it', async () => {
    await mount(SELECT_MINE)
    const line = document.querySelector('[data-theme-base]')
    expect(line).not.toBeNull()
    expect(line?.textContent).toContain('Based on')
    expect(document.querySelector('[data-theme-base-name]')?.textContent?.trim()).toBe('Dark')
    expect(line?.querySelector('button, [role="radio"], [data-slot="toggle-group"]')).toBeNull()
  })

  it('names the base the file has, whatever it is', async () => {
    await mount({
      [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
      [themeFile('mine')]: '{ "name": "Mine", "base": "sepia", "colors": {} }',
    })
    expect(document.querySelector('[data-theme-base-name]')?.textContent?.trim()).toBe('Sepia')
  })

  it('is not there for a built-in theme', async () => {
    await mount()
    expect(document.querySelector('[data-theme-base]')).toBeNull()
  })
})

describe('ISC-540: a token says where the app uses it', () => {
  async function hover(element: Element | null | undefined): Promise<void> {
    if (!element) throw new Error('nothing to hover')
    element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    await flush()
  }
  const labelOf = (token: string): Element | null =>
    document.querySelector(`[data-theme-token="${token}"] [data-theme-token-label]`)
  const hint = (): string =>
    document.body.querySelector('[data-hover-hint]')?.textContent?.trim() ?? ''

  it('shows the sentence of --destructive-foreground when its name is hovered', async () => {
    await mount(SELECT_MINE)
    await hover(labelOf('destructive-foreground'))
    expect(hint()).toContain(usageOf('destructive-foreground'))
    expect(hint()).toContain('close-window button')
  })

  it.each(['background', 'primary', 'syntax-keyword', 'drop-preview'])(
    'shows the sentence of %s',
    async (token) => {
      await mount(SELECT_MINE)
      await hover(labelOf(token))
      expect(hint()).toContain(usageOf(token))
      expect(hint().length).toBeGreaterThan(10)
    },
  )

  it('puts the hover on the name of every token, so each row has one', async () => {
    await mount(SELECT_MINE)
    const rows = [...document.querySelectorAll<HTMLElement>('[data-theme-token]')]
    expect(rows.length).toBe(THEME_TOKENS.length)
    for (const row of rows)
      expect(row.querySelector('[data-theme-token-label]'), row.dataset.themeToken).not.toBeNull()
  })
})
describe('the color picker popover (ISC-492 to ISC-496)', () => {
  const COLORS: Record<string, string> = {
    background: '#101418',
    'scrollbar-thumb': 'oklch(0.6 0.014 262 / 38%)',
    primary: 'oklch(0.8 0.4 150)',
    caret: '#3366cc',
  }
  const files = (extra: Record<string, unknown> = {}): Record<string, string> => ({
    [MOCK_SETTINGS_FILE]: JSON.stringify({ theme: 'mine', ...extra }),
    [themeFile('mine')]: JSON.stringify({ base: 'dark', colors: COLORS }),
  })
  const swatchOf = (token: string): HTMLButtonElement => {
    const button = rowOf(token).querySelector<HTMLButtonElement>('[data-theme-picker]')
    if (button === null) throw new Error(`no swatch button for ${token}`)
    return button
  }
  const panel = (): HTMLElement => {
    const found = document.querySelector<HTMLElement>('[data-theme-picker-content]')
    if (found === null) throw new Error('the popover is not open')
    return found
  }
  const part = (selector: string): HTMLElement => {
    const found = panel().querySelector<HTMLElement>(selector)
    if (found === null) throw new Error(`no ${selector} in the popover`)
    return found
  }
  const areaThumb = (): HTMLElement => part('[data-picker-area-thumb]')
  const hueThumb = (): HTMLElement => part('[data-picker-hue] [role="slider"]')
  const alphaThumb = (): HTMLElement => part('[data-picker-alpha] [role="slider"]')
  const opacityField = (): HTMLInputElement => part('[data-picker-opacity]') as HTMLInputElement
  const now = (thumb: HTMLElement): number => Number(thumb.getAttribute('aria-valuenow'))

  async function openPicker(token: string): Promise<void> {
    swatchOf(token).click()
    await flush()
    panel()
  }
  async function closeWithEscape(): Promise<void> {
    const target = document.activeElement ?? document.body
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await flush()
  }
  async function press(el: Element, key: string, shiftKey = false): Promise<void> {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    )
    await nextTick()
  }
  const pageColor = (token: string): ReturnType<typeof parseColor> =>
    parseColor(document.documentElement.style.getPropertyValue(`--${token}`))
  const pageHex = (token: string): string => toHexString(pageColor(token))
  const hsvOf = (value: string): { h: number; s: number; v: number } =>
    toHsv(tryParseColor(value) ?? parseColor('#000000'))
  /** The saturation and brightness the area holds are whole percents, so a step lands on one. */
  const expectedHex = (h: number, s: number, v: number, alpha = 1): string =>
    toHexString(fromHsv({ h, s, v }, alpha))
  async function setOpacity(text: string): Promise<void> {
    const field = opacityField()
    field.value = text
    field.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
  }

  // A pointer in jsdom: no layout, no pointer capture. The area is 200 by 100.
  const proto = Element.prototype as unknown as Record<string, unknown>
  const saved: Record<string, unknown> = {}
  beforeEach(() => {
    for (const name of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'])
      saved[name] = proto[name]
    proto.setPointerCapture = (): void => undefined
    proto.hasPointerCapture = (): boolean => true
    proto.releasePointerCapture = (): void => undefined
  })
  afterEach(async () => {
    // A color changed in a test is written a moment later; it must not land in the next test's file.
    await flushThemeColors()
    await settledThemes()
    for (const [name, value] of Object.entries(saved)) proto[name] = value
    // A popover left open keeps its portal in the page; the next test must not find it.
    for (const left of document.querySelectorAll('[data-theme-picker-content]'))
      (left.closest('[data-reka-popper-content-wrapper]') ?? left).remove()
  })
  function stubSize(el: HTMLElement, width: number, height: number): void {
    el.getBoundingClientRect = (): DOMRect => ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
  }
  async function pointer(target: Element, type: string, x: number, y: number): Promise<void> {
    const event = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    target.dispatchEvent(event)
    await nextTick()
  }
  async function drag(target: HTMLElement, points: [number, number][]): Promise<void> {
    const [first, ...rest] = points
    if (first === undefined) return
    await pointer(target, 'pointerdown', first[0], first[1])
    for (const [x, y] of rest) await pointer(target, 'pointermove', x, y)
    await pointer(target, 'pointerup', points.at(-1)?.[0] ?? 0, points.at(-1)?.[1] ?? 0)
  }

  it('gives every color one button that opens it, with no native input and no field in the row', async () => {
    await mount(files())
    const buttons = [...document.querySelectorAll('[data-theme-picker]')]
    expect(buttons).toHaveLength(THEME_TOKENS.length)
    expect(buttons.every((one) => one.tagName === 'BUTTON')).toBe(true)
    expect(document.querySelector('input[type="color"]')).toBeNull()
    expect(document.querySelector('[data-theme-opacity]')).toBeNull()
    expect(swatchOf('background').querySelector('.color-checker')).not.toBeNull()
    await openPicker('background')
    for (const selector of [
      '[data-picker-area]',
      '[data-picker-hue]',
      '[data-picker-alpha]',
      '[data-picker-opacity]',
    ])
      expect(panel().querySelector(selector), selector).not.toBeNull()
  })

  it('closes on Escape and puts the focus back on the swatch', async () => {
    await mount(files())
    await openPicker('background')
    await closeWithEscape()
    expect(document.querySelector('[data-theme-picker-content]')).toBeNull()
    expect(document.activeElement).toBe(swatchOf('background'))
  })

  it.each(Object.keys(COLORS))(
    'changes nothing when %s is opened and closed untouched',
    async (token) => {
      await mount(files())
      const before = host.files.read(themeFile('mine'))
      await openPicker(token)
      const color = tryParseColor(COLORS[token] ?? '')
      if (color === null) throw new Error('bad test color')
      // The popover shows the token's color: its opacity, and its hue unless it is a grey.
      expect(opacityField().value).toBe(String(Math.round(color.alpha * 100)))
      expect(Math.abs(now(hueThumb()) - hsvOf(COLORS[token] ?? '').h)).toBeLessThan(1)
      await closeWithEscape()
      await flushThemeColors()
      await settledThemes()
      expect(host.files.read(themeFile('mine'))).toBe(before)
    },
  )

  it('moves saturation and brightness from the keyboard, ten at a time with Shift', async () => {
    await mount(files())
    const before = hsvOf('#3366cc')
    await openPicker('caret')
    const wholeS = Math.round(before.s * 100)
    const wholeV = Math.round(before.v * 100)
    await press(areaThumb(), 'ArrowRight')
    expect(pageHex('caret')).toBe(expectedHex(before.h, (wholeS + 1) / 100, wholeV / 100))
    await press(areaThumb(), 'ArrowUp', true)
    expect(pageHex('caret')).toBe(
      expectedHex(before.h, (wholeS + 1) / 100, Math.min(1, (wholeV + 10) / 100)),
    )
  })

  it('moves the hue and the opacity from the keyboard, and the page follows', async () => {
    await mount(files())
    const before = hsvOf('#3366cc')
    await openPicker('caret')
    await press(hueThumb(), 'ArrowRight')
    const hue = now(hueThumb())
    expect(Math.abs(hue - (before.h + 1))).toBeLessThan(1.01)
    expect(pageHex('caret')).toBe(expectedHex(hue, before.s, before.v))
    await press(alphaThumb(), 'ArrowLeft')
    expect(opacityField().value).toBe('99')
    expect(pageColor('caret').alpha).toBeCloseTo(0.99, 2)
    await press(alphaThumb(), 'Home')
    expect(opacityField().value).toBe('0')
    expect(pageColor('caret').alpha).toBe(0)
    await press(alphaThumb(), 'End')
    expect(opacityField().value).toBe('100')
    expect(pageColor('caret').alpha).toBe(1)
  })

  it('shows each change on the page at once and writes the last one when the popover closes', async () => {
    await mount(files())
    const before = hsvOf('#3366cc')
    await openPicker('caret')
    for (let step = 0; step < 3; step++) await press(areaThumb(), 'ArrowLeft')
    const wanted = expectedHex(
      before.h,
      (Math.round(before.s * 100) - 3) / 100,
      Math.round(before.v * 100) / 100,
    )
    expect(pageHex('caret')).toBe(wanted)
    expect(fileColors('mine').caret).toBe('#3366cc')
    await closeWithEscape()
    await settledThemes()
    expect(fileColors('mine').caret).toBe(wanted)
  })

  it('follows a pointer drag on the area and writes one value in the chosen format', async () => {
    await mount(files({ themes: { colorFormat: 'oklch' } }))
    const before = hsvOf('#3366cc')
    await openPicker('caret')
    const area = part('[data-picker-area]')
    stubSize(area, 200, 100)
    await drag(area, [
      [100, 50],
      [150, 25],
      [200, 0],
    ])
    expect(areaThumb().getAttribute('aria-valuetext')).toBe('Saturation 100, Brightness 100')
    expect(pageHex('caret')).toBe(expectedHex(before.h, 1, 1))
    await closeWithEscape()
    await settledThemes()
    expect(fileColors('mine').caret).toMatch(/^oklch\(/)
    expect(toHexString(parseColor(fileColors('mine').caret ?? ''))).toBe(
      expectedHex(before.h, 1, 1),
    )
  })

  it('gives alpha to an opaque color, and 100 percent writes none', async () => {
    await mount(files())
    await openPicker('background')
    await setOpacity('50')
    await flushThemeColors()
    await settledThemes()
    expect(fileColors('mine').background).toMatch(/^#[0-9a-f]{6}80$/)
    await setOpacity('100')
    await flushThemeColors()
    await settledThemes()
    expect(fileColors('mine').background).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('writes the opacity in oklch when that is the format', async () => {
    await mount(files({ themes: { colorFormat: 'oklch' } }))
    await openPicker('background')
    await setOpacity('50')
    await flushThemeColors()
    await settledThemes()
    expect(fileColors('mine').background).toMatch(/^oklch\(.* \/ 0\.5\)$/)
  })

  it('refuses an opacity outside 0 to 100, or not a number, and puts the shown one back', async () => {
    await mount(files())
    const before = host.files.read(themeFile('mine'))
    await openPicker('scrollbar-thumb')
    for (const bad of ['150', '-5', 'abc', '']) {
      await setOpacity(bad)
      expect(opacityField().value, bad).toBe('38')
    }
    await flushThemeColors()
    await settledThemes()
    expect(host.files.read(themeFile('mine'))).toBe(before)
  })

  it('keeps the hue chosen while the color is black, and uses it when brightness comes back', async () => {
    await mount(files())
    await openPicker('caret')
    const area = part('[data-picker-area]')
    stubSize(area, 200, 100)
    await drag(area, [[0, 100]])
    expect(areaThumb().getAttribute('aria-valuetext')).toBe('Saturation 0, Brightness 0')
    const start = now(hueThumb())
    for (let step = 0; step < 20; step++) await press(hueThumb(), 'ArrowRight')
    const hue = now(hueThumb())
    expect(hue).toBeGreaterThan(start + 15)
    await drag(area, [[200, 0]])
    expect(pageHex('caret')).toBe(expectedHex(hue, 1, 1))
  })

  it('does not read its own write back: the hue stays where it was while the area is dragged', async () => {
    await mount(files())
    await openPicker('caret')
    const hue = now(hueThumb())
    const area = part('[data-picker-area]')
    stubSize(area, 200, 100)
    // A very pale, dark color: its 8-bit rounding would move a hue read back from it.
    await drag(area, [
      [100, 50],
      [6, 95],
      [4, 94],
    ])
    expect(now(hueThumb())).toBe(hue)
  })

  it('follows a value typed in the row while it is open', async () => {
    await mount(files())
    await openPicker('caret')
    await type('caret', '#ff0000')
    expect(now(hueThumb())).toBe(0)
    expect(areaThumb().getAttribute('aria-valuetext')).toBe('Saturation 100, Brightness 100')
    expect(opacityField().value).toBe('100')
    await type('caret', '#00ff0080')
    expect(now(hueThumb())).toBe(120)
    expect(opacityField().value).toBe('50')
  })
})
