// @vitest-environment jsdom
/**
 * The Keyboard category's groups and search box (ISC-412 to ISC-419). ISC-412 and ISC-413 (what a
 * command's group is) are pinned in `tests/workbench/defaultCommands.test.ts` and `commands.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { resetDocuments } from '@/documents/store'
import {
  loadKeybindings,
  resetKeybindingsState,
  watchKeybindingsFile,
} from '@/features/keybindings/store'
import { matchesShortcutQuery } from '@/features/keybindings/shortcutSearch'
import SettingsView from '@/features/settings/SettingsView.vue'
import { resetSettingsState } from '@/features/settings/store'
import { resetSettings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, MOCK_KEYBINDINGS_FILE, type MockHost } from '@/platform/mock'
import { clearCommands, COMMAND_GROUPS, listCommands, shortcutLabel } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { openSettingsTab, resetWorkbench } from '@/workbench/store'
import { tooltipApp } from '../helpers/tooltips'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

let host: MockHost
let removeCommands: (() => void) | undefined
let removeKeys: (() => void) | undefined
let stopWatch: (() => void) | undefined
let screen: { app: App; root: HTMLElement } | undefined

async function mount(file?: string): Promise<HTMLElement> {
  host = createMockHost(file === undefined ? {} : { files: { [MOCK_KEYBINDINGS_FILE]: file } })
  setHost(host)
  await loadKeybindings()
  stopWatch = await watchKeybindingsFile()
  removeKeys = installKeybindings(window, 'other')
  const tab = openSettingsTab('keyboard')
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(SettingsView, { tabId: tab })
  app.mount(root)
  screen = { app, root }
  await flush()
  return root
}

beforeEach(() => {
  clearCommands()
  resetKeybindingsState()
  resetSettings()
  resetSettingsState()
  removeCommands = registerDefaultCommands()
})

afterEach(() => {
  stopWatch?.()
  stopWatch = undefined
  removeKeys?.()
  removeKeys = undefined
  screen?.app.unmount()
  screen?.root.remove()
  screen = undefined
  document.body.replaceChildren()
  removeCommands?.()
  removeCommands = undefined
  clearCommands()
  resetKeybindingsState()
  resetDocuments()
  resetWorkbench()
  setHost(undefined)
})

const searchBox = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>('[data-keyboard-search]')
  if (input === null) throw new Error('no shortcut search box')
  return input
}

async function type(text: string): Promise<void> {
  const input = searchBox()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}

const headings = (): string[] =>
  [...document.querySelectorAll('[data-keyboard-group-heading]')].map((one) =>
    one.textContent.trim(),
  )
const titlesIn = (group: string): string[] =>
  [
    ...document.querySelectorAll(`[data-keyboard-group][aria-label="${group}"] [data-setting-row]`),
  ].map((row) => row.querySelector('span.font-medium')?.textContent.trim() ?? '')
const rowIds = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-setting-row]')].map(
    (row) => row.dataset.settingRow ?? '',
  )

describe('ISC-414: the Keyboard category is grouped', () => {
  it('shows each group in the fixed order, A to Z inside, every command once', async () => {
    await mount()
    expect(headings()).toEqual([...COMMAND_GROUPS])
    const all: string[] = []
    for (const group of COMMAND_GROUPS) {
      const titles = titlesIn(group)
      expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)))
      all.push(...titles)
    }
    expect(all.map((title) => title.length > 0)).not.toContain(false)
    expect(titlesIn('File')).toHaveLength(10)
    expect(titlesIn('Find')).toHaveLength(5)
    expect(titlesIn('Formatting')).toHaveLength(7)
    expect(titlesIn('View')).toHaveLength(11)
    expect(titlesIn('Tabs & Navigation')).toHaveLength(6)
    expect(titlesIn('App')).toHaveLength(6)
    const ids = rowIds()
    expect(ids).toHaveLength(listCommands().length)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('ISC-415: a group with nothing found has no heading', () => {
  it('keeps only the group the search finds, and the others in their order', async () => {
    await mount()
    await type('split')
    expect(headings()).toEqual(['Tabs & Navigation'])
    expect(rowIds().sort()).toEqual([COMMAND_IDS.splitDown, COMMAND_IDS.splitRight].sort())
    // A word two groups share: they come in the fixed order, not A to Z (App would be first).
    await type('toggle')
    expect(headings()).toEqual(['View', 'App'])
    await type('ctrl+o')
    expect(headings()).toEqual(['File'])
  })
})

describe('ISC-416: the search finds by title, id, group and shortcut', () => {
  it('finds a command by a word of its title', async () => {
    await mount()
    await type('bold')
    expect(rowIds()).toEqual([COMMAND_IDS.bold])
  })

  it('finds commands by id and by the name of their group', async () => {
    await mount()
    await type('view.toggle')
    expect(rowIds().sort()).toEqual(
      [
        COMMAND_IDS.toggleSidebar,
        COMMAND_IDS.toggleRawSource,
        COMMAND_IDS.toggleWordWrap,
        COMMAND_IDS.toggleContentWidth,
      ].sort(),
    )
    await type('formatting')
    expect(headings()).toEqual(['Formatting'])
    expect(rowIds()).toHaveLength(7)
  })

  it('finds `ctrl+s` as Save and Save As, and leaves out Close All and the rest', async () => {
    await mount()
    await type('ctrl+s')
    expect(rowIds().sort()).toEqual([COMMAND_IDS.save, COMMAND_IDS.saveAs].sort())
    expect(rowIds()).not.toContain(COMMAND_IDS.closeAll)
  })

  it('finds `ctrl+shift` as every command that has a Ctrl+Shift shortcut', async () => {
    await mount()
    await type('ctrl+shift')
    const expected = listCommands()
      .filter((command) => shortcutLabel(command.id, 'other')?.startsWith('Ctrl+Shift+'))
      .map((command) => command.id)
    expect(expected.length).toBeGreaterThan(5)
    expect(rowIds().sort()).toEqual(expected.sort())
  })

  it('needs every word, so a title word and a shortcut narrow each other', async () => {
    await mount()
    await type('save ctrl+shift')
    expect(rowIds()).toEqual([COMMAND_IDS.saveAs])
  })

  it('finds a rebound command by its new shortcut and by its default one', async () => {
    await mount('{"file.new": "Mod+Shift+U"}')
    await type('ctrl+shift+u')
    expect(rowIds()).toEqual([COMMAND_IDS.newFile])
    await type('ctrl+n')
    expect(rowIds()).toContain(COMMAND_IDS.newFile)
  })

  it('treats a word without a plus as a plain piece of the text', () => {
    const save = {
      title: 'Save',
      id: 'file.save',
      group: 'File',
      shortcuts: ['Ctrl+S'],
    }
    expect(matchesShortcutQuery('', save)).toBe(true)
    expect(matchesShortcutQuery('sav', save)).toBe(true)
    expect(matchesShortcutQuery('FILE', save)).toBe(true)
    expect(matchesShortcutQuery('ctrl', save)).toBe(true)
    expect(matchesShortcutQuery('ctrl+', save)).toBe(true)
    expect(matchesShortcutQuery('ctrl+shift', save)).toBe(false)
    expect(matchesShortcutQuery('ctrl+s', { ...save, shortcuts: ['Ctrl+Shift+W'] })).toBe(false)
    expect(matchesShortcutQuery('ctrl+s', { ...save, shortcuts: [] })).toBe(false)
  })
})

describe('ISC-417: nothing found, and Escape', () => {
  it('says so, and Escape in the field brings the whole list back', async () => {
    await mount()
    await type('zzzz')
    expect(document.querySelector('[data-keyboard-empty]')?.textContent.trim()).toBe(
      'No shortcut matches that.',
    )
    expect(rowIds()).toEqual([])
    expect(headings()).toEqual([])
    searchBox().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
    )
    await flush()
    expect(searchBox().value).toBe('')
    expect(document.querySelector('[data-keyboard-empty]')).toBeNull()
    expect(rowIds()).toHaveLength(listCommands().length)
    expect(headings()).toEqual([...COMMAND_GROUPS])
  })
})

describe('ISC-418: the search box takes the keyboard from a recording row', () => {
  it('ends the recording, writes nothing, and the text lands in the field', async () => {
    await mount()
    const button = document.querySelector<HTMLButtonElement>(
      `[data-setting-row="${COMMAND_IDS.newFile}"] [data-shortcut-button]`,
    )
    if (button === null) throw new Error('no shortcut button')
    // jsdom's click does not move focus, and the recording ends on the button's blur.
    button.focus()
    button.click()
    await flush()
    expect(button.textContent).toContain('Press a shortcut')
    searchBox().focus()
    await flush()
    expect(button.textContent).not.toContain('Press a shortcut')
    await type('save')
    expect(searchBox().value).toBe('save')
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBeUndefined()
    expect(shortcutLabel(COMMAND_IDS.newFile, 'other')).toBe('Ctrl+N')
  })
})

describe('ISC-419: where the search box sits', () => {
  it('is beside the heading, which still reads only Keyboard', async () => {
    await mount()
    const heading = document.querySelector('[data-settings-heading]')
    expect(heading?.textContent.trim()).toBe('Keyboard')
    expect(heading?.contains(searchBox())).toBe(false)
    expect(heading?.parentElement?.contains(searchBox())).toBe(true)
    expect(document.querySelector('[data-settings-panel]')?.getAttribute('aria-label')).toBe(
      'Keyboard',
    )
  })

  it('leaves Search settings alone: it lists no shortcut, and the box goes with the page', async () => {
    await mount()
    const global = document.querySelector<HTMLInputElement>('[data-settings-search]')
    if (global === null) throw new Error('no global search')
    global.value = 'save'
    global.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(rowIds()).not.toContain(COMMAND_IDS.save)
    expect(document.querySelector('[data-shortcut-button]')).toBeNull()
    expect(document.querySelector('[data-keyboard-search]')).toBeNull()
  })

  it('starts empty each time the category is opened again', async () => {
    await mount()
    await type('bold')
    const advanced = document.querySelector<HTMLElement>('[data-settings-category="advanced"]')
    const keyboard = document.querySelector<HTMLElement>('[data-settings-category="keyboard"]')
    advanced?.click()
    await flush()
    keyboard?.click()
    await flush()
    expect(searchBox().value).toBe('')
    expect(rowIds()).toHaveLength(listCommands().length)
  })
})

describe('ISC-550: the content width toggle is in the Keyboard category', () => {
  it('is listed under View with its key, and is found by its title and by its key', async () => {
    await mount()
    const row = document.querySelector(`[data-setting-row="${COMMAND_IDS.toggleContentWidth}"]`)
    expect(row).not.toBeNull()
    expect(row?.closest('[data-keyboard-group]')?.getAttribute('aria-label')).toBe('View')
    expect(row?.textContent).toContain('Alt+Shift+W')
    await type('width')
    expect(rowIds()).toEqual([COMMAND_IDS.toggleContentWidth])
    await type('alt+shift+w')
    expect(rowIds()).toEqual([COMMAND_IDS.toggleContentWidth])
  })

  it('has a key that no other command has', async () => {
    await mount()
    const keys = listCommands()
      .map((command) => shortcutLabel(command.id, 'other'))
      .filter((label): label is string => label !== undefined)
    expect(keys.filter((key) => key === 'Alt+Shift+W')).toHaveLength(1)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
