// @vitest-environment jsdom
/**
 * P8-T2: shortcuts that live in `keybindings.json`. The registry resolves the file against the
 * defaults (ISC-149, ISC-376, ISC-403, ISC-404), an open editor honours a rebinding even onto a key
 * of its own (ISC-402), and the Keyboard category lists, records, resolves conflicts, resets and
 * asks about a dirty file tab (ISC-372 to ISC-375, ISC-405, ISC-406, ISC-408 to ISC-411).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Text, type EditorState } from '@codemirror/state'
import { runScopeHandlers } from '@codemirror/view'
import { nextTick, type App } from 'vue'
import {
  documentOfTab,
  followerOfTab,
  openPath,
  resetDocuments,
  watchDisk,
} from '@/documents/store'
import { createFollowerState, createState, createView } from '@/editor/create'
import {
  applyKeybindingsText,
  changeKeybindings,
  keybindingsFileState,
  loadKeybindings,
  resetKeybindingsState,
  watchKeybindingsFile,
} from '@/features/keybindings/store'
import { keybindingsTemplate } from '@/features/keybindings/template'
import { commandRows } from '@/features/palette/rows'
import SettingsView from '@/features/settings/SettingsView.vue'
import { resetSettingsState } from '@/features/settings/store'
import { resetSettings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, MOCK_KEYBINDINGS_FILE, type MockHost } from '@/platform/mock'
import { buildMenuEntries, findMenuItem } from '@/shell/menuEntries'
import {
  clearCommands,
  commandForEvent,
  getCommand,
  keybindingProblems,
  listCommands,
  registerCommand,
  shortcutLabel,
} from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { parseKeybinding } from '@/workbench/keybinding'
import { installKeybindings } from '@/workbench/keyboard'
import { openSettingsTab, resetWorkbench, setSettingsCategory } from '@/workbench/store'
import { toasts } from '../helpers/toasts'
import { tooltipApp } from '../helpers/tooltips'
import { parseJsonc } from '../helpers/jsonc'

const DOC = 'one\ntwo\nthree'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

/** The event init for a shortcut written the way the file writes it (Ctrl stands for Mod here). */
function init(text: string): KeyboardEventInit & { keyCode: number } {
  const binding = parseKeybinding(text)
  const named = binding.key.length > 1
  return {
    key: named ? binding.key : binding.shift ? binding.key.toUpperCase() : binding.key,
    code: /^[0-9]$/.test(binding.key)
      ? `Digit${binding.key}`
      : named
        ? binding.key
        : `Key${binding.key.toUpperCase()}`,
    keyCode: named ? 0 : binding.key.toUpperCase().charCodeAt(0),
    ctrlKey: binding.mod,
    altKey: binding.alt,
    shiftKey: binding.shift,
    bubbles: true,
    cancelable: true,
  }
}

const keydown = (text: string): KeyboardEvent => new KeyboardEvent('keydown', init(text))
const idOf = (text: string): string | undefined => commandForEvent(keydown(text), 'other')?.id
const titleOf = (id: string): string => getCommand(id)?.title ?? id

/** A command of the test's own, so a run can be counted. */
function spyCommand(id: string, keybinding?: string): ReturnType<typeof vi.fn> {
  const run = vi.fn()
  registerCommand({
    id,
    title: `Spy ${id}`,
    group: 'App',
    ...(keybinding === undefined ? {} : { keybinding }),
    run,
  })
  return run
}

let host: MockHost
let removeCommands: (() => void) | undefined
let removeKeys: (() => void) | undefined
let stopWatch: (() => void) | undefined

async function start(file?: string): Promise<void> {
  host = createMockHost(file === undefined ? {} : { files: { [MOCK_KEYBINDINGS_FILE]: file } })
  setHost(host)
  await loadKeybindings()
}

