// @vitest-environment jsdom
/**
 * The theme on the Settings screen (P8-T3): the Theme row offers every theme there is and shows
 * what is wrong with the chosen one (ISC-448, 452), the colour editor sits under the Appearance
 * rows (ISC-454), and Advanced has the button that opens the themes folder (ISC-457).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
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
import { openSettingsTab, resetWorkbench } from '@/workbench/store'
import { tooltipApp } from '../helpers/tooltips'

// The select opens on a pointer press and moves with pointer capture, which jsdom does not have.
Object.assign(HTMLElement.prototype, {
  hasPointerCapture: () => false,
  setPointerCapture: () => undefined,
  releasePointerCapture: () => undefined,
  scrollIntoView: () => undefined,
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const themeFile = (name: string): string => `${MOCK_THEMES_FOLDER}/${name}.json`

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

let host: MockHost
let screen: { app: App; root: HTMLElement } | undefined
const stops: (() => void)[] = []

async function mountScreen(
  category: SettingsCategory,
  files: Record<string, string> = {},
): Promise<void> {
  host = createMockHost({ files })
  setHost(host)
  await loadSettings()
  await loadThemes()
  stops.push(await watchSettingsFile(), await watchThemesFolder())
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(SettingsView, { tabId: openSettingsTab(category) })
  app.mount(root)
  screen = { app, root }
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
  screen?.app.unmount()
  screen?.root.remove()
  screen = undefined
  resetWorkbench()
  setHost(undefined)
})

const themeRow = (): HTMLElement => {
  const row = document.querySelector<HTMLElement>('[data-setting-row="theme"]')
  if (row === null) throw new Error('no theme row')
  return row
}

async function openThemeList(): Promise<string[]> {
  const trigger = themeRow().querySelector<HTMLElement>('[role="combobox"]')
  if (trigger === null) throw new Error('no select')
  trigger.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
  )
  trigger.click()
  await flush()
  return [...document.querySelectorAll('[role="option"]')].map((option) =>
    option.textContent.trim(),
  )
}

describe('the Theme row', () => {
  it('offers Dark, Light, Sepia and System, and each user theme after them', async () => {
    await mountScreen('appearance', {
      [themeFile('mine')]: '{ "name": "Mine", "colors": {} }',
    })
    expect(await openThemeList()).toEqual(['Dark', 'Light', 'Sepia', 'System', 'Mine'])
  })

  it('shows what is wrong with the chosen theme under the row', async () => {
    await mountScreen('appearance', { [MOCK_SETTINGS_FILE]: '{ "theme": "ghost" }' })
    expect(themeRow().querySelector('[data-setting-error]')?.textContent).toContain('ghost')
  })

  it('shows nothing under the row when the theme is fine', async () => {
    await mountScreen('appearance')
    expect(themeRow().querySelector('[data-setting-error]')).toBeNull()
  })

  it('follows a theme file that appears for a name that had none', async () => {
    await mountScreen('appearance', { [MOCK_SETTINGS_FILE]: '{ "theme": "ghost" }' })
    host.files.write(themeFile('ghost'), '{ "base": "light", "colors": {} }')
    await flush()
    expect(themeRow().querySelector('[data-setting-error]')).toBeNull()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('the color editor', () => {
  it('is under the Appearance rows, and nowhere else', async () => {
    await mountScreen('appearance')
    expect(document.querySelector('[data-theme-colors]')).not.toBeNull()
    expect(
      document
        .querySelector('[data-setting-row="theme"]')
        ?.compareDocumentPosition(document.querySelector('[data-theme-colors]') ?? document.body),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it.each(['editor', 'files', 'advanced'] as const)('is not on the %s page', async (category) => {
    await mountScreen(category)
    expect(document.querySelector('[data-theme-colors]')).toBeNull()
  })

  it('is not in the search results', async () => {
    await mountScreen('appearance')
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')
    if (search === null) throw new Error('no search')
    search.value = 'theme'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(document.querySelector('[data-theme-colors]')).toBeNull()
  })
})

describe('ISC-457: Open themes folder', () => {
  it('is a button on the Advanced page that makes the folder and shows it', async () => {
    await mountScreen('advanced')
    expect(host.files.isFolder(MOCK_THEMES_FOLDER)).toBe(false)
    const button = document.querySelector<HTMLButtonElement>('[data-open-themes-folder]')
    expect(button?.textContent.trim()).toBe('Open themes folder')
    button?.click()
    await flush()
    expect(host.files.isFolder(MOCK_THEMES_FOLDER)).toBe(true)
    expect(host.openedFolders).toEqual([MOCK_THEMES_FOLDER])
  })
})
