// @vitest-environment jsdom
/**
 * The sub-groups of the Settings screen (P8-T5, ISC-462 to ISC-464 and ISC-466): Theme, Fonts and
 * Theme colors in Appearance, the color groups of the editor, the groups of the Keyboard page. They
 * share one heading, drawn in the theme's primary color, so a group stands apart from the page title
 * and from the labels of its rows. jsdom has no stylesheet, so the color is checked as the class
 * that means `--primary`; the drawn color is measured in the real window.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { resetDocuments } from '@/documents/store'
import { loadKeybindings, resetKeybindingsState } from '@/features/keybindings/store'
import SettingsView from '@/features/settings/SettingsView.vue'
import { loadSettings, resetSettingsState, watchSettingsFile } from '@/features/settings/store'
import { loadThemes, resetThemesState, watchThemesFolder } from '@/features/themes/store'
import { resetSettings } from '@/lib/settings'
import type { SettingsCategory } from '@/lib/settingsCategories'
import { setHost } from '@/platform'
import {
  createMockHost,
  MOCK_SETTINGS_FILE,
  MOCK_THEMES_FOLDER,
  type MockHost,
} from '@/platform/mock'
import { clearCommands } from '@/workbench/commands'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { openSettingsTab, resetWorkbench } from '@/workbench/store'
import { tooltipApp } from '../helpers/tooltips'
import { parseJsonc } from '../helpers/jsonc'

// The select opens on a pointer press and moves with pointer capture, which jsdom does not have.
Object.assign(HTMLElement.prototype, {
  hasPointerCapture: () => false,
  setPointerCapture: () => undefined,
  releasePointerCapture: () => undefined,
  scrollIntoView: () => undefined,
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

let host: MockHost
let screen: { app: App; root: HTMLElement } | undefined
let removeCommands: (() => void) | undefined
const stops: (() => void)[] = []

const MINE = JSON.stringify({ base: 'dark', colors: { background: '#101418' } })
const SELECT_MINE = {
  [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
  [`${MOCK_THEMES_FOLDER}/mine.json`]: MINE,
}

async function mountScreen(
  category: SettingsCategory,
  files: Record<string, string> = {},
): Promise<void> {
  host = createMockHost({ files })
  setHost(host)
  await loadSettings()
  await loadThemes()
  await loadKeybindings()
  stops.push(await watchSettingsFile(), await watchThemesFolder())
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(SettingsView, { tabId: openSettingsTab(category) })
  app.mount(root)
  screen = { app, root }
  await flush()
}

beforeEach(() => {
  clearCommands()
  removeCommands = registerDefaultCommands()
  resetSettings()
  resetSettingsState()
  resetThemesState()
  resetKeybindingsState()
  document.documentElement.className = 'dark'
  document.documentElement.removeAttribute('style')
})

afterEach(() => {
  while (stops.length > 0) stops.pop()?.()
  screen?.app.unmount()
  screen?.root.remove()
  screen = undefined
  document.body.replaceChildren()
  removeCommands?.()
  clearCommands()
  resetDocuments()
  resetWorkbench()
  setHost(undefined)
})

const headings = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-sub-group-heading]'),
]
const texts = (): string[] => headings().map((heading) => heading.textContent.trim())
const pageTitle = (): HTMLElement => {
  const title = document.querySelector<HTMLElement>('[data-settings-heading]')
  if (title === null) throw new Error('no page title')
  return title
}

describe('ISC-462: every sub-group heading is drawn in the primary color', () => {
  it('on Appearance: Theme, Fonts, Theme colors and the five color groups', async () => {
    await mountScreen('appearance', SELECT_MINE)
    expect(texts()).toEqual([
      'Theme',
      'Fonts',
      'Theme colors',
      'Core',
      'Sidebar',
      'Chrome',
      'Editor',
      'Syntax',
    ])
    for (const heading of headings()) {
      expect(heading.classList.contains('text-primary')).toBe(true)
      expect(heading.classList.contains('text-foreground')).toBe(false)
    }
  })

  it('on Keyboard: every group heading, and not the page title', async () => {
    await mountScreen('keyboard')
    const groups = [...document.querySelectorAll<HTMLElement>('[data-keyboard-group-heading]')]
    expect(groups.length).toBeGreaterThanOrEqual(6)
    expect(headings()).toEqual(groups)
    for (const heading of groups) expect(heading.classList.contains('text-primary')).toBe(true)
  })

  it('leaves the page title in the text color', async () => {
    await mountScreen('appearance')
    expect(pageTitle().tagName).toBe('H1')
    expect(pageTitle().classList.contains('text-primary')).toBe(false)
  })
})

describe('ISC-463: one component draws every sub-group heading', () => {
  const sources = import.meta.glob<string>('/src/features/{settings,themes}/**/*.vue', {
    query: '?raw',
    import: 'default',
    eager: true,
  })

  it('has no h2 or h3 written out in the settings or theme features', () => {
    const files = Object.keys(sources)
    expect(files.length).toBeGreaterThan(5)
    expect(files.some((file) => file.endsWith('SubGroupHeading.vue'))).toBe(true)
    const offenders = files.filter((file) => /<h[23][\s>]/.test(sources[file] ?? ''))
    expect(offenders).toEqual([])
  })

  it('has the heading on a different level for a group inside a group, and the same color', async () => {
    await mountScreen('appearance', SELECT_MINE)
    const levels = new Map(
      headings().map((heading) => [heading.textContent.trim(), heading.tagName]),
    )
    expect(levels.get('Theme colors')).toBe('H2')
    expect(levels.get('Core')).toBe('H3')
  })
})