const fileObject = (): unknown => {
  const text = host.files.read(MOCK_KEYBINDINGS_FILE)
  return text === undefined ? undefined : parseJsonc(text)
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

describe('ISC-149: saving keybindings.json changes a shortcut', () => {
  it('moves a shortcut when the file is saved, and moves it back when the key is taken out', async () => {
    await start()
    stopWatch = await watchKeybindingsFile()
    removeKeys = installKeybindings(window, 'other')
    const spy = spyCommand('t.spy')

    host.files.write(MOCK_KEYBINDINGS_FILE, '{"t.spy": "Mod+Shift+U"}\n')
    await flush()
    document.body.dispatchEvent(keydown('Mod+Shift+U'))
    await flush()
    expect(spy).toHaveBeenCalledTimes(1)

    host.files.write(MOCK_KEYBINDINGS_FILE, '{}\n')
    await flush()
    document.body.dispatchEvent(keydown('Mod+Shift+U'))
    await flush()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('frees the old shortcut and takes effect before the window is shown', async () => {
    await start('{"file.new": "Mod+Shift+U"}')
    expect(idOf('Mod+Shift+U')).toBe(COMMAND_IDS.newFile)
    expect(idOf('Mod+N')).toBeUndefined()
    expect(shortcutLabel(COMMAND_IDS.newFile, 'other')).toBe('Ctrl+Shift+U')
  })
})

describe('ISC-376: an invalid entry keeps the default and shows a notice', () => {
  it('sets aside an unknown id, a shortcut that does not parse and a wrong type, and names each', async () => {
    await start('{"no.such": "Mod+K", "file.new": "banana", "file.open": 5, "file.save": "K"}')
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.newFile)
    expect(idOf('Mod+O')).toBe(COMMAND_IDS.open)
    expect(idOf('Mod+S')).toBe(COMMAND_IDS.save)
    expect(idOf('Mod+K')).toBe(COMMAND_IDS.link)
    const text = keybindingProblems()
      .map((problem) => problem.message)
      .join('\n')
    expect(text).toContain('no.such')
    expect(text).toContain('file.new')
    expect(text).toContain('file.open')
    expect(text).toContain('needs Mod or Alt')
    expect(toasts.last).toContain('keybindings.json')
    expect(toasts.last).toContain('and 3 more')
  })

  it('keeps the entries it cannot use in the file when another command is changed', async () => {
    await start('{"no.such": "Mod+K", "file.new": "banana"}')
    expect(await changeKeybindings({ [COMMAND_IDS.open]: 'Mod+Shift+U' })).toBe(true)
    expect(fileObject()).toEqual({
      'no.such': 'Mod+K',
      'file.new': 'banana',
      'file.open': 'Mod+Shift+U',
    })
  })
})

describe('ISC-403: overrides are resolved against the final set', () => {
  it('lets two commands swap shortcuts, in either key order', () => {
    for (const text of [
      '{"file.new": "Mod+O", "file.open": "Mod+N"}',
      '{"file.open": "Mod+N", "file.new": "Mod+O"}',
    ]) {
      applyKeybindingsText(text)
      expect(idOf('Mod+O')).toBe(COMMAND_IDS.newFile)
      expect(idOf('Mod+N')).toBe(COMMAND_IDS.open)
      expect(keybindingProblems()).toEqual([])
    }
  })

  it('sends two overrides on one shortcut back to their defaults, naming both', () => {
    applyKeybindingsText('{"file.new": "Mod+Shift+U", "file.open": "Mod+Shift+U"}')
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.newFile)
    expect(idOf('Mod+O')).toBe(COMMAND_IDS.open)
    expect(idOf('Mod+Shift+U')).toBeUndefined()
    const [problem] = keybindingProblems()
    expect(problem?.message).toContain(titleOf(COMMAND_IDS.newFile))
    expect(problem?.message).toContain(titleOf(COMMAND_IDS.open))
    expect(problem?.message).toContain('Mod+Shift+U')
  })

  it('sends an override onto an untouched default back, and keeps the other command as it was', () => {
    applyKeybindingsText('{"file.new": "Mod+O"}')
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.newFile)
    expect(idOf('Mod+O')).toBe(COMMAND_IDS.open)
    expect(keybindingProblems()[0]?.message).toContain(titleOf(COMMAND_IDS.open))
  })

  it('repeats until nothing collides: a default coming back can collide in turn', () => {
    // File Open and Quick Open both ask for one key, so both go home; New File asked for File Open's
    // default, which is now taken again, so it goes home too.
    applyKeybindingsText(
      '{"file.new": "Mod+O", "file.open": "Mod+Shift+U", "file.quickOpen": "Mod+Shift+U"}',
    )
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.newFile)
    expect(idOf('Mod+O')).toBe(COMMAND_IDS.open)
    expect(idOf('Mod+P')).toBe(COMMAND_IDS.quickOpen)
    expect(idOf('Mod+Shift+U')).toBeUndefined()
  })

  it('never throws for bad user data, however odd', () => {
    expect(() => {
      applyKeybindingsText('{"file.new": ["Mod+N"], "file.open": {"a": 1}, "": "Mod+K", "x": null}')
    }).not.toThrow()
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.newFile)
  })
})

