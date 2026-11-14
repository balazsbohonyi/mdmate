// @vitest-environment jsdom
/**
 * What a change from the settings screen does to `settings.json`. The screen holds no value of its
 * own: a control calls `changeSetting` or `resetSetting`, and the file is the source of truth. So
 * ISC-349 (only the touched key changes; other and unknown keys stay), ISC-350 (the default takes
 * the key out) and ISC-351 (a hand edit shows with no reload) are checked at that boundary here.
 * The mounted screen (rows, search, banner, prompt, locked row) is checked below, in P8-T1d.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type App } from 'vue'
import {
  documentOfTab,
  followerOfTab,
  openPath,
  requestCloseTab,
  resetDocuments,
  resolvePendingClose,
  watchDisk,
} from '@/documents/store'
import { SETTING_ROWS } from '@/features/settings/rows'
import SettingsView from '@/features/settings/SettingsView.vue'
import {
  changeSetting,
  isModified,
  pendingSettingChange,
  resetSetting,
  resetSettingsState,
  settingsFileState,
  watchSettingsFile,
} from '@/features/settings/store'
import {
  BUILT_IN_EXCLUDED_FOLDERS,
  resetSettings,
  settings,
  type LinksOnRename,
} from '@/lib/settings'
import { SETTINGS_CATEGORIES, type SettingsCategory } from '@/lib/settingsCategories'
import { SETTING_KEYS } from '@/lib/settingsFile'
import { setHost } from '@/platform'
import { createMockHost, MOCK_SETTINGS_FILE, type MockHost } from '@/platform/mock'
import { openSettingsTab, resetWorkbench, setSettingsCategory } from '@/workbench/store'
import { tooltipApp } from '../helpers/tooltips'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let host: MockHost
let stop: (() => void) | undefined

/** The file as an object, so a test compares keys and not spacing. */
function fileObject(): unknown {
  const text = host.files.read(MOCK_SETTINGS_FILE)
  return text === undefined ? undefined : JSON.parse(text)
}

async function start(file?: string, linksOnRename?: LinksOnRename): Promise<void> {
  host = createMockHost({
    ...(file === undefined ? {} : { files: { [MOCK_SETTINGS_FILE]: file } }),
    ...(linksOnRename === undefined ? {} : { linksOnRename }),
  })
  setHost(host)
  const { loadSettings } = await import('@/features/settings/store')
  await loadSettings()
}

beforeEach(() => {
  resetSettings()
  resetSettingsState()
})

afterEach(() => {
  stop?.()
  stop = undefined
  screen?.app.unmount()
  screen?.root.remove()
  screen = undefined
  resetDocuments()
  resetWorkbench()
  setHost(undefined)
})

const HAND_WRITTEN = JSON.stringify(
  {
    theme: 'light',
    fonts: { body: 'Georgia', size: 17, futureKey: [1, 2] },
    unknownGroup: { deep: { deeper: true } },
    note: 'written by hand',
  },
  null,
  2,
)

