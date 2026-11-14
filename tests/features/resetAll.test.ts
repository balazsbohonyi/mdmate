// @vitest-environment jsdom
/**
 * Reset all lives on the Advanced page, in the row of the file it resets, and asks first: the
 * Keyboard page has none (ISC-433), nothing changes until the dialog is confirmed (ISC-434), a
 * settings reset keeps the file's comments (ISC-435), and a file tab with unsaved edits is asked
 * about before anything is written (ISC-436).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import {
  documentOfTab,
  followerOfTab,
  openPath,
  resetDocuments,
  watchDisk,
} from '@/documents/store'
import {
  keybindingsFileState,
  loadKeybindings,
  resetKeybindingsState,
  watchKeybindingsFile,
} from '@/features/keybindings/store'
import { keybindingsTemplate } from '@/features/keybindings/template'
import SettingsView from '@/features/settings/SettingsView.vue'
import {
  changeSetting,
  loadSettings,
  resetSettingsState,
  settingsFileState,
  watchSettingsFile,
} from '@/features/settings/store'
import { settingsTemplate } from '@/features/settings/templates'
import { resetSettings } from '@/lib/settings'
import { setHost } from '@/platform'
import {
  createMockHost,
  MOCK_KEYBINDINGS_FILE,
  MOCK_SETTINGS_FILE,
  type MockHost,
} from '@/platform/mock'
import { clearCommands } from '@/workbench/commands'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { openSettingsTab, resetWorkbench } from '@/workbench/store'
import { parseJsonc } from '../helpers/jsonc'
import { tooltipApp } from '../helpers/tooltips'

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

const SETTINGS_WITH_ENTRIES =
  '{\n  // mine\n  "theme": "light",\n  "editor": { "wordWrap": false },\n  "gone.setting": 1\n}\n'
const KEYS_WITH_ENTRIES =
  '{\n  // mine\n  "file.new": "Mod+Shift+U",\n  "file.open": "F6",\n  "gone.command": "Mod+K"\n}\n'

/** Mounts the Settings screen on a category with both files in the mock host. */
async function mount(
  category: 'advanced' | 'keyboard',
  files: { settings?: string; keys?: string } = {},
): Promise<void> {
  host = createMockHost({
    files: {
      [MOCK_SETTINGS_FILE]: files.settings ?? SETTINGS_WITH_ENTRIES,
      [MOCK_KEYBINDINGS_FILE]: files.keys ?? KEYS_WITH_ENTRIES,
    },
  })
  setHost(host)
  await loadSettings()
  await loadKeybindings()
  stops.push(await watchSettingsFile(), await watchKeybindingsFile())
  const tab = openSettingsTab(category)
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(SettingsView, { tabId: tab })
  app.mount(root)
  screen = { app, root }
  await flush()
}

beforeEach(() => {
  clearCommands()
  resetKeybindingsState()
  resetSettings()
  resetSettingsState()
  removeCommands = registerDefaultCommands()
})

afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  screen?.app.unmount()
  screen?.root.remove()
  screen = undefined
  document.body.replaceChildren()
  removeCommands?.()
  removeCommands = undefined
  clearCommands()
  resetKeybindingsState()
  resetSettingsState()
  resetDocuments()
  resetWorkbench()
  setHost(undefined)
})

const find = <T extends HTMLElement = HTMLButtonElement>(selector: string): T | null =>
  document.body.querySelector<T>(selector)
const settingsButton = (): HTMLButtonElement | null => find('[data-reset-all-settings]')
const shortcutsButton = (): HTMLButtonElement | null => find('[data-reset-all-shortcuts]')
const dialog = (): HTMLElement | null => find('[data-reset-dialog]')
const settingsText = (): string => host.files.read(MOCK_SETTINGS_FILE) ?? ''
const keysText = (): string => host.files.read(MOCK_KEYBINDINGS_FILE) ?? ''

async function click(element: Element | null): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to click')
  element.click()
  await flush()
}