describe('ISC-404: null unbinds a command', () => {
  it('leaves the command with no shortcut and its old key free for another command', () => {
    applyKeybindingsText('{"file.new": null}')
    expect(idOf('Mod+N')).toBeUndefined()
    expect(shortcutLabel(COMMAND_IDS.newFile, 'other')).toBeUndefined()
    applyKeybindingsText('{"file.new": null, "file.open": "Mod+N"}')
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.open)
    expect(keybindingProblems()).toEqual([])
  })
})

describe.each([
  ['a standalone state', (): EditorState => createState(DOC, [], { parser: false })],
  [
    "a tab's state, as the app opens a file (plain source)",
    (): EditorState => createFollowerState({ doc: Text.of(DOC.split('\n')), parser: false }),
  ],
  [
    "a tab's state, as the app opens a Markdown file",
    (): EditorState => createFollowerState({ doc: Text.of(DOC.split('\n')) }),
  ],
])('ISC-402: a rebinding wins inside an open editor: %s', (_name, make) => {
  beforeEach(() => {
    // jsdom has no layout. CodeMirror asks ranges for their rectangles when it measures.
    const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
    Range.prototype.getClientRects = () => empty
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  function editor(): ReturnType<typeof createView> {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = createView(parent, make())
    view.dispatch({ selection: { anchor: 5 } })
    return view
  }
  const press = (view: ReturnType<typeof createView>, text: string): void => {
    // The editor's own key handling, run directly: jsdom has no focus or layout to drive it.
    runScopeHandlers(view, keydown(text), 'editor')
  }

  it("control: with no command on the key, CodeMirror's own Mod+Shift+K deletes the line", async () => {
    removeKeys = installKeybindings(window, 'other')
    await start('{"tools.openKeybindingsFile": null}')
    const view = editor()
    press(view, 'Mod+Shift+K')
    expect(view.state.doc.toString()).toBe('one\nthree')
    view.destroy()
  })

  it('runs the command and leaves the line when a command is bound to that key', async () => {
    removeKeys = installKeybindings(window, 'other')
    const run = spyCommand('t.spy')
    await start('{"t.spy": "Mod+Shift+K", "tools.openKeybindingsFile": null}')
    const view = editor()
    press(view, 'Mod+Shift+K')
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
    expect(view.state.doc.toString()).toBe(DOC)
    view.destroy()
  })
})

// ---- The Keyboard category --------------------------------------------------------------------

let screen: { app: App; root: HTMLElement } | undefined
let tabId = ''

async function mountKeyboard(file?: string): Promise<HTMLElement> {
  await start(file)
  stopWatch = await watchKeybindingsFile()
  removeKeys = installKeybindings(window, 'other')
  const tab = openSettingsTab('keyboard')
  tabId = tab
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(SettingsView, { tabId: tab })
  app.mount(root)
  screen = { app, root }
  await flush()
  return root
}

const rowOf = (id: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-setting-row="${id}"]`)
  if (element === null) throw new Error(`no row ${id}`)
  return element
}
const buttonOf = (id: string): HTMLButtonElement => {
  const button = rowOf(id).querySelector<HTMLButtonElement>('[data-shortcut-button]')
  if (button === null) throw new Error(`no shortcut button in ${id}`)
  return button
}
const conflictOf = (id: string): Element | null =>
  rowOf(id).querySelector('[data-shortcut-conflict]')
const errorOf = (id: string): string | null =>
  rowOf(id).querySelector('[data-setting-error]')?.textContent.trim() ?? null

async function click(element: Element | null): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to click')
  element.click()
  await flush()
}

/** Presses a shortcut on the window, where the recorder listens. */
async function pressOnWindow(text: string): Promise<KeyboardEvent> {
  const event = keydown(text)
  document.body.dispatchEvent(event)
  await flush()
  return event
}

/** Clicks a row's shortcut and presses the new one. */
async function rebind(id: string, text: string): Promise<void> {
  await click(buttonOf(id))
  await pressOnWindow(text)
}

describe('ISC-372: the Keyboard category lists every command with its shortcut', () => {
  it('has one row for each registered command, with its id, title and current shortcut', async () => {
    await mountKeyboard()
    const rows = [...document.querySelectorAll<HTMLElement>('[data-setting-row]')]
    expect(rows.map((row) => row.dataset.settingRow).sort()).toEqual(
      listCommands()
        .map((command) => command.id)
        .sort(),
    )
    for (const command of listCommands()) {
      const row = rowOf(command.id)
      expect(row.textContent).toContain(command.title)
      expect(row.querySelector('[data-setting-key]')?.textContent.trim()).toBe(command.id)
      expect(buttonOf(command.id).textContent.trim()).toBe(
        shortcutLabel(command.id, 'other') ?? 'Not set',
      )
    }
    expect(buttonOf(COMMAND_IDS.newFile).textContent.trim()).toBe('Ctrl+N')
    expect(buttonOf(COMMAND_IDS.revert).textContent.trim()).toBe('Not set')
  })

  it('shows a shortcut written by hand in the file at once', async () => {
    await mountKeyboard()
    host.files.write(MOCK_KEYBINDINGS_FILE, '{"file.new": "Mod+Shift+U"}')
    await flush()
    expect(buttonOf(COMMAND_IDS.newFile).textContent.trim()).toBe('Ctrl+Shift+U')
    expect(rowOf(COMMAND_IDS.newFile).querySelector('[data-setting-modified]')).not.toBeNull()
  })
})

describe('ISC-373: pressing a new combination rebinds at once and writes the file', () => {
  it('writes the entry, works on the new key, frees the old one and marks the row', async () => {
    await mountKeyboard()
    const spy = spyCommand('t.spy')
    await flush()
    await rebind('t.spy', 'Mod+Shift+U')
    expect(fileObject()).toEqual({ 't.spy': 'Mod+Shift+U' })
    expect(idOf('Mod+Shift+U')).toBe('t.spy')
    await pressOnWindow('Mod+Shift+U')
    expect(spy).toHaveBeenCalledTimes(1)

    await rebind(COMMAND_IDS.newFile, 'Mod+Shift+J')
    expect(fileObject()).toEqual({ 't.spy': 'Mod+Shift+U', 'file.new': 'Mod+Shift+J' })
    expect(idOf('Mod+N')).toBeUndefined()
    expect(buttonOf(COMMAND_IDS.newFile).textContent.trim()).toBe('Ctrl+Shift+J')
    expect(rowOf(COMMAND_IDS.newFile).querySelector('[data-setting-modified]')).not.toBeNull()
  })

  it("writes Mod, not the platform's key, so a binding carries across systems", async () => {
    await mountKeyboard()
    await rebind(COMMAND_IDS.newFile, 'Alt+Shift+9')
    expect(fileObject()).toEqual({ 'file.new': 'Alt+Shift+9' })
    await rebind(COMMAND_IDS.open, 'Mod+Shift+ArrowLeft')
    expect(fileObject()).toMatchObject({ 'file.open': 'Mod+Shift+ArrowLeft' })
  })
})

describe('ISC-374: a combination already used names its owner, and Replace takes it', () => {
  it('names Toggle Sidebar for Mod+Shift+B on Bold, and writes nothing until Replace', async () => {
    await mountKeyboard()
    await rebind(COMMAND_IDS.bold, 'Mod+Shift+B')
    expect(conflictOf(COMMAND_IDS.bold)?.textContent).toContain('Toggle Sidebar')
    // ISC-438: the message uses the warning color, and the buttons below it keep their own.
    const message = conflictOf(COMMAND_IDS.bold)?.querySelector('[data-shortcut-conflict-message]')
    expect(message?.classList.contains('text-warning')).toBe(true)
    expect(message?.classList.contains('text-foreground')).toBe(false)
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBeUndefined()
    expect(idOf('Mod+B')).toBe(COMMAND_IDS.bold)

    await click(rowOf(COMMAND_IDS.bold).querySelector('[data-shortcut-replace]'))
    expect(conflictOf(COMMAND_IDS.bold)).toBeNull()
    expect(fileObject()).toEqual({ 'view.toggleSidebar': null, 'format.bold': 'Mod+Shift+B' })
    expect(idOf('Mod+Shift+B')).toBe(COMMAND_IDS.bold)
    expect(idOf('Mod+B')).toBeUndefined()
    expect(buttonOf(COMMAND_IDS.toggleSidebar).textContent.trim()).toBe('Not set')
  })

  it('Cancel leaves both commands and the file alone', async () => {
    await mountKeyboard()
    await rebind(COMMAND_IDS.bold, 'Mod+Shift+B')
    const cancel = [...rowOf(COMMAND_IDS.bold).querySelectorAll('button')].find(
      (button) => button.textContent.trim() === 'Cancel',
    )
    await click(cancel ?? null)
    expect(conflictOf(COMMAND_IDS.bold)).toBeNull()
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBeUndefined()
    expect(idOf('Mod+Shift+B')).toBe(COMMAND_IDS.toggleSidebar)
  })

  it('takes nothing from a command when the same shortcut is recorded on its own row', async () => {
    await mountKeyboard()
    await rebind(COMMAND_IDS.bold, 'Mod+B')
    expect(conflictOf(COMMAND_IDS.bold)).toBeNull()
    expect(idOf('Mod+B')).toBe(COMMAND_IDS.bold)
  })
})

describe('ISC-375: reset removes the override', () => {
  it('puts the default back and takes the key out of the file', async () => {
    await mountKeyboard()
    await rebind(COMMAND_IDS.newFile, 'Mod+Shift+U')
    expect(idOf('Mod+N')).toBeUndefined()
    await click(rowOf(COMMAND_IDS.newFile).querySelector('[data-setting-reset]'))
    expect(fileObject()).toEqual({})
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.newFile)
    expect(idOf('Mod+Shift+U')).toBeUndefined()
    expect(rowOf(COMMAND_IDS.newFile).querySelector('[data-setting-reset]')).toBeNull()
  })

  it('takes the key out when a shortcut is recorded that is the default again', async () => {
    await mountKeyboard()
    await rebind(COMMAND_IDS.newFile, 'Mod+Shift+U')
    await rebind(COMMAND_IDS.newFile, 'Mod+N')
    expect(fileObject()).toEqual({})
  })

  it('brings back a command that was unbound', async () => {
    await mountKeyboard('{"file.new": null}')
    expect(buttonOf(COMMAND_IDS.newFile).textContent.trim()).toBe('Not set')
    await click(rowOf(COMMAND_IDS.newFile).querySelector('[data-setting-reset]'))
    expect(fileObject()).toEqual({})
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.newFile)
  })
})

describe('ISC-406: recording a shortcut', () => {
  it('Escape cancels, writes nothing, and hands the keyboard back to the app', async () => {
    await mountKeyboard()
    const spy = spyCommand('t.spy', 'Mod+Shift+J')
    await click(buttonOf(COMMAND_IDS.newFile))
    expect(buttonOf(COMMAND_IDS.newFile).textContent).toContain('Press a shortcut')
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
    )
    await flush()
    expect(buttonOf(COMMAND_IDS.newFile).textContent.trim()).toBe('Ctrl+N')
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBeUndefined()
    await pressOnWindow('Mod+Shift+J')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('ignores a modifier pressed alone and keeps waiting', async () => {
    await mountKeyboard()
    await click(buttonOf(COMMAND_IDS.newFile))
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Shift',
        code: 'ShiftLeft',
        shiftKey: true,
        bubbles: true,
      }),
    )
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Control',
        code: 'ControlLeft',
        ctrlKey: true,
        bubbles: true,
      }),
    )
    await flush()
    expect(buttonOf(COMMAND_IDS.newFile).textContent).toContain('Press a shortcut')
    expect(errorOf(COMMAND_IDS.newFile)).toBeNull()
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBeUndefined()
  })

  it('refuses a plain letter with the reason on the row, and keeps waiting', async () => {
    await mountKeyboard()
    await click(buttonOf(COMMAND_IDS.newFile))
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true }),
    )
    await flush()
    expect(errorOf(COMMAND_IDS.newFile)).toContain('needs Mod or Alt')
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBeUndefined()
    await pressOnWindow('Mod+Shift+U')
    expect(fileObject()).toEqual({ 'file.new': 'Mod+Shift+U' })
    expect(errorOf(COMMAND_IDS.newFile)).toBeNull()
  })

  it('takes a function key alone', async () => {
    await mountKeyboard()
    await rebind(COMMAND_IDS.newFile, 'F7')
    expect(fileObject()).toEqual({ 'file.new': 'F7' })
  })

  it('Backspace removes the shortcut', async () => {
    await mountKeyboard()
    await click(buttonOf(COMMAND_IDS.newFile))
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true }),
    )
    await flush()
    expect(fileObject()).toEqual({ 'file.new': null })
    expect(buttonOf(COMMAND_IDS.newFile).textContent.trim()).toBe('Not set')
  })

  it('keeps every pressed key from running a command or reaching anything else', async () => {
    await mountKeyboard()
    const spy = spyCommand('t.spy', 'Mod+Shift+J')
    const seen = vi.fn()
    document.addEventListener('keydown', seen)
    await click(buttonOf(COMMAND_IDS.newFile))
    const event = keydown('Mod+Shift+J')
    document.body.dispatchEvent(event)
    await flush()
    document.removeEventListener('keydown', seen)
    // The window's capture listener sees the one aimed at the body first, so it never gets there.
    expect(seen).not.toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('stops recording when the unmounted screen goes away', async () => {
    await mountKeyboard()
    const spy = spyCommand('t.spy', 'Mod+Shift+J')
    await click(buttonOf(COMMAND_IDS.newFile))
    screen?.app.unmount()
    screen?.root.remove()
    screen = undefined
    await pressOnWindow('Mod+Shift+J')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

/** Goes to the Advanced page, presses Reset all shortcuts, and confirms the question. */
async function resetAllShortcuts(): Promise<void> {
  setSettingsCategory(tabId, 'advanced')
  await flush()
  await click(document.querySelector('[data-reset-all-shortcuts]'))
  await click(document.querySelector('[data-reset-confirm]'))
}

describe('ISC-408: Reset all', () => {
  it('gives back the commented template and puts every command on its default shortcut', async () => {
    await mountKeyboard()
    await rebind(COMMAND_IDS.newFile, 'Mod+Shift+U')
    await rebind(COMMAND_IDS.open, 'Mod+Shift+J')
    await rebind(COMMAND_IDS.save, 'F6')
    expect(idOf('Mod+N')).toBeUndefined()
    await resetAllShortcuts()
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBe(keybindingsTemplate().text)
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.newFile)
    expect(idOf('Mod+O')).toBe(COMMAND_IDS.open)
    expect(idOf('Mod+S')).toBe(COMMAND_IDS.save)
    setSettingsCategory(tabId, 'keyboard')
    await flush()
    expect(document.querySelectorAll('[data-setting-modified]')).toHaveLength(0)
  })

  it('is off while the file holds nothing, and clears entries for commands this build lacks', async () => {
    await mountKeyboard('{}')
    setSettingsCategory(tabId, 'advanced')
    await flush()
    expect(document.querySelector<HTMLButtonElement>('[data-reset-all-shortcuts]')?.disabled).toBe(
      true,
    )
    host.files.write(MOCK_KEYBINDINGS_FILE, '{"gone.command": "Mod+K"}')
    await flush()
    expect(document.querySelector<HTMLButtonElement>('[data-reset-all-shortcuts]')?.disabled).toBe(
      false,
    )
    await click(document.querySelector('[data-reset-all-shortcuts]'))
    await click(document.querySelector('[data-reset-confirm]'))
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBe('{}\n')
  })
})

describe('ISC-410: a file that is not one JSON object', () => {
  it('keeps the last good shortcuts and shows a banner naming the line', async () => {
    await mountKeyboard('{"file.new": "Mod+Shift+U"}')
    expect(document.querySelector('[data-keyboard-banner]')).toBeNull()
    host.files.write(MOCK_KEYBINDINGS_FILE, '{\n  "file.new": "Mod+Shift+J",\n  oops\n}')
    await flush()
    expect(idOf('Mod+Shift+U')).toBe(COMMAND_IDS.newFile)
    expect(idOf('Mod+Shift+J')).toBeUndefined()
    const banner = document.querySelector('[data-keyboard-banner]')
    expect(banner?.textContent).toContain('last good shortcuts')
    expect(banner?.textContent).toMatch(/line \d/)
    expect(keybindingsFileState.broken).not.toBeNull()

    host.files.write(MOCK_KEYBINDINGS_FILE, '["file.new"]')
    await flush()
    expect(idOf('Mod+Shift+U')).toBe(COMMAND_IDS.newFile)
    expect(document.querySelector('[data-keyboard-banner]')).not.toBeNull()

    host.files.write(MOCK_KEYBINDINGS_FILE, '{"file.new": "Mod+Shift+J"}')
    await flush()
    expect(document.querySelector('[data-keyboard-banner]')).toBeNull()
    expect(idOf('Mod+Shift+J')).toBe(COMMAND_IDS.newFile)
  })

  it('writes nothing over a file it cannot read, and says why', async () => {
    await mountKeyboard('not json at all')
    const before = host.files.read(MOCK_KEYBINDINGS_FILE)
    await rebind(COMMAND_IDS.newFile, 'Mod+Shift+U')
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBe(before)
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.newFile)
    expect(toasts.messagesOf('error').join(' ')).toContain('keybindings.json is not valid JSON')
  })

  it('lists what it set aside under the shortcuts', async () => {
    await mountKeyboard('{"no.such": "Mod+K"}')
    expect(document.querySelector('[data-keyboard-problems]')?.textContent).toContain('no.such')
  })
})

describe('ISC-411: a rebinding shows everywhere with no reload', () => {
  it('changes the Keyboard row, the palette row and the menu item together', async () => {
    await mountKeyboard()
    const paletteDetail = (): string | undefined =>
      commandRows('').find((row) => row.key === COMMAND_IDS.newFile)?.detail
    const menuShortcut = (): string | undefined =>
      findMenuItem(buildMenuEntries('other'), COMMAND_IDS.newFile)?.shortcut
    expect(buttonOf(COMMAND_IDS.newFile).textContent.trim()).toBe('Ctrl+N')
    expect(paletteDetail()).toBe('Ctrl+N')
    expect(menuShortcut()).toBe('Ctrl+N')

    await rebind(COMMAND_IDS.newFile, 'Mod+Shift+U')
    expect(buttonOf(COMMAND_IDS.newFile).textContent.trim()).toBe('Ctrl+Shift+U')
    expect(paletteDetail()).toBe('Ctrl+Shift+U')
    expect(menuShortcut()).toBe('Ctrl+Shift+U')
  })
})

describe('ISC-405: unsaved edits in the keybindings.json tab are asked about first', () => {
  async function dirtyTab(): Promise<{ readonly text: string }> {
    const tab = await openPath(MOCK_KEYBINDINGS_FILE)
    const follower = followerOfTab(tab)
    if (follower === undefined) throw new Error('no editor for keybindings.json')
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
  const prompt = (): Element | null => document.querySelector('[data-keyboard-confirm]')
  const answerWith = async (name: string): Promise<void> => {
    const button = [...(prompt()?.querySelectorAll('button') ?? [])].find(
      (one) => one.textContent.trim() === name,
    )
    await click(button ?? null)
  }

  beforeEach(async () => {
    await watchDisk()
  })

  it('asks, naming the command, and writes nothing until it is answered', async () => {
    await mountKeyboard('{}')
    await dirtyTab()
    const before = host.files.read(MOCK_KEYBINDINGS_FILE)
    await rebind(COMMAND_IDS.newFile, 'Mod+Shift+U')
    expect(prompt()?.textContent).toContain('New File')
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBe(before)
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.newFile)
  })

  it('Cancel drops the change and keeps the file and the tab as they were', async () => {
    await mountKeyboard('{}')
    const tab = await dirtyTab()
    const before = host.files.read(MOCK_KEYBINDINGS_FILE)
    await rebind(COMMAND_IDS.newFile, 'Mod+Shift+U')
    await answerWith('Cancel')
    expect(prompt()).toBeNull()
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBe(before)
    expect(tab.text).toBe('{"note": "mine"}\n')
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.newFile)
  })

  it('Save writes the tab first, then the change on top of it', async () => {
    await mountKeyboard('{}')
    const tab = await dirtyTab()
    await rebind(COMMAND_IDS.newFile, 'Mod+Shift+U')
    await answerWith('Save')
    expect(prompt()).toBeNull()
    expect(fileObject()).toEqual({ note: 'mine', 'file.new': 'Mod+Shift+U' })
    expect(idOf('Mod+Shift+U')).toBe(COMMAND_IDS.newFile)
    expect(parseJsonc(tab.text)).toEqual({ note: 'mine', 'file.new': 'Mod+Shift+U' })
  })

  it("Don't save drops the tab's edits and makes the change on the file as it was", async () => {
    await mountKeyboard('{}')
    const tab = await dirtyTab()
    await rebind(COMMAND_IDS.newFile, 'Mod+Shift+U')
    await answerWith("Don't save")
    expect(fileObject()).toEqual({ 'file.new': 'Mod+Shift+U' })
    expect(parseJsonc(tab.text)).toEqual({ 'file.new': 'Mod+Shift+U' })
  })

  it('shows a change in an open tab that holds no unsaved edits', async () => {
    await mountKeyboard('{}')
    const tab = await openPath(MOCK_KEYBINDINGS_FILE)
    await rebind(COMMAND_IDS.newFile, 'Mod+Shift+U')
    expect(prompt()).toBeNull()
    expect(parseJsonc(documentOfTab(tab)?.master.doc.toString() ?? '{}')).toEqual({
      'file.new': 'Mod+Shift+U',
    })
  })
})

describe('ISC-409: Open keybindings.json', () => {
  it('has a row in Advanced and a palette command, and either makes the file and opens it', async () => {
    await mountKeyboard()
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBeUndefined()
    // Ctrl+Shift+K is its default shortcut, and pressing it does the same.
    expect(idOf('Mod+Shift+K')).toBe(COMMAND_IDS.openKeybindingsFile)
    expect(shortcutLabel(COMMAND_IDS.openKeybindingsFile, 'other')).toBe('Ctrl+Shift+K')
    await pressOnWindow('Mod+Shift+K')
    // A file that holds nothing becomes the commented template (ISC-424).
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBe(keybindingsTemplate().text)
    expect([...host.openDocuments().values()]).toContain(MOCK_KEYBINDINGS_FILE)
    setCategory('advanced')
    await flush()
    const button = document.querySelector('[data-open-keybindings-file]')
    expect(button).not.toBeNull()
    await click(button)
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toBe(keybindingsTemplate().text)
    const opened = [...host.openDocuments().values()]
    expect(opened).toContain(MOCK_KEYBINDINGS_FILE)

    expect(commandRows('keybindings').map((row) => row.label)).toContain('Open keybindings.json')
  })
})

function setCategory(category: 'advanced'): void {
  setSettingsCategory(tabId, category)
}

describe('ISC-384: keybindings.json is read only from the app data folder', () => {
  it('a file in an opened folder changes no shortcut, and a change writes the data folder file', async () => {
    host = createMockHost({
      files: {
        '/work/keybindings.json': '{"file.new": "Mod+J"}',
        '/work/readme.md': '# hi\n',
      },
      roots: ['/work'],
    })
    setHost(host)
    await loadKeybindings()
    const { restoreWorkspace } = await import('@/features/tree/store')
    await restoreWorkspace([])
    await settle()
    expect(idOf('Mod+N')).toBe(COMMAND_IDS.newFile)
    expect(idOf('Mod+J')).toBeUndefined()
    expect(await changeKeybindings({ [COMMAND_IDS.open]: 'Mod+Shift+U' })).toBe(true)
    expect(host.files.read(MOCK_KEYBINDINGS_FILE)).toContain('Mod+Shift+U')
    expect(host.files.read('/work/keybindings.json')).toBe('{"file.new": "Mod+J"}')
  })
})