describe('ISC-464: the Appearance rows sit under their headings', () => {
  it('puts the Theme row under Theme and the five font rows under Fonts, in that order', async () => {
    await mountScreen('appearance')
    const nodes = [
      ...document.querySelectorAll<HTMLElement>('[data-sub-group-heading], [data-setting-row]'),
    ]
    const order = nodes.map((node) =>
      node.matches('[data-sub-group-heading]')
        ? `# ${node.textContent.trim()}`
        : (node.dataset.settingRow ?? ''),
    )
    expect(order).toEqual([
      '# Theme',
      'theme',
      '# Fonts',
      'fonts.heading',
      'fonts.body',
      'fonts.code',
      'fonts.size',
      'fonts.codeSize',
      'fonts.headingScale',
      '# Theme colors',
      'themes.colorFormat',
    ])
  })

  it('shows no heading in a search, whatever the rows are', async () => {
    await mountScreen('appearance')
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')
    if (search === null) throw new Error('no search box')
    search.value = 'font'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(document.querySelectorAll('[data-setting-row]').length).toBeGreaterThan(2)
    expect(headings()).toHaveLength(0)
  })
})

describe('ISC-466: Show colors as is the first row of Theme colors; Hide contrast warnings is in the editor', () => {
  const fileObject = (): unknown => {
    const text = host.files.read(MOCK_SETTINGS_FILE)
    return text === undefined ? undefined : parseJsonc(text)
  }

  it('comes before every color row of the editor', async () => {
    await mountScreen('appearance', SELECT_MINE)
    const rows = document.querySelector('[data-setting-row="themes.colorFormat"]')
    const editor = document.querySelector('[data-theme-colors]')
    if (rows === null || editor === null) throw new Error('missing')
    // The rows are in the page before the editor's own section.
    expect(rows.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the switch only while a user theme is edited, right above Core', async () => {
    await mountScreen('appearance')
    expect(document.querySelector('[data-setting-row="themes.hideContrastWarnings"]')).toBeNull()
    expect(document.querySelector('[data-theme-customize]')).not.toBeNull()
    document.querySelector<HTMLElement>('[data-theme-customize]')?.click()
    await flush()
    await flush()
    const row = document.querySelector('[data-setting-row="themes.hideContrastWarnings"]')
    const core = document.querySelector('[data-theme-group="core"]')
    if (row === null || core === null) throw new Error('missing')
    expect(
      document.querySelectorAll('[data-setting-row="themes.hideContrastWarnings"]'),
    ).toHaveLength(1)
    expect(row.compareDocumentPosition(core) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(core.previousElementSibling).toBe(row)
  })

  it('is not in a search for it, since it belongs to the editor', async () => {
    await mountScreen('appearance', SELECT_MINE)
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')
    if (search === null) throw new Error('no search box')
    search.value = 'contrast'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(
      document.querySelectorAll('[data-setting-row="themes.hideContrastWarnings"]'),
    ).toHaveLength(0)
  })

  it('writes the switch to settings.json, and the default is back when it is turned back', async () => {
    await mountScreen('appearance', SELECT_MINE)
    const toggle = document.querySelector<HTMLElement>(
      '[data-setting-row="themes.hideContrastWarnings"] [role="switch"]',
    )
    if (toggle === null) throw new Error('no switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    toggle.click()
    await flush()
    expect(fileObject()).toMatchObject({ theme: 'mine', themes: { hideContrastWarnings: false } })
    toggle.click()
    await flush()
    expect(JSON.stringify(fileObject())).not.toContain('hideContrastWarnings')
  })

  it('writes the format choice to settings.json', async () => {
    await mountScreen('appearance', SELECT_MINE)
    const trigger = document.querySelector<HTMLElement>(
      '[data-setting-row="themes.colorFormat"] [role="combobox"]',
    )
    if (trigger === null) throw new Error('no select')
    expect(trigger.textContent).toContain('Hex')
    trigger.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
    )
    trigger.click()
    await flush()
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (one) => one.textContent.trim() === 'OKLCH',
    )
    if (option === undefined) throw new Error('no OKLCH option')
    option.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }),
    )
    await flush()
    expect(fileObject()).toMatchObject({ themes: { colorFormat: 'oklch' } })
  })
})
