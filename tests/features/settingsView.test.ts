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
import { resetDocumentFonts } from '@/editor/documentFonts'
import { resetFontFamilies } from '@/features/settings/fontList'
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
  DEFAULT_HIGHLIGHT_EXTENSIONS,
  resetSettings,
  settings,
  type LinksOnRename,
} from '@/lib/settings'
import { SETTINGS_CATEGORIES, type SettingsCategory } from '@/lib/settingsCategories'
import { SETTING_KEYS } from '@/lib/settingsFile'
import { setHost } from '@/platform'
import {
  createMockHost,
  MOCK_FONT_FAMILIES,
  MOCK_SETTINGS_FILE,
  type MockHost,
} from '@/platform/mock'
import { openSettingsTab, resetWorkbench, setSettingsCategory } from '@/workbench/store'
import { tooltipApp } from '../helpers/tooltips'
import { parseJsonc } from '../helpers/jsonc'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let host: MockHost
let stop: (() => void) | undefined

/** The file as an object, so a test compares keys and not spacing. */
function fileObject(): unknown {
  const text = host.files.read(MOCK_SETTINGS_FILE)
  return text === undefined ? undefined : parseJsonc(text)
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

  it('writes a first change into a missing file as the only key, in the commented template (ISC-429)', async () => {
    await start()
    expect(host.files.has(MOCK_SETTINGS_FILE)).toBe(false)
    await changeSetting('fonts.codeSize', 16)
    expect(fileObject()).toEqual({ fonts: { codeSize: 16 } })
    const text = host.files.read(MOCK_SETTINGS_FILE) ?? ''
    expect(text).toContain('// mdmate settings.')
    expect(text).toContain('  "fonts": {\n    "codeSize": 16\n  },')
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
describe('ISC-641 to ISC-643: the font pickers on the screen', () => {
  const rootVar = (name: string): string => document.documentElement.style.getPropertyValue(name)
  const optionsOf = (key: string): HTMLElement[] => [
    ...rowOf(key).querySelectorAll<HTMLElement>('[data-font-option]'),
  ]
  const sampleFamily = (key: string): string =>
    rowOf(key).querySelector<HTMLElement>('[data-font-sample]')?.style.fontFamily ?? ''
  const open = async (key: string): Promise<void> => {
    inputOf(key).dispatchEvent(new FocusEvent('focus'))
    await flush()
  }

  beforeEach(() => {
    resetDocumentFonts()
    resetFontFamilies()
  })

  it('reads the families only when a font field first opens, and lists them with Built-in first', async () => {
    await mountScreen('appearance')
    const ask = vi.spyOn(host, 'listFontFamilies')
    expect(ask).not.toHaveBeenCalled()
    expect(rowOf('fonts.body').querySelector('[data-font-list]')).toBeNull()
    await open('fonts.body')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(optionsOf('fonts.body').map((option) => option.textContent.trim())).toEqual([
      'Built-in',
      ...MOCK_FONT_FAMILIES,
    ])
    // A second field uses the answer it already has.
    await open('fonts.code')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(optionsOf('fonts.code')).toHaveLength(MOCK_FONT_FAMILIES.length + 1)
  })

  it('narrows the list of the field typed in, and not the others', async () => {
    await mountScreen('appearance')
    await open('fonts.body')
    await open('fonts.heading')
    const field = inputOf('fonts.heading')
    field.value = 'seg'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(optionsOf('fonts.heading').map((option) => option.textContent.trim())).toEqual([
      'Built-in',
      'Segoe UI',
    ])
    expect(sampleFamily('fonts.heading')).toContain('seg')
  })

  it('picks a family: it is written, reaches the document, and is in the sample', async () => {
    await mountScreen('appearance', '{"note": "mine"}')
    await open('fonts.heading')
    await click(
      optionsOf('fonts.heading').find((option) => option.dataset.fontName === 'Georgia') ?? null,
    )
    expect(fileObject()).toEqual({ note: 'mine', fonts: { heading: 'Georgia' } })
    expect(rootVar('--doc-font-heading')).toBe('"Georgia", monospace')
    expect(inputOf('fonts.heading').value).toBe('Georgia')
    expect(rowOf('fonts.heading').querySelector('[data-font-list]')).toBeNull()
  })

  it('picks Built-in: the key leaves the file and the built-in stack is back', async () => {
    await mountScreen('appearance', '{"fonts": {"code": "Consolas"}}')
    expect(rootVar('--doc-font-code')).toBe('"Consolas", var(--font-mono)')
    await open('fonts.code')
    await click(optionsOf('fonts.code')[0] ?? null)
    expect(fileObject()).toEqual({})
    expect(rootVar('--doc-font-code')).toBe('var(--font-mono)')
    expect(inputOf('fonts.code').value).toBe('')
  })

  it('accepts a family that is not in the list, and a stack, as typed', async () => {
    await mountScreen('appearance')
    await typeAndLeave(inputOf('fonts.body'), 'Not In The List')
    expect(fileObject()).toEqual({ fonts: { body: 'Not In The List' } })
    await typeAndLeave(inputOf('fonts.heading'), 'Inter, sans-serif')
    expect(fileObject()).toEqual({
      fonts: { body: 'Not In The List', heading: 'Inter, sans-serif' },
    })
  })

  it('shows a saved stack and a family that is not installed as saved, and keeps them', async () => {
    const saved = '{"fonts": {"body": "Inter, sans-serif", "heading": "Not Installed Anywhere"}}'
    await mountScreen('appearance', saved)
    expect(inputOf('fonts.body').value).toBe('Inter, sans-serif')
    expect(inputOf('fonts.heading').value).toBe('Not Installed Anywhere')
    const before = host.files.read(MOCK_SETTINGS_FILE)
    for (const key of ['fonts.body', 'fonts.heading']) {
      await open(key)
      inputOf(key).dispatchEvent(new FocusEvent('blur'))
      await flush()
    }
    expect(inputOf('fonts.body').value).toBe('Inter, sans-serif')
    expect(inputOf('fonts.heading').value).toBe('Not Installed Anywhere')
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(before)
    expect(settings.fonts.body).toBe('Inter, sans-serif')
    expect(settings.fonts.heading).toBe('Not Installed Anywhere')
  })

  it('opens the screen again with the same values (closed and opened)', async () => {
    const saved = '{"fonts": {"body": "Inter, sans-serif", "code": "Not Installed Anywhere"}}'
    await mountScreen('appearance', saved)
    screen?.app.unmount()
    screen?.root.remove()
    screen = undefined
    resetFontFamilies()
    const root = document.createElement('div')
    document.body.append(root)
    const reopened = tooltipApp(SettingsView, { tabId })
    reopened.mount(root)
    screen = { app: reopened, root }
    await flush()
    expect(inputOf('fonts.body').value).toBe('Inter, sans-serif')
    expect(inputOf('fonts.code').value).toBe('Not Installed Anywhere')
    expect(fileObject()).toEqual({
      fonts: { body: 'Inter, sans-serif', code: 'Not Installed Anywhere' },
    })
  })
})

describe('ISC-355: every row is the same row', () => {
  it('shows the label, the one-line description and the JSON key of every setting, in its group', async () => {
    await mountScreen()
    for (const { id } of SETTINGS_CATEGORIES) {
      setSettingsCategory(tabId, id)
      await flush()
      // A key drawn inside another row (a line height beside its size) has no row of its own.
      const expected = SETTING_ROWS.filter(
        (row) => row.category === id && row.inEditor !== true && row.drawnIn === undefined,
      )
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

  it('has a row for every key the validator knows, and no key twice', () => {
    const covered = new Set(SETTING_ROWS.map((row) => row.key))
    expect(SETTING_ROWS).toHaveLength(covered.size)
    expect([...SETTING_KEYS].filter((key) => !covered.has(key))).toEqual([])
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

describe('ISC-360 to ISC-363, ISC-393: the font rows', () => {
  const FONT_KEYS = [
    'fonts.body',
    'fonts.heading',
    'fonts.code',
    'fonts.size',
    'fonts.codeSize',
    'fonts.headingScale',
  ]
  const scaleBoxes = (): HTMLInputElement[] => [
    ...rowOf('fonts.headingScale').querySelectorAll<HTMLInputElement>('[data-heading-scale] input'),
  ]
  const sampleOf = (key: string): HTMLElement => {
    const sample = rowOf(key).querySelector<HTMLElement>('[data-font-sample]')
    if (sample === null) throw new Error(`no sample in ${key}`)
    return sample
  }
  const rootVar = (name: string): string => document.documentElement.style.getPropertyValue(name)

  beforeEach(() => {
    resetDocumentFonts()
  })

  it('shows all six on Appearance', async () => {
    await mountScreen('appearance')
    expect(rowKeys()).toEqual(expect.arrayContaining(FONT_KEYS))
  })

  it('ISC-393: draws the sample in the family being typed before it is accepted', async () => {
    await mountScreen('appearance')
    const before = host.files.read(MOCK_SETTINGS_FILE)
    const input = inputOf('fonts.body')
    input.value = 'Georgia'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(sampleOf('fonts.body').style.fontFamily).toContain('Georgia')
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(before)
    expect(settings.fonts.body).toBe('')
  })

  it('ISC-393: a heading sample falls back to the body family, and code to the code font', async () => {
    await mountScreen('appearance', '{"fonts": {"body": "Segoe UI"}}')
    expect(sampleOf('fonts.heading').style.fontFamily).toContain('Segoe UI')
    expect(sampleOf('fonts.code').style.fontFamily).toContain('--font-mono')
  })

  it('ISC-360: accepting a family writes that key only and reaches the document at once', async () => {
    await mountScreen('appearance', '{"note": "mine"}')
    await typeAndLeave(inputOf('fonts.heading'), 'Georgia')
    expect(fileObject()).toEqual({ note: 'mine', fonts: { heading: 'Georgia' } })
    expect(rootVar('--doc-font-heading')).toBe('"Georgia", monospace')
    expect(rootVar('--doc-font-body')).toBe('monospace')
    expect(rootVar('--doc-font-code')).toBe('var(--font-mono)')
  })

  it('ISC-361: emptying a family takes its key out and the built-in stack is back', async () => {
    await mountScreen('appearance', '{"fonts": {"code": "Consolas"}}')
    expect(rootVar('--doc-font-code')).toBe('"Consolas", var(--font-mono)')
    await typeAndLeave(inputOf('fonts.code'), '')
    expect(fileObject()).toEqual({})
    expect(rootVar('--doc-font-code')).toBe('var(--font-mono)')
  })

  it('ISC-362: the text size is checked, written, and sets the body size', async () => {
    await mountScreen('appearance')
    await typeAndLeave(inputOf('fonts.size'), 'big')
    expect(errorOf('fonts.size')).toBe('Use a number.')
    await typeAndLeave(inputOf('fonts.size'), '4')
    expect(errorOf('fonts.size')).toContain('8 to 40')
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBeUndefined()
    await typeAndLeave(inputOf('fonts.size'), '20')
    expect(errorOf('fonts.size')).toBeNull()
    expect(fileObject()).toEqual({ fonts: { size: 20 } })
    expect(rootVar('--doc-size')).toBe('20px')
    // The code stays 14 px: the ratio follows the text size.
    expect(Number(rootVar('--doc-code-ratio')) * 20).toBeCloseTo(14, 10)
  })

  it('ISC-363: the code size sets code only', async () => {
    await mountScreen('appearance')
    await typeAndLeave(inputOf('fonts.codeSize'), '18')
    expect(fileObject()).toEqual({ fonts: { codeSize: 18 } })
    expect(Number(rootVar('--doc-code-ratio')) * 15).toBeCloseTo(18, 10)
    expect(rootVar('--doc-size')).toBe('15px')
  })

  it('ISC-362: six boxes write the heading scale as one value, and reset takes it out', async () => {
    await mountScreen('appearance')
    expect(scaleBoxes().map((box) => box.value)).toEqual([
      '1.7',
      '1.45',
      '1.25',
      '1.1',
      '1',
      '0.95',
    ])
    await typeAndLeave(scaleBoxes()[0]!, '2')
    expect(fileObject()).toEqual({ fonts: { headingScale: [2, 1.45, 1.25, 1.1, 1, 0.95] } })
    expect(rootVar('--doc-heading-1')).toBe('2')
    expect(rootVar('--doc-heading-2')).toBe('1.45')
    await click(rowOf('fonts.headingScale').querySelector('[data-setting-reset]'))
    expect(fileObject()).toEqual({})
    expect(rootVar('--doc-heading-1')).toBe('1.7')
  })

  it('ISC-362: a heading size out of range is refused on the row and the file is untouched', async () => {
    await mountScreen('appearance')
    await typeAndLeave(scaleBoxes()[2]!, '9')
    expect(errorOf('fonts.headingScale')).toBe('Each number must be from 0.5 to 4.')
    await typeAndLeave(scaleBoxes()[2]!, 'x')
    expect(errorOf('fonts.headingScale')).toBe('Each number must be from 0.5 to 4.')
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBeUndefined()
    scaleBoxes()[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    expect(errorOf('fonts.headingScale')).toBeNull()
    expect(scaleBoxes()[2]!.value).toBe('1.25')
  })

  it('shows a hand edit of the heading scale in the six boxes', async () => {
    await mountScreen('appearance')
    host.files.write(MOCK_SETTINGS_FILE, '{"fonts": {"headingScale": [3, 2, 1.5, 1.2, 1, 0.8]}}')
    await flush()
    expect(scaleBoxes().map((box) => box.value)).toEqual(['3', '2', '1.5', '1.2', '1', '0.8'])
  })
})

describe('ISC-628: the sizes and their line heights share a row', () => {
  const PAIRS = [
    { host: 'fonts.size', second: 'fonts.lineHeight', word: 'Text', size: 15 },
    { host: 'fonts.codeSize', second: 'fonts.codeLineHeight', word: 'Code', size: 14 },
  ] as const
  const rootVar = (name: string): string => document.documentElement.style.getPropertyValue(name)

  const fieldOf = (key: string): HTMLInputElement => {
    const field = document.querySelector<HTMLInputElement>(`[data-pair-field="${key}"] input`)
    if (field === null) throw new Error(`no field ${key}`)
    return field
  }
  const resetOf = (key: string): Element | null =>
    document.querySelector(`[data-setting-reset="${key}"]`)
  const pairError = (key: string): string | null =>
    document.querySelector(`[data-setting-error="${key}"]`)?.textContent.trim() ?? null

  beforeEach(() => {
    resetDocumentFonts()
  })

  it.each(PAIRS)('puts $second in the row of $host, as a second short field', async (pair) => {
    await mountScreen('appearance')
    const row = rowOf(pair.host)
    expect(row.querySelectorAll('input')).toHaveLength(2)
    expect(row.querySelector(`[data-pair-field="${pair.host}"] input`)).not.toBeNull()
    expect(row.querySelector(`[data-pair-field="${pair.second}"] input`)).not.toBeNull()
    expect(document.querySelector(`[data-setting-row="${pair.second}"]`)).toBeNull()
    expect(row.textContent.toLowerCase()).toContain('line height')
    expect(row.textContent).toContain(pair.word)
    expect(fieldOf(pair.host).value).toBe(String(pair.size))
    expect(fieldOf(pair.second).value).toBe('1.4')
  })

  it('names each field for a screen reader', async () => {
    await mountScreen('appearance')
    expect(fieldOf('fonts.size').getAttribute('aria-label')).toBe('Text size')
    expect(fieldOf('fonts.lineHeight').getAttribute('aria-label')).toBe('Text line height')
    expect(fieldOf('fonts.codeSize').getAttribute('aria-label')).toBe('Code size')
    expect(fieldOf('fonts.codeLineHeight').getAttribute('aria-label')).toBe('Code line height')
  })

  it.each(PAIRS)(
    'lays the two fields of $host side by side, each at most half the column',
    async (pair) => {
      await mountScreen('appearance')
      const grid = rowOf(pair.host).querySelector<HTMLElement>('[data-setting-pair]')
      if (grid === null) throw new Error('no pair')
      const classes = [...grid.classList]
      expect(classes).toContain('grid')
      expect(classes).toContain('gap-2')
      // Two equal columns that stop at two digits and a little room, and no field wider than a half.
      const columns = classes.find((name) => name.startsWith('grid-cols-')) ?? ''
      const floor = /minmax\((\d+(?:\.\d+)?)rem,1fr\)/.exec(columns)
      expect(columns).toContain('repeat(2,')
      expect(Number(floor?.[1])).toBeGreaterThanOrEqual(3)
      for (const key of [pair.host, pair.second]) {
        expect(fieldOf(key).closest('[data-pair-field]')?.parentElement).toBe(grid)
      }
    },
  )

  it('keeps the heading sizes row as it was: six boxes, one reset', async () => {
    await mountScreen('appearance')
    const row = rowOf('fonts.headingScale')
    expect(row.querySelectorAll('[data-heading-scale] input')).toHaveLength(6)
    expect(row.querySelector('[data-setting-pair]')).toBeNull()
    expect(row.querySelectorAll('[data-pair-field]')).toHaveLength(0)
  })

  it('writes a line height as its own key and applies it at once', async () => {
    await mountScreen('appearance', '{"note": "mine"}')
    await typeAndLeave(fieldOf('fonts.lineHeight'), '1.8')
    expect(fileObject()).toEqual({ note: 'mine', fonts: { lineHeight: 1.8 } })
    expect(settings.fonts.lineHeight).toBe(1.8)
    expect(rootVar('--doc-line-height')).toBe('1.8')
    expect(rootVar('--doc-code-line-height')).toBe('1.4')
    await typeAndLeave(fieldOf('fonts.codeLineHeight'), '1.5')
    expect(fileObject()).toEqual({ note: 'mine', fonts: { lineHeight: 1.8, codeLineHeight: 1.5 } })
    expect(rootVar('--doc-code-line-height')).toBe('1.5')
    expect(fieldOf('fonts.size').value).toBe('15')
  })

  it('writes the size beside it with no change to the line height', async () => {
    await mountScreen('appearance')
    await typeAndLeave(fieldOf('fonts.size'), '18')
    expect(fileObject()).toEqual({ fonts: { size: 18 } })
    expect(rootVar('--doc-size')).toBe('18px')
    expect(rootVar('--doc-line-height')).toBe('1.4')
  })

  it('refuses a line height under its own field, and leaves the size field and the file alone', async () => {
    await mountScreen('appearance')
    await typeAndLeave(fieldOf('fonts.lineHeight'), '3.5')
    expect(pairError('fonts.lineHeight')).toBe('Use a number from 1 to 3 in steps of 0.05.')
    expect(pairError('fonts.size')).toBeNull()
    expect(fieldOf('fonts.lineHeight').getAttribute('aria-invalid')).toBe('true')
    expect(fieldOf('fonts.size').getAttribute('aria-invalid')).toBeNull()
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBeUndefined()
    await typeAndLeave(fieldOf('fonts.lineHeight'), '1.42')
    expect(pairError('fonts.lineHeight')).toBe('Use a number from 1 to 3 in steps of 0.05.')
    await typeAndLeave(fieldOf('fonts.lineHeight'), 'tall')
    expect(pairError('fonts.lineHeight')).toBe('Use a number.')
    fieldOf('fonts.lineHeight').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await flush()
    expect(pairError('fonts.lineHeight')).toBeNull()
    expect(fieldOf('fonts.lineHeight').value).toBe('1.4')
  })

  it('refuses a size under the size field, and not under the line height', async () => {
    await mountScreen('appearance')
    await typeAndLeave(fieldOf('fonts.codeSize'), '4')
    expect(pairError('fonts.codeSize')).toContain('8 to 40')
    expect(pairError('fonts.codeLineHeight')).toBeNull()
  })

  it('gives each field its own reset, shown only while that field differs from its default', async () => {
    await mountScreen('appearance')
    expect(resetOf('fonts.size')).toBeNull()
    expect(resetOf('fonts.lineHeight')).toBeNull()
    await typeAndLeave(fieldOf('fonts.lineHeight'), '2')
    expect(resetOf('fonts.lineHeight')).not.toBeNull()
    expect(resetOf('fonts.size')).toBeNull()
    expect(resetOf('fonts.codeLineHeight')).toBeNull()
    await typeAndLeave(fieldOf('fonts.size'), '17')
    expect(resetOf('fonts.size')).not.toBeNull()
    await click(resetOf('fonts.lineHeight'))
    expect(fileObject()).toEqual({ fonts: { size: 17 } })
    expect(fieldOf('fonts.lineHeight').value).toBe('1.4')
    expect(resetOf('fonts.lineHeight')).toBeNull()
    expect(resetOf('fonts.size')).not.toBeNull()
    expect(rootVar('--doc-line-height')).toBe('1.4')
    await click(resetOf('fonts.size'))
    expect(fileObject()).toEqual({})
  })

  it('marks the row as changed while either of its fields is', async () => {
    await mountScreen('appearance')
    expect(rowOf('fonts.codeSize').querySelector('[data-setting-modified]')).toBeNull()
    await typeAndLeave(fieldOf('fonts.codeLineHeight'), '1.2')
    expect(rowOf('fonts.codeSize').querySelector('[data-setting-modified]')).not.toBeNull()
    expect(rowOf('fonts.size').querySelector('[data-setting-modified]')).toBeNull()
  })

  it('shows a hand edit of either field, and flags a bad one under its own field', async () => {
    await mountScreen('appearance')
    host.files.write(MOCK_SETTINGS_FILE, '{"fonts": {"lineHeight": 1.75, "codeLineHeight": 9}}')
    await flush()
    expect(fieldOf('fonts.lineHeight').value).toBe('1.75')
    expect(pairError('fonts.codeLineHeight')).toBe('Use a number from 1 to 3 in steps of 0.05.')
    expect(pairError('fonts.lineHeight')).toBeNull()
    expect(settings.fonts.codeLineHeight).toBe(1.4)
  })

  it('is found by a search for line height, once for each row', async () => {
    await mountScreen('appearance')
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')
    if (search === null) throw new Error('no search box')
    search.value = 'line height'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(rowKeys()).toEqual(['fonts.size', 'fonts.codeSize'])
    expect(document.querySelectorAll('[data-pair-field]')).toHaveLength(4)
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
    // The label of one row, and the description of the width limit, which needs word wrap.
    expect(rowKeys()).toEqual(['editor.wordWrap', 'editor.limitContentWidth'])
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
    expect(rowKeys()).toEqual([
      'editor.wordWrap',
      'editor.lineNumbers',
      'editor.limitContentWidth',
      'editor.contentMaxWidth',
      'editor.highlightExtensions',
    ])
    await find('recent')
    await click(document.querySelector('[data-settings-category="advanced"]'))
    expect(search().value).toBe('')
    expect(rowKeys()).toEqual(['devtools'])
  })

  it('does not search the settings.json button row, which is not a setting', async () => {
    await mountScreen('advanced')
    // One button row for each file or folder behind the screen: settings.json, keybindings.json
    // and the themes folder.
    expect(document.querySelectorAll('[data-setting-action]')).toHaveLength(3)
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
    expect(chips()).toEqual(
      [...BUILT_IN_EXCLUDED_FOLDERS].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
      ),
    )
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
    expect([...chips()].sort()).toEqual([...BUILT_IN_EXCLUDED_FOLDERS].sort())
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
    expect([...chips()].sort()).toEqual([...BUILT_IN_EXCLUDED_FOLDERS].sort())
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

  it('shows the shortcuts panel, not a list of settings, in the Keyboard group', async () => {
    await mountScreen('keyboard')
    expect(document.querySelector('[data-keyboard-panel]')).not.toBeNull()
    expect(document.querySelector('[data-settings-empty]')).toBeNull()
  })
})

describe('the syntax colors row lists languages as tags, with a language picker and a reset', () => {
  const chips = (): string[] =>
    [...document.querySelectorAll('[data-extension-chip]')].map((chip) => chip.textContent.trim())

  const chipOf = (label: string): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('[data-extension-chip]')].find(
      (chip) => chip.textContent.trim() === label,
    )

  /** The screen, once the language list has loaded and the extensions are shown as their languages. */
  async function mountWithLanguages(): Promise<void> {
    await mountScreen('editor')
    await vi.waitFor(() => {
      expect(chips()).toContain('Rust')
    })
  }

  it('shows the default list as languages, A to Z, and no bare extensions', async () => {
    await mountWithLanguages()
    expect(chips()).toEqual(expect.arrayContaining(['JSON', 'TypeScript', 'Rust', 'Vue', 'SQL']))
    expect(chips().some((label) => label.startsWith('.'))).toBe(false)
    expect(chips()).toEqual(
      [...chips()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    )
    expect(document.querySelector('[data-extension-reset]')).toBeNull()
    expect(document.querySelector('[data-extension-picker]')).not.toBeNull()
  })

  it('shows a language’s extensions in a hover hint', async () => {
    await mountWithLanguages()
    const tag = chipOf('TypeScript')
    if (tag === undefined) throw new Error('no TypeScript tag')
    tag.dispatchEvent(new MouseEvent('pointerenter'))
    tag.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    await flush()
    // The tooltip repeats its text once for screen readers, so the text is found in it.
    expect(document.body.querySelector('[data-hover-hint]')?.textContent).toContain('.ts .mts .cts')
  })

  it('removes a language with all its extensions, marks the row changed, and Reset takes the key out', async () => {
    await mountWithLanguages()
    await click(buttonNamed('Remove TypeScript') ?? null)
    expect(chips()).not.toContain('TypeScript')
    for (const extension of ['ts', 'mts', 'cts']) {
      expect(settings.editor.highlightExtensions).not.toContain(extension)
    }
    expect(settings.editor.highlightExtensions).toContain('tsx')
    expect(
      rowOf('editor.highlightExtensions').querySelector('[data-setting-modified]'),
    ).not.toBeNull()
    expect(fileObject()).toMatchObject({
      editor: { highlightExtensions: expect.any(Array) as unknown },
    })
    await click(document.querySelector('[data-extension-reset]'))
    expect(fileObject()).toEqual({})
    expect(chips()).toContain('TypeScript')
  })

  it('keeps a hand-written extension no language owns as a tag of its own', async () => {
    await mountScreen('editor')
    expect(
      await changeSetting('editor.highlightExtensions', [...DEFAULT_HIGHLIGHT_EXTENSIONS, 'zzz']),
    ).toBe(true)
    await vi.waitFor(() => {
      expect(chips()).toContain('.zzz')
    })
    await click(buttonNamed('Remove .zzz') ?? null)
    expect(settings.editor.highlightExtensions).not.toContain('zzz')
  })
})

describe('the language picker adds the extensions of a language', () => {
  /** The language names in the list, in order. */
  const items = (): string[] =>
    [...document.querySelectorAll('[data-language-name]')].map((node) => node.textContent.trim())

  const optionOf = (name: string): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('[data-language-item]')].find(
      (node) => node.querySelector('[data-language-name]')?.textContent.trim() === name,
    )

  async function typeInSearch(text: string): Promise<void> {
    const search = document.querySelector<HTMLInputElement>('[data-slot="combobox-input"]')
    if (search === null) throw new Error('no search box')
    search.value = text
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
  }

  async function openPicker(): Promise<void> {
    // jsdom has no scrollIntoView, which the list calls when it highlights an item.
    Element.prototype.scrollIntoView = vi.fn()
    await mountScreen('editor')
    await click(document.querySelector('[data-extension-picker]'))
    await vi.waitFor(() => {
      expect(items().length).toBeGreaterThan(10)
    })
  }

  it('is as wide as the chips above it', async () => {
    await mountScreen('editor')
    const picker = document.querySelector('[data-extension-picker]')
    expect(picker?.classList.contains('w-full')).toBe(true)
  })

  it('shows the name, and below it the extensions on one smaller, muted line that ends in an ellipsis', async () => {
    await openPicker()
    const python = optionOf('Python')
    expect(python).toBeDefined()
    const name = python?.querySelector('[data-language-name]')
    const extensions = python?.querySelector<HTMLElement>('[data-language-extensions]')
    expect(name?.textContent.trim()).toBe('Python')
    // Every extension on the one line, in lower case, as they will be added.
    expect(extensions?.textContent.trim()).toBe('.build .bzl .py .pyw')
    expect(extensions?.classList.contains('truncate')).toBe(true)
    expect(extensions?.classList.contains('text-xs')).toBe(true)
    expect(extensions?.className).toContain('text-muted-foreground')
    // The name and the extensions are two lines of one column.
    expect(name?.parentElement).toBe(extensions?.parentElement)
  })

  it('shows every extension of the language in a hover hint', async () => {
    await openPicker()
    const extensions = optionOf('TypeScript')?.querySelector<HTMLElement>(
      '[data-language-extensions]',
    )
    if (extensions === null || extensions === undefined) throw new Error('no extensions line')
    extensions.dispatchEvent(new MouseEvent('pointerenter'))
    extensions.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    await flush()
    // The tooltip repeats its text once for screen readers, so the text is found in it, not equal to it.
    expect(document.body.querySelector('[data-hover-hint]')?.textContent).toContain('.ts .mts .cts')
  })

  it('filters as you type: by part of a name, or by an exact extension, and says when nothing matches', async () => {
    await openPicker()
    const all = items().length
    await typeInSearch('scrip')
    expect(items()).toEqual(expect.arrayContaining(['JavaScript', 'TypeScript']))
    expect(items().length).toBeLessThan(all / 4)
    expect(items()).not.toContain('Python')
    await typeInSearch('pyx')
    expect(items()).toEqual(['Cython'])
    await typeInSearch('zzzzqq')
    expect(items()).toEqual([])
    expect(document.querySelector('[data-language-empty]')).not.toBeNull()
  })

  it('adds the extensions of the language that is chosen', async () => {
    await openPicker()
    await typeInSearch('py')
    const item = optionOf('Python')
    if (item === undefined) throw new Error('Python is not offered for "py"')
    await click(item)
    await vi.waitFor(() => {
      expect(settings.editor.highlightExtensions).toContain('py')
    })
    expect(settings.editor.highlightExtensions).toEqual(
      expect.arrayContaining([...DEFAULT_HIGHLIGHT_EXTENSIONS, 'py']),
    )
    expect(fileObject()).toMatchObject({
      editor: { highlightExtensions: expect.arrayContaining(['py']) as unknown },
    })
  })
})

describe('the search field sits at the top of the sidebar', () => {
  it('is inside the groups list, above the first group, with a search icon in the field', async () => {
    await mountScreen()
    const nav = document.querySelector('nav[aria-label="Settings groups"]')
    const field = document.querySelector('[data-settings-search]')
    const first = document.querySelector('[data-settings-category]')
    if (nav === null || field === null || first === null) throw new Error('screen did not render')
    expect(nav.contains(field)).toBe(true)
    // The field comes before the first group in the document, so it is drawn above it.
    expect(field.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    const icon = field.parentElement?.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    // The panel's heading row no longer holds a field.
    expect(document.querySelector('[data-settings-panel] [data-settings-search]')).toBeNull()
  })
})

describe('ISC-552: turning the content width limit on turns word wrap on', () => {
  const OFF = '{"editor": {"wordWrap": false, "limitContentWidth": false}}'

  it('writes both in one go, and the key for word wrap leaves the file (on is the default)', async () => {
    await start(OFF)
    expect(settings.editor.wordWrap).toBe(false)
    expect(await changeSetting('editor.limitContentWidth', true)).toBe(true)
    expect(settings.editor.limitContentWidth).toBe(true)
    expect(settings.editor.wordWrap).toBe(true)
    expect(fileObject()).toEqual({})
  })

  it('keeps comments and every other key, known or not', async () => {
    const file = [
      '{',
      '  // my notes',
      '  "theme": "light",',
      '  "note": "by hand",',
      '  "editor": { "wordWrap": false, "limitContentWidth": false, "contentMaxWidth": 700 }',
      '}',
      '',
    ].join('\n')
    await start(file)
    await changeSetting('editor.limitContentWidth', true)
    const text = host.files.read(MOCK_SETTINGS_FILE) ?? ''
    expect(text).toContain('// my notes')
    expect(fileObject()).toEqual({
      theme: 'light',
      note: 'by hand',
      editor: { contentMaxWidth: 700 },
    })
  })

  it('writes nothing extra when word wrap is already on', async () => {
    await start('{"editor": {"limitContentWidth": false}}')
    await changeSetting('editor.limitContentWidth', true)
    expect(fileObject()).toEqual({})
    expect(settings.editor.wordWrap).toBe(true)
  })

  it('leaves word wrap alone when the limit is turned off, and when anything else changes', async () => {
    await start('{"editor": {"wordWrap": false}}')
    await changeSetting('editor.limitContentWidth', false)
    expect(fileObject()).toEqual({ editor: { wordWrap: false, limitContentWidth: false } })
    expect(settings.editor.wordWrap).toBe(false)
    await changeSetting('editor.contentMaxWidth', 700)
    expect(settings.editor.wordWrap).toBe(false)
    expect(await changeSetting('editor.wordWrap', true)).toBe(true)
    expect(settings.editor.limitContentWidth).toBe(false)
  })

  it('does the same when the row is reset to its default, which is on', async () => {
    await start(OFF)
    const { requestResetSetting } = await import('@/features/settings/store')
    expect(await requestResetSetting('editor.limitContentWidth')).toBe(true)
    expect(settings.editor.wordWrap).toBe(true)
    expect(fileObject()).toEqual({})
  })

  it('does the same from the switch on the screen, and the word wrap switch follows', async () => {
    await mountScreen('editor', OFF)
    expect(switchOf('editor.wordWrap').getAttribute('aria-checked')).toBe('false')
    expect(switchOf('editor.limitContentWidth').getAttribute('aria-checked')).toBe('false')
    await click(switchOf('editor.limitContentWidth'))
    expect(switchOf('editor.limitContentWidth').getAttribute('aria-checked')).toBe('true')
    expect(switchOf('editor.wordWrap').getAttribute('aria-checked')).toBe('true')
    expect(fileObject()).toEqual({})
  })

  it('does not touch the file for a hand edit that turns the limit on with wrap off', async () => {
    await start('{}')
    const { applySettingsText } = await import('@/features/settings/store')
    applySettingsText('{"editor": {"wordWrap": false}}')
    expect(settings.editor.limitContentWidth).toBe(true)
    expect(settings.editor.wordWrap).toBe(false)
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe('{}')
  })
})