describe('ISC-433: Reset all is on the Advanced page, in the row of its file', () => {
  it('has no Reset all on the Keyboard page', async () => {
    await mount('keyboard')
    expect(find('[data-keyboard-panel]')).not.toBeNull()
    expect(find('[data-keyboard-reset-all]')).toBeNull()
    expect(settingsButton()).toBeNull()
    expect(shortcutsButton()).toBeNull()
    expect(document.body.textContent).not.toContain('Reset all')
  })

  it('puts "Reset all settings" beside Open settings.json and "Reset all shortcuts" beside Open keybindings.json', async () => {
    await mount('advanced')
    const settingsRow = find('[data-open-settings-file]')?.closest('[data-setting-action]')
    const keysRow = find('[data-open-keybindings-file]')?.closest('[data-setting-action]')
    expect(settingsRow).not.toBeNull()
    expect(keysRow).not.toBeNull()
    expect(settingsRow).not.toBe(keysRow)
    expect(settingsRow?.contains(settingsButton())).toBe(true)
    expect(keysRow?.contains(shortcutsButton())).toBe(true)
    expect(settingsButton()?.textContent.trim()).toBe('Reset all')
    expect(settingsButton()?.getAttribute('aria-label')).toBe('Reset all settings')
    expect(shortcutsButton()?.textContent.trim()).toBe('Reset all')
    expect(shortcutsButton()?.getAttribute('aria-label')).toBe('Reset all shortcuts')
  })

  it('puts Reset all before the Open button, and gives equal buttons one width in both rows', async () => {
    await mount('advanced')
    const openSettings = find('[data-open-settings-file]')
    const openKeys = find('[data-open-keybindings-file]')
    const follows = (first: Element | null, second: Element | null): boolean =>
      first !== null &&
      second !== null &&
      (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(follows(settingsButton(), openSettings)).toBe(true)
    expect(follows(shortcutsButton(), openKeys)).toBe(true)
    // jsdom has no layout, so the width is pinned by its class; the drawn widths are measured in the real window.
    const width = (el: Element | null): string | undefined =>
      el?.className.split(/\s+/).find((name) => /^w-(\d|\[)/.test(name))
    expect(width(settingsButton())).toBeDefined()
    expect(width(settingsButton())).toBe(width(shortcutsButton()))
    expect(width(openSettings)).toBeDefined()
    expect(width(openSettings)).toBe(width(openKeys))
  })
})

describe('ISC-434: nothing is reset until the dialog is confirmed', () => {
  it('asks first, names what is reset, and Cancel has the focus', async () => {
    await mount('advanced')
    expect(dialog()).toBeNull()
    await click(settingsButton())
    expect(dialog()?.getAttribute('role')).toBe('alertdialog')
    expect(dialog()?.textContent).toContain('Reset all settings?')
    expect(document.activeElement).toBe(find('[data-reset-cancel]'))
    expect(settingsText()).toBe(SETTINGS_WITH_ENTRIES)
    await click(find('[data-reset-cancel]'))
    await click(shortcutsButton())
    expect(dialog()?.textContent).toContain('Reset all shortcuts?')
    expect(keysText()).toBe(KEYS_WITH_ENTRIES)
  })

  it('Cancel and Escape leave both files as they were', async () => {
    await mount('advanced')
    await click(settingsButton())
    await click(find('[data-reset-cancel]'))
    expect(dialog()).toBeNull()
    await click(shortcutsButton())
    dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    expect(dialog()).toBeNull()
    expect(settingsText()).toBe(SETTINGS_WITH_ENTRIES)
    expect(keysText()).toBe(KEYS_WITH_ENTRIES)
  })

  it('confirming resets that file only', async () => {
    await mount('advanced')
    await click(shortcutsButton())
    await click(find('[data-reset-confirm]'))
    expect(dialog()).toBeNull()
    expect(parseJsonc(keysText())).toEqual({})
    expect(settingsText()).toBe(SETTINGS_WITH_ENTRIES)
    await click(settingsButton())
    await click(find('[data-reset-confirm]'))
    expect(parseJsonc(settingsText())).toEqual({})
  })
})

describe('ISC-435: a settings reset takes the entries out and keeps the comments', () => {
  it('removes every entry, unknown ones too, and keeps a comment of the user', async () => {
    await mount('advanced')
    await click(settingsButton())
    await click(find('[data-reset-confirm]'))
    expect(parseJsonc(settingsText())).toEqual({})
    expect(settingsText()).toContain('// mine')
  })

  it('gives the template text again when the file started as the template', async () => {
    await mount('advanced', { settings: settingsTemplate().text })
    expect(await changeSetting('theme', 'light')).toBe(true)
    expect(await changeSetting('editor.wordWrap', false)).toBe(true)
    expect(settingsText()).not.toBe(settingsTemplate().text)
    await flush()
    await click(settingsButton())
    await click(find('[data-reset-confirm]'))
    expect(settingsText()).toBe(settingsTemplate().text)
  })

  it('turns both buttons off while their file holds no entry, and on again with one', async () => {
    await mount('advanced', { settings: settingsTemplate().text, keys: keybindingsTemplate().text })
    expect(settingsButton()?.disabled).toBe(true)
    expect(shortcutsButton()?.disabled).toBe(true)
    host.files.write(MOCK_SETTINGS_FILE, '{\n  // c\n  "theme": "light"\n}\n')
    host.files.write(MOCK_KEYBINDINGS_FILE, '{\n  // c\n  "file.new": "Mod+Shift+U"\n}\n')
    await flush()
    expect(settingsFileState.text).toContain('"theme"')
    expect(keybindingsFileState.text).toContain('"file.new"')
    expect(settingsButton()?.disabled).toBe(false)
    expect(shortcutsButton()?.disabled).toBe(false)
    host.files.write(MOCK_SETTINGS_FILE, '// nothing\n{}\n')
    await flush()
    expect(settingsButton()?.disabled).toBe(true)
  })
})

describe('ISC-436: unsaved edits in the file tab are asked about before a reset', () => {
  async function dirtyTab(path: string): Promise<{ readonly text: string }> {
    const tab = await openPath(path)
    const follower = followerOfTab(tab)
    if (follower === undefined) throw new Error(`no editor for ${path}`)
    follower.dispatch({
      changes: { from: 0, to: follower.state.doc.length, insert: '{"note": "mine"}\n' },
    })
    const doc = documentOfTab(tab)
    expect(doc?.dirty).toBe(true)
    return {
      get text() {
        return doc?.master.doc.toString() ?? ''
      },
    }
  }
  const answerWith = async (selector: string, name: string): Promise<void> => {
    const button = [...(find(selector)?.querySelectorAll('button') ?? [])].find(
      (one) => one.textContent.trim() === name,
    )
    await click(button ?? null)
  }

  beforeEach(async () => {
    await watchDisk()
  })

  it('shows the question on Advanced for settings.json and writes nothing until it is answered', async () => {
    await mount('advanced')
    await dirtyTab(MOCK_SETTINGS_FILE)
    await click(settingsButton())
    await click(find('[data-reset-confirm]'))
    expect(find('[data-settings-confirm]')?.textContent).toContain('all settings')
    expect(settingsText()).toBe(SETTINGS_WITH_ENTRIES)
  })

  it('Cancel keeps the file, Save writes the tab and then resets on top of it', async () => {
    await mount('advanced')
    const tab = await dirtyTab(MOCK_SETTINGS_FILE)
    await click(settingsButton())
    await click(find('[data-reset-confirm]'))
    await answerWith('[data-settings-confirm]', 'Cancel')
    expect(find('[data-settings-confirm]')).toBeNull()
    expect(settingsText()).toBe(SETTINGS_WITH_ENTRIES)
    expect(tab.text).toBe('{"note": "mine"}\n')
    await click(settingsButton())
    await click(find('[data-reset-confirm]'))
    await answerWith('[data-settings-confirm]', 'Save')
    expect(find('[data-settings-confirm]')).toBeNull()
    expect(parseJsonc(settingsText())).toEqual({})
  })

  it("shows the question for keybindings.json too, and Don't save resets the file as it was", async () => {
    await mount('advanced')
    await dirtyTab(MOCK_KEYBINDINGS_FILE)
    await click(shortcutsButton())
    await click(find('[data-reset-confirm]'))
    expect(find('[data-keyboard-confirm]')?.textContent).toContain('all shortcuts')
    expect(keysText()).toBe(KEYS_WITH_ENTRIES)
    await answerWith('[data-keyboard-confirm]', "Don't save")
    expect(find('[data-keyboard-confirm]')).toBeNull()
    expect(parseJsonc(keysText())).toEqual({})
  })
})