describe('ISC-349: a change writes only its key', () => {
  it('keeps the other keys, the unknown group and the unknown key inside a known group', async () => {
    await start(HAND_WRITTEN)
    expect(await changeSetting('editor.wordWrap', false)).toBe(true)
    expect(fileObject()).toEqual({
      theme: 'light',
      fonts: { body: 'Georgia', size: 17, futureKey: [1, 2] },
      unknownGroup: { deep: { deeper: true } },
      note: 'written by hand',
      editor: { wordWrap: false },
    })
    expect(await changeSetting('fonts.size', 22)).toBe(true)
    expect(fileObject()).toMatchObject({ fonts: { body: 'Georgia', size: 22, futureKey: [1, 2] } })
    expect(settings.fonts.size).toBe(22)
  })

  it('writes a first change into a missing file as the only key, two-space indented', async () => {
    await start()
    expect(host.files.has(MOCK_SETTINGS_FILE)).toBe(false)
    await changeSetting('fonts.codeSize', 16)
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(
      '{\n  "fonts": {\n    "codeSize": 16\n  }\n}\n',
    )
  })

  it('writes a list value as it is', async () => {
    await start()
    await changeSetting('fonts.headingScale', [2, 1.5, 1.25, 1.1, 1, 0.9])
    expect(fileObject()).toEqual({ fonts: { headingScale: [2, 1.5, 1.25, 1.1, 1, 0.9] } })
  })

  it('reads the file fresh for each change, so a hand edit made a moment ago is not lost', async () => {
    await start('{"fonts": {"size": 17}}')
    host.files.write(MOCK_SETTINGS_FILE, '{"fonts": {"size": 17}, "added": "by hand"}')
    await changeSetting('devtools', true)
    expect(fileObject()).toEqual({ fonts: { size: 17 }, added: 'by hand', devtools: true })
  })

  it('runs changes asked for together one after another, each on the file the last one wrote', async () => {
    await start()
    await Promise.all([
      changeSetting('fonts.size', 18),
      changeSetting('fonts.codeSize', 13),
      changeSetting('editor.wordWrap', false),
      changeSetting('devtools', true),
    ])
    expect(fileObject()).toEqual({
      fonts: { size: 18, codeSize: 13 },
      editor: { wordWrap: false },
      devtools: true,
    })
  })
})

describe('ISC-350: the default takes the key out', () => {
  it('removes the key, and its group when that empties it, but nothing else', async () => {
    await start(HAND_WRITTEN)
    await changeSetting('fonts.size', 20)
    expect(isModified('fonts.size')).toBe(true)
    await changeSetting('fonts.size', 15)
    expect(fileObject()).toEqual({
      theme: 'light',
      fonts: { body: 'Georgia', futureKey: [1, 2] },
      unknownGroup: { deep: { deeper: true } },
      note: 'written by hand',
    })
    expect(isModified('fonts.size')).toBe(false)
    expect(settings.fonts.size).toBe(15)
  })

  it('leaves an empty object when every setting is back to its default, and keeps unknown keys', async () => {
    await start('{"devtools": true, "keep": 1}')
    await changeSetting('devtools', false)
    expect(fileObject()).toEqual({ keep: 1 })
    await start('{"editor": {"wordWrap": false}}')
    await changeSetting('editor.wordWrap', true)
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe('{}\n')
  })

  it('takes a list back to the built-in list by its contents, in any order', async () => {
    await start('{"workspace": {"excludedFolders": ["a"]}}')
    await changeSetting('workspace.excludedFolders', [...BUILT_IN_EXCLUDED_FOLDERS].reverse())
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe('{}\n')
  })

  it('does not write a file when a default is set on a file that is not there', async () => {
    await start()
    await changeSetting('fonts.size', 15)
    expect(host.files.has(MOCK_SETTINGS_FILE)).toBe(false)
  })

  it('resetSetting is a change to the default', async () => {
    await start('{"fonts": {"size": 25, "body": "Georgia"}}')
    expect(isModified('fonts.size')).toBe(true)
    await resetSetting('fonts.size')
    expect(fileObject()).toEqual({ fonts: { body: 'Georgia' } })
    expect(settings.fonts.size).toBe(15)
  })
})

describe('ISC-351: a hand edit shows with no reload', () => {
  it('updates the live value, the modified state and the problem marks when the file is saved', async () => {
    await start()
    stop = await watchSettingsFile()
    host.files.write(MOCK_SETTINGS_FILE, '{"fonts": {"size": 26}}')
    await settle()
    expect(settings.fonts.size).toBe(26)
    expect(isModified('fonts.size')).toBe(true)
    host.files.write(MOCK_SETTINGS_FILE, '{"fonts": {"size": "huge"}}')
    await settle()
    expect(settings.fonts.size).toBe(26)
    expect(settingsFileState.problems['fonts.size']).toBeDefined()
    host.files.write(MOCK_SETTINGS_FILE, '{}')
    await settle()
    expect(isModified('fonts.size')).toBe(false)
    expect(settingsFileState.problems).toEqual({})
  })

  it("the page's own write is not read back as someone else's, and a quick second change is not undone", async () => {
    await start()
    stop = await watchSettingsFile()
    const first = changeSetting('fonts.size', 18)
    const second = changeSetting('fonts.size', 19)
    await Promise.all([first, second])
    await settle()
    await settle()
    expect(settings.fonts.size).toBe(19)
    expect(fileObject()).toEqual({ fonts: { size: 19 } })
  })
})

