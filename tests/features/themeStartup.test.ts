// @vitest-environment jsdom
/**
 * ISC-458: the page puts the saved theme on the page before it asks the host to show the window,
 * so the first thing seen is the chosen theme and not a flash of Dark.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, type App as VueApp } from 'vue'
import App from '@/App.vue'
import { resetSettingsState } from '@/features/settings/store'
import { resetThemesState } from '@/features/themes/store'
import { resetSettings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, MOCK_SETTINGS_FILE, MOCK_THEMES_FOLDER } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'
import { resetDocuments } from '@/documents/store'
import '../helpers/tooltips'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let mounted: { app: VueApp; element: HTMLElement } | undefined

beforeEach(() => {
  resetSettings()
  resetSettingsState()
  resetThemesState()
  document.documentElement.className = 'dark'
  document.documentElement.dataset.theme = 'dark'
  document.documentElement.removeAttribute('style')
  Object.assign(globalThis, {
    requestAnimationFrame: (run: () => void) => setTimeout(run, 0),
  })
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.element.remove()
  mounted = undefined
  resetDocuments()
  resetWorkbench()
  setHost(undefined)
})

/** Starts the app and returns what the root looked like at the moment the window was shown. */
async function shownWith(files: Record<string, string>): Promise<{
  theme: string | undefined
  dark: boolean
  background: string
}> {
  const host = createMockHost({ files })
  let seen: { theme: string | undefined; dark: boolean; background: string } | undefined
  const original = host.showWindow.bind(host)
  host.showWindow = () => {
    const root = document.documentElement
    seen = {
      theme: root.dataset.theme,
      dark: root.classList.contains('dark'),
      background: root.style.getPropertyValue('--background'),
    }
    return original()
  }
  setHost(host)
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp(App)
  app.mount(element)
  mounted = { app, element }
  for (let round = 0; round < 30 && seen === undefined; round++) await settle()
  if (seen === undefined) throw new Error('the window was never shown')
  return seen
}

describe('ISC-458: the theme is on the page before the window is shown', () => {
  it('shows a built-in theme', async () => {
    expect(await shownWith({ [MOCK_SETTINGS_FILE]: '{ "theme": "sepia" }' })).toMatchObject({
      theme: 'sepia',
      dark: false,
    })
  })

  it('shows Light', async () => {
    expect(await shownWith({ [MOCK_SETTINGS_FILE]: '{ "theme": "light" }' })).toMatchObject({
      theme: 'light',
      dark: false,
    })
  })

  it('shows a user theme with its colors', async () => {
    expect(
      await shownWith({
        [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
        [`${MOCK_THEMES_FOLDER}/mine.json`]:
          '{ "base": "light", "colors": { "background": "#123456" } }',
      }),
    ).toEqual({ theme: 'light', dark: false, background: '#123456' })
  })

  it('shows Dark when nothing is saved', async () => {
    expect(await shownWith({})).toMatchObject({ theme: 'dark', dark: true })
  })
})