// ---- The mounted screen (P8-T1d) --------------------------------------------------------------

let screen: { app: App; root: HTMLElement } | undefined
/** The id of the Settings tab the mounted screen belongs to. */
let tabId = ''

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

/** Shows the screen on a group, as the Settings tab would, with the file loaded and watched. */
async function mountScreen(
  category: SettingsCategory = 'appearance',
  file?: string,
  linksOnRename?: LinksOnRename,
): Promise<HTMLElement> {
  await start(file, linksOnRename)
  stop = await watchSettingsFile()
  const tab = openSettingsTab(category)
  tabId = tab
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(SettingsView, { tabId: tab })
  app.mount(root)
  screen = { app, root }
  await flush()
  return root
}

const rowOf = (key: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-setting-row="${key}"]`)
  if (element === null) throw new Error(`no row ${key}`)
  return element
}
const rowKeys = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-setting-row]')].map(
    (row) => row.dataset.settingRow ?? '',
  )
const inputOf = (key: string): HTMLInputElement => {
  const input = rowOf(key).querySelector('input')
  if (input === null) throw new Error(`no input in ${key}`)
  return input
}
const errorOf = (key: string): string | null =>
  rowOf(key).querySelector('[data-setting-error]')?.textContent.trim() ?? null
const switchOf = (key: string): HTMLButtonElement => {
  const control = rowOf(key).querySelector<HTMLButtonElement>('[role="switch"]')
  if (control === null) throw new Error(`no switch in ${key}`)
  return control
}

/** Types into a field and leaves it, the way a user accepts a value. */
async function typeAndLeave(input: HTMLInputElement, text: string): Promise<void> {
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flush()
}

async function click(element: Element | null): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to click')
  element.click()
  await flush()
}

const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent.trim() === name || button.getAttribute('aria-label') === name,
  )
describe('ISC-355: every row is the same row', () => {
  it('shows the label, the one-line description and the JSON key of every setting, in its group', async () => {
    await mountScreen()
    for (const { id } of SETTINGS_CATEGORIES) {
      setSettingsCategory(tabId, id)
      await flush()
      const expected = SETTING_ROWS.filter((row) => row.category === id)
      expect(rowKeys()).toEqual(expected.map((row) => row.key))
      for (const spec of expected) {
        const row = rowOf(spec.key)
        expect(row.textContent).toContain(spec.label)
        expect(row.textContent).toContain(spec.description)
        expect(row.querySelector('[data-setting-key]')?.textContent.trim()).toBe(spec.key)
        // A setting at its default carries neither mark.
        expect(row.querySelector('[data-setting-modified]')).toBeNull()
        expect(row.querySelector('[data-setting-reset]')).toBeNull()
        expect(row.querySelector('[data-setting-error]')).toBeNull()
      }
    }
  })

  it('has a row for every key the validator knows, except the fonts that P8-T1e shows', () => {
    const covered = new Set(SETTING_ROWS.map((row) => row.key))
    expect(SETTING_ROWS).toHaveLength(covered.size)
    expect([...SETTING_KEYS].filter((key) => !covered.has(key))).toEqual([
      'fonts.heading',
      'fonts.body',
      'fonts.code',
      'fonts.size',
      'fonts.codeSize',
      'fonts.headingScale',
    ])
  })

  it('puts the dot and the reset icon on a changed row and on no other', async () => {
    await mountScreen('editor')
    await click(switchOf('editor.wordWrap'))
    expect(rowOf('editor.wordWrap').querySelector('[data-setting-modified]')).not.toBeNull()
    expect(rowOf('editor.wordWrap').querySelector('[data-setting-reset]')).not.toBeNull()
    setSettingsCategory(tabId, 'files')
    await flush()
    expect(document.querySelectorAll('[data-setting-modified]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-setting-reset]')).toHaveLength(0)
  })
})

describe('ISC-349, ISC-350, ISC-356: a control on the screen writes one key, and reset takes it out', () => {
  it('writes only the touched key into a file that holds other and unknown keys', async () => {
    await mountScreen('editor', HAND_WRITTEN)
    await click(switchOf('editor.wordWrap'))
    expect(fileObject()).toEqual({
      theme: 'light',
      fonts: { body: 'Georgia', size: 17, futureKey: [1, 2] },
      unknownGroup: { deep: { deeper: true } },
      note: 'written by hand',
      editor: { wordWrap: false },
    })
    expect(settings.editor.wordWrap).toBe(false)
    expect(switchOf('editor.wordWrap').getAttribute('aria-checked')).toBe('false')
  })

  it('removes the key when the row is set back to its default by hand or by its reset icon', async () => {
    await mountScreen('editor', HAND_WRITTEN)
    await click(switchOf('editor.wordWrap'))
    await click(switchOf('editor.wordWrap'))
    expect(fileObject()).not.toHaveProperty('editor')
    await click(switchOf('editor.wordWrap'))
    expect(fileObject()).toHaveProperty('editor.wordWrap', false)
    await click(rowOf('editor.wordWrap').querySelector('[data-setting-reset]'))
    expect(fileObject()).not.toHaveProperty('editor')
    expect(settings.editor.wordWrap).toBe(true)
    expect(isModified('editor.wordWrap')).toBe(false)
    expect(rowOf('editor.wordWrap').querySelector('[data-setting-reset]')).toBeNull()
  })

  it('accepts a number typed into a row, writes it, and shows the mark', async () => {
    await mountScreen('files')
    await typeAndLeave(inputOf('recent.files'), '5')
    expect(fileObject()).toEqual({ recent: { files: 5 } })
    expect(settings.recent.files).toBe(5)
    expect(rowOf('recent.files').querySelector('[data-setting-modified]')).not.toBeNull()
    await click(rowOf('recent.files').querySelector('[data-setting-reset]'))
    expect(fileObject()).toEqual({})
    expect(inputOf('recent.files').value).toBe(String(settings.recent.files))
  })

  it('shows the choice the file holds and follows a change of it made in the store', async () => {
    await mountScreen('files', '{"links": {"onRename": "update"}}')
    expect(rowOf('links.onRename').textContent).toContain('Update the links')
    expect(rowOf('links.onRename').querySelector('[data-setting-modified]')).not.toBeNull()
    await changeSetting('links.onRename', 'ask')
    await flush()
    expect(rowOf('links.onRename').textContent).toContain('Ask each time')
  })
})

describe('ISC-351: a hand edit shows on the open screen', () => {
  it('changes the row, its mark and its value when settings.json is saved, with no reload', async () => {
    await mountScreen('editor')
    expect(switchOf('editor.wordWrap').getAttribute('aria-checked')).toBe('true')
    host.files.write(MOCK_SETTINGS_FILE, '{"editor": {"wordWrap": false}}')
    await flush()
    expect(switchOf('editor.wordWrap').getAttribute('aria-checked')).toBe('false')
    expect(rowOf('editor.wordWrap').querySelector('[data-setting-modified]')).not.toBeNull()
    host.files.write(MOCK_SETTINGS_FILE, '{}')
    await flush()
    expect(switchOf('editor.wordWrap').getAttribute('aria-checked')).toBe('true')
    expect(rowOf('editor.wordWrap').querySelector('[data-setting-modified]')).toBeNull()
  })

  it('shows a typed number the file now holds, and drops what the field held', async () => {
    await mountScreen('files')
    host.files.write(MOCK_SETTINGS_FILE, '{"recent": {"folders": 9}}')
    await flush()
    expect(inputOf('recent.folders').value).toBe('9')
  })
})

describe('ISC-352: a file that is not JSON puts a banner on the screen', () => {
  it('names the line, keeps the values, and clears when the file is fixed', async () => {
    await mountScreen('editor', '{"editor": {"wordWrap": false}}')
    expect(document.querySelector('[data-settings-banner]')).toBeNull()
    host.files.write(MOCK_SETTINGS_FILE, '{\n  "editor": {"wordWrap": true}\n  "devtools": true\n}')
    await flush()
    const banner = document.querySelector('[data-settings-banner]')
    expect(banner?.textContent).toMatch(/line 3/)
    expect(banner?.textContent).toContain('The last good settings stay in use.')
    expect(switchOf('editor.wordWrap').getAttribute('aria-checked')).toBe('false')
    host.files.write(MOCK_SETTINGS_FILE, '{"devtools": true}')
    await flush()
    expect(document.querySelector('[data-settings-banner]')).toBeNull()
  })

  it('has a button in the banner that opens settings.json', async () => {
    await mountScreen('editor', '{ nope')
    const open = [...document.querySelectorAll<HTMLButtonElement>('[data-settings-banner] button')]
    expect(open.map((button) => button.textContent.trim())).toEqual(['Open settings.json'])
    // The command is registered by the shell; with none registered the click does nothing and breaks nothing.
    await click(open[0] ?? null)
  })
})

describe('ISC-353: a value of the wrong type or range is flagged on its row', () => {
  it('flags the row, names why, and keeps the last good value in use', async () => {
    await mountScreen('files', '{"files": {"largeFileMB": 20}}')
    expect(inputOf('files.largeFileMB').value).toBe('20')
    host.files.write(MOCK_SETTINGS_FILE, '{"files": {"largeFileMB": "big"}}')
    await flush()
    expect(settings.files.largeFileMB).toBe(20)
    expect(inputOf('files.largeFileMB').value).toBe('20')
    expect(errorOf('files.largeFileMB')).toContain('Use a number')
    host.files.write(MOCK_SETTINGS_FILE, '{"recent": {"files": 400}}')
    await flush()
    expect(errorOf('files.largeFileMB')).toBeNull()
    expect(errorOf('recent.files')).toContain('0 to 50')
    expect(settings.recent.files).toBe(10)
  })

  it('refuses a typed value on its row before the file is touched', async () => {
    await mountScreen('files', '{"recent": {"files": 3}}')
    const before = host.files.read(MOCK_SETTINGS_FILE)
    await typeAndLeave(inputOf('recent.files'), 'lots')
    expect(errorOf('recent.files')).toBe('Use a number.')
    await typeAndLeave(inputOf('recent.files'), '99')
    expect(errorOf('recent.files')).toContain('0 to 50')
    await typeAndLeave(inputOf('recent.files'), '2.5')
    expect(errorOf('recent.files')).toBe('Use a whole number.')
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(before)
    expect(settings.recent.files).toBe(3)
    await typeAndLeave(inputOf('recent.files'), '4')
    expect(errorOf('recent.files')).toBeNull()
    expect(settings.recent.files).toBe(4)
  })
})

describe('a typed value can be dropped with Escape', () => {
  it('clears the error and shows what the file holds again', async () => {
    await mountScreen('files', '{"recent": {"files": 3}}')
    await typeAndLeave(inputOf('recent.files'), 'lots')
    expect(errorOf('recent.files')).toBe('Use a number.')
    inputOf('recent.files').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await flush()
    expect(errorOf('recent.files')).toBeNull()
    expect(inputOf('recent.files').value).toBe('3')
  })
})

describe('ISC-368: an absolute or escaping image folder is refused on its row', () => {
  it('keeps the last good folder for the next paste', async () => {
    await mountScreen('files', '{"images": {"pasteFolder": "pics"}}')
    const before = host.files.read(MOCK_SETTINGS_FILE)
    for (const bad of ['C:/x', '../x', '/abs']) {
      await typeAndLeave(inputOf('images.pasteFolder'), bad)
      expect(errorOf('images.pasteFolder')).not.toBeNull()
      expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(before)
      expect(settings.images.pasteFolder).toBe('pics')
    }
    await typeAndLeave(inputOf('images.pasteFolder'), 'media/pics')
    expect(errorOf('images.pasteFolder')).toBeNull()
    expect(settings.images.pasteFolder).toBe('media/pics')
  })

  it('flags the same value when it comes from the file by hand', async () => {
    await mountScreen('files', '{"images": {"pasteFolder": "pics"}}')
    host.files.write(MOCK_SETTINGS_FILE, '{"images": {"pasteFolder": "C:/x"}}')
    await flush()
    expect(errorOf('images.pasteFolder')).not.toBeNull()
    expect(settings.images.pasteFolder).toBe('pics')
  })
})

describe('ISC-354: unsaved edits in the settings.json tab are asked about first', () => {
  async function dirtyTab(): Promise<{ id: string; text: string }> {
    const tab = await openPath(MOCK_SETTINGS_FILE)
    const follower = followerOfTab(tab)
    if (follower === undefined) throw new Error('no editor for settings.json')
    follower.dispatch({
      changes: { from: 0, to: follower.state.doc.length, insert: '{"note": "mine"}\n' },
    })
    const doc = documentOfTab(tab)
    expect(doc?.dirty).toBe(true)
    return {
      id: tab,
      get text() {
        return doc?.master.doc.toString() ?? ''
      },
    }
  }
  const prompt = (): Element | null => document.querySelector('[data-settings-confirm]')

  beforeEach(async () => {
    // As in the app, an open file that changes on disk is brought up to date.
    await watchDisk()
  })

  it('asks, and writes nothing until it is answered', async () => {
    await mountScreen('editor', '{}')
    await dirtyTab()
    const before = host.files.read(MOCK_SETTINGS_FILE)
    await click(switchOf('editor.wordWrap'))
    expect(prompt()?.textContent).toContain('Word wrap')
    expect(pendingSettingChange.value?.key).toBe('editor.wordWrap')
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(before)
    expect(settings.editor.wordWrap).toBe(true)
  })

  it('Cancel drops the change and keeps both the file and the tab as they were', async () => {
    await mountScreen('editor', '{}')
    const tab = await dirtyTab()
    const typed = tab.text
    const before = host.files.read(MOCK_SETTINGS_FILE)
    await click(switchOf('editor.wordWrap'))
    await click(buttonNamed('Cancel') ?? null)
    expect(prompt()).toBeNull()
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(before)
    expect(tab.text).toBe(typed)
    expect(settings.editor.wordWrap).toBe(true)
  })

  it("Don't save reloads the tab from the file and makes the change on the file", async () => {
    await mountScreen('editor', '{}')
    const tab = await dirtyTab()
    await click(switchOf('editor.wordWrap'))
    await click(buttonNamed("Don't save") ?? null)
    expect(prompt()).toBeNull()
    expect(fileObject()).toEqual({ editor: { wordWrap: false } })
    expect(settings.editor.wordWrap).toBe(false)
    // The tab holds the file, not what was typed.
    expect(tab.text).not.toContain('mine')
  })

  it('Save writes the tab first, then makes the change on top of it', async () => {
    await mountScreen('editor', '{}')
    const tab = await dirtyTab()
    await click(switchOf('editor.wordWrap'))
    await click(buttonNamed('Save') ?? null)
    expect(prompt()).toBeNull()
    expect(fileObject()).toEqual({ note: 'mine', editor: { wordWrap: false } })
    expect(settings.editor.wordWrap).toBe(false)
    // The tab now shows the file with both, and holds nothing unsaved.
    await vi.waitFor(() => {
      expect(tab.text).toContain('mine')
      expect(tab.text).toContain('wordWrap')
    })
  })

  it('keeps the question open when the save fails', async () => {
    await mountScreen('editor', '{}')
    await dirtyTab()
    host.saveFile = () => Promise.reject(new Error('disk full'))
    await click(switchOf('editor.wordWrap'))
    await click(buttonNamed('Save') ?? null)
    expect(prompt()).not.toBeNull()
    expect(prompt()?.textContent).toContain('Could not save')
    expect(settings.editor.wordWrap).toBe(true)
  })

  it('shows a change in an open tab with no unsaved edits at once', async () => {
    await mountScreen('editor', '{}')
    const tab = await openPath(MOCK_SETTINGS_FILE)
    const doc = documentOfTab(tab)
    await click(switchOf('editor.wordWrap'))
    expect(prompt()).toBeNull()
    expect(doc?.master.doc.toString()).toContain('"wordWrap": false')
    expect(doc?.dirty).toBe(false)
  })

  it('still makes the change when the open tab cannot be refreshed afterwards', async () => {
    await mountScreen('editor', '{}')
    await openPath(MOCK_SETTINGS_FILE)
    host.settingsFile = () => Promise.reject(new Error('no app data folder'))
    expect(await changeSetting('editor.wordWrap', false)).toBe(true)
    expect(fileObject()).toEqual({ editor: { wordWrap: false } })
    expect(settings.editor.wordWrap).toBe(false)
  })

  it('makes the change when the tab was closed while the question was open', async () => {
    await mountScreen('editor', '{}')
    const tab = await dirtyTab()
    await click(switchOf('editor.wordWrap'))
    expect(prompt()).not.toBeNull()
    requestCloseTab(tab.id)
    await resolvePendingClose('discard')
    expect(documentOfTab(tab.id)).toBeUndefined()
    await click(buttonNamed('Save') ?? null)
    expect(prompt()).toBeNull()
    expect(fileObject()).toEqual({ editor: { wordWrap: false } })
  })

  it('asks nothing when the tab holds no unsaved edits, or the file is not open', async () => {
    await mountScreen('editor', '{}')
    await click(switchOf('editor.wordWrap'))
    expect(prompt()).toBeNull()
    expect(fileObject()).toEqual({ editor: { wordWrap: false } })
    await openPath(MOCK_SETTINGS_FILE)
    await click(switchOf('editor.wordWrap'))
    expect(prompt()).toBeNull()
    expect(fileObject()).toEqual({})
  })
})

describe('ISC-357: the search box filters the rows of every group', () => {
  const search = (): HTMLInputElement => {
    const input = document.querySelector<HTMLInputElement>('[data-settings-search]')
    if (input === null) throw new Error('no search box')
    return input
  }
  async function find(text: string): Promise<void> {
    search().value = text
    search().dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
  }

  it('matches a label, a description and a key, from any group', async () => {
    await mountScreen('appearance')
    await find('wrap')
    expect(rowKeys()).toEqual(['editor.wordWrap'])
    await find('pasteFolder')
    expect(rowKeys()).toEqual(['images.pasteFolder'])
    await find('PICTURES')
    expect(rowKeys()).toEqual(['images.pasteFolder'])
    await find('excluded')
    expect(rowKeys()).toEqual(['workspace.excludedFolders'])
    await find('recent')
    expect(rowKeys()).toEqual(['recent.files', 'recent.folders'])
  })

  it('needs every word to match, and says so when nothing does', async () => {
    await mountScreen('editor')
    await find('recent folders')
    expect(rowKeys()).toEqual(['recent.folders'])
    await find('recent wrap')
    expect(rowKeys()).toEqual([])
    expect(document.querySelector('[data-settings-empty]')?.textContent).toContain('No setting')
  })

  it('shows the open group again when the box is emptied, and a group click clears it', async () => {
    await mountScreen('editor')
    await find('recent')
    expect(document.querySelector('[data-settings-heading]')?.textContent.trim()).toBe(
      'Search results',
    )
    expect(document.querySelector('[aria-current="page"]')).toBeNull()
    await find('')
    expect(rowKeys()).toEqual(['editor.wordWrap'])
    await find('recent')
    await click(document.querySelector('[data-settings-category="advanced"]'))
    expect(search().value).toBe('')
    expect(rowKeys()).toEqual(['devtools'])
  })

  it('does not search the settings.json button row, which is not a setting', async () => {
    await mountScreen('advanced')
    expect(document.querySelectorAll('[data-setting-action]')).toHaveLength(1)
    await find('settings')
    expect(document.querySelectorAll('[data-setting-action]')).toHaveLength(0)
  })
})

describe('ISC-367: the excluded folders are chips with an add field and a reset', () => {
  const chips = (): string[] =>
    [...document.querySelectorAll('[data-excluded-chip]')].map((chip) => chip.textContent.trim())

  it('starts on the built-in list, which is 21 names', async () => {
    await mountScreen('files')
    expect(BUILT_IN_EXCLUDED_FOLDERS).toHaveLength(21)
    expect(chips()).toEqual([...BUILT_IN_EXCLUDED_FOLDERS])
    expect(document.querySelector('[data-excluded-reset]')).toBeNull()
  })

  it('adds a name, removes a name, and Reset to built-in list takes the key out', async () => {
    await mountScreen('files')
    await typeAndLeave(inputOf('workspace.excludedFolders'), 'vendor')
    await click(buttonNamed('Add') ?? null)
    expect(chips()).toContain('vendor')
    expect(fileObject()).toMatchObject({
      workspace: { excludedFolders: expect.arrayContaining(['vendor']) as unknown },
    })
    await click(buttonNamed('Remove node_modules') ?? null)
    expect(chips()).not.toContain('node_modules')
    expect(settings.workspace.excludedFolders).not.toContain('node_modules')
    expect(
      rowOf('workspace.excludedFolders').querySelector('[data-setting-modified]'),
    ).not.toBeNull()
    await click(document.querySelector('[data-excluded-reset]'))
    expect(fileObject()).toEqual({})
    expect(chips()).toEqual([...BUILT_IN_EXCLUDED_FOLDERS])
    expect(settings.workspace.excludedFolders).toEqual([...BUILT_IN_EXCLUDED_FOLDERS])
  })

  it('refuses a path and a name already in the list, with the reason on the row', async () => {
    await mountScreen('files')
    const before = host.files.read(MOCK_SETTINGS_FILE)
    for (const bad of ['a/b', 'a\\b', 'NODE_MODULES']) {
      await typeAndLeave(inputOf('workspace.excludedFolders'), bad)
      await click(buttonNamed('Add') ?? null)
      expect(errorOf('workspace.excludedFolders')).not.toBeNull()
    }
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(before)
    expect(chips()).toEqual([...BUILT_IN_EXCLUDED_FOLDERS])
  })
})

describe('ISC-369: an environment override makes the Links row read-only', () => {
  it('disables the control, names the variable, and shows the value in force', async () => {
    await mountScreen('files', '{"links": {"onRename": "ask"}}', 'update')
    const row = rowOf('links.onRename')
    expect(row.querySelector('[data-setting-locked]')?.textContent).toContain(
      'MDMATE_LINKS_ON_RENAME',
    )
    expect(row.textContent).toContain('Update the links')
    const trigger = row.querySelector<HTMLElement>('[role="combobox"]')
    expect(
      trigger?.hasAttribute('disabled') === true || trigger?.hasAttribute('data-disabled'),
    ).toBe(true)
  })

  it('shows a plain row, with no note, when no variable is set', async () => {
    await mountScreen('files')
    const row = rowOf('links.onRename')
    expect(row.querySelector('[data-setting-locked]')).toBeNull()
    expect(row.querySelector('[role="combobox"]')?.hasAttribute('disabled')).toBe(false)
  })

  it('has no reset icon on the locked row even when the file holds a value', async () => {
    await mountScreen('files', '{"links": {"onRename": "ask"}}', 'update')
    expect(isModified('links.onRename')).toBe(true)
    expect(rowOf('links.onRename').querySelector('[data-setting-reset]')).toBeNull()
  })
})

describe('the Advanced and Keyboard groups', () => {
  it('lists the developer tools switch and a button that opens settings.json', async () => {
    await mountScreen('advanced')
    expect(rowKeys()).toEqual(['devtools'])
    await click(switchOf('devtools'))
    expect(fileObject()).toEqual({ devtools: true })
    expect(document.querySelector('[data-open-settings-file]')?.textContent.trim()).toBe(
      'Open settings.json',
    )
  })

  it('says a group with no settings has none', async () => {
    await mountScreen('keyboard')
    expect(rowKeys()).toEqual([])
    expect(document.querySelector('[data-settings-empty]')?.textContent).toContain(
      'no settings yet',
    )
  })
})
