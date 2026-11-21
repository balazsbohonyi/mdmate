// @vitest-environment jsdom
/**
 * Toggle Word Wrap and Toggle Developer Tools (P8-T1f: ISC-370, ISC-394, and the command half of
 * ISC-249). A toggle command shows whether the setting is on, in the menu and in the palette's
 * rows, and flips it through the same change path as the Settings screen, so unsaved edits in the
 * settings.json tab are asked about first and a change is never lost.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  documentOfTab,
  followerOfTab,
  openPath,
  resetDocuments,
  watchDisk,
} from '@/documents/store'
import { commandRows } from '@/features/palette/rows'
import {
  pendingSettingChange,
  resetSettingsState,
  resolvePendingSettingChange,
} from '@/features/settings/store'
import { isToggleOn } from '@/features/settings/quick'
import { resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, MOCK_SETTINGS_FILE, type MockHost } from '@/platform/mock'
import { buildMenuEntries, findMenuItem } from '@/shell/menuEntries'
import {
  clearCommands,
  commandState,
  getCommand,
  isCommandEnabled,
  runCommand,
} from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetWorkbench, settingsTabId } from '@/workbench/store'
import { activeTabId } from '@/workbench/tabMenu'
import { parseJsonc } from '../helpers/jsonc'

let host: MockHost
let removeCommands: (() => void) | undefined

async function start(file?: string): Promise<void> {
  host = createMockHost(file === undefined ? {} : { files: { [MOCK_SETTINGS_FILE]: file } })
  setHost(host)
  const { loadSettings } = await import('@/features/settings/store')
  await loadSettings()
  removeCommands = registerDefaultCommands()
}

const fileObject = (): unknown => {
  const text = host.files.read(MOCK_SETTINGS_FILE)
  return text === undefined ? undefined : parseJsonc(text)
}
const menuState = (id: string): boolean | undefined =>
  findMenuItem(buildMenuEntries('other'), id)?.state
const paletteState = (id: string): boolean | null | undefined =>
  commandRows('').find((row) => row.key === id)?.state

beforeEach(() => {
  resetSettings()
  resetSettingsState()
})

afterEach(() => {
  removeCommands?.()
  removeCommands = undefined
  clearCommands()
  resetDocuments()
  resetWorkbench()
  setHost(undefined)
})

describe('ISC-370: a toggle shows its state in the palette and the menu', () => {
  it('shows word wrap On at the default and Off once it is turned off, everywhere at once', async () => {
    await start()
    expect(commandState(COMMAND_IDS.toggleWordWrap)).toBe(true)
    expect(menuState(COMMAND_IDS.toggleWordWrap)).toBe(true)
    expect(paletteState(COMMAND_IDS.toggleWordWrap)).toBe(true)

    expect(await runCommand(COMMAND_IDS.toggleWordWrap)).toBe(true)
    expect(settings.editor.wordWrap).toBe(false)
    expect(fileObject()).toEqual({ editor: { wordWrap: false } })
    expect(commandState(COMMAND_IDS.toggleWordWrap)).toBe(false)
    expect(menuState(COMMAND_IDS.toggleWordWrap)).toBe(false)
    expect(paletteState(COMMAND_IDS.toggleWordWrap)).toBe(false)
  })

  it('turns it back on and takes the key out of the file, as the screen does', async () => {
    await start('{"editor": {"wordWrap": false}}')
    expect(menuState(COMMAND_IDS.toggleWordWrap)).toBe(false)
    await runCommand(COMMAND_IDS.toggleWordWrap)
    expect(settings.editor.wordWrap).toBe(true)
    expect(fileObject()).toEqual({})
    expect(menuState(COMMAND_IDS.toggleWordWrap)).toBe(true)
  })

  it('toggles line numbers from the palette, Off by default, with no shortcut (ISC-612)', async () => {
    await start()
    expect(paletteState(COMMAND_IDS.toggleLineNumbers)).toBe(false)
    expect(isToggleOn('editor.lineNumbers')).toBe(false)
    expect(await runCommand(COMMAND_IDS.toggleLineNumbers)).toBe(true)
    expect(settings.editor.lineNumbers).toBe(true)
    expect(fileObject()).toEqual({ editor: { lineNumbers: true } })
    expect(paletteState(COMMAND_IDS.toggleLineNumbers)).toBe(true)
    expect(getCommand(COMMAND_IDS.toggleLineNumbers)?.keybinding).toBeUndefined()
    await runCommand(COMMAND_IDS.toggleLineNumbers)
    expect(settings.editor.lineNumbers).toBe(false)
    expect(fileObject()).toEqual({})
  })

  it('shows developer tools Off at the default, On after the toggle, and F12 follows it', async () => {
    await start()
    expect(menuState(COMMAND_IDS.toggleDevtools)).toBe(false)
    expect(paletteState(COMMAND_IDS.toggleDevtools)).toBe(false)
    expect(isCommandEnabled(COMMAND_IDS.openDevtools)).toBe(false)

    await runCommand(COMMAND_IDS.toggleDevtools)
    expect(fileObject()).toEqual({ devtools: true })
    expect(menuState(COMMAND_IDS.toggleDevtools)).toBe(true)
    expect(paletteState(COMMAND_IDS.toggleDevtools)).toBe(true)
    expect(isCommandEnabled(COMMAND_IDS.openDevtools)).toBe(true)

    await runCommand(COMMAND_IDS.toggleDevtools)
    expect(isCommandEnabled(COMMAND_IDS.openDevtools)).toBe(false)
  })

  it('follows a hand edit of the file too, since the state reads the live setting', async () => {
    await start()
    const { applySettingsText } = await import('@/features/settings/store')
    applySettingsText('{"devtools": true}')
    expect(menuState(COMMAND_IDS.toggleDevtools)).toBe(true)
    expect(isToggleOn('devtools')).toBe(true)
  })

  it('gives no state to a command that is not a toggle', async () => {
    await start()
    expect(commandState(COMMAND_IDS.save)).toBeUndefined()
    expect(menuState(COMMAND_IDS.save)).toBeUndefined()
    expect(paletteState(COMMAND_IDS.save)).toBeNull()
    expect(commandState('no.such.command')).toBeUndefined()
  })

  it('puts both toggles, and Switch Theme, in the menu and the palette', async () => {
    await start()
    const ids = [COMMAND_IDS.toggleWordWrap, COMMAND_IDS.toggleDevtools, COMMAND_IDS.switchTheme]
    for (const id of ids) {
      expect(findMenuItem(buildMenuEntries('other'), id), id).toBeDefined()
      expect(
        commandRows('').some((row) => row.key === id),
        id,
      ).toBe(true)
    }
    expect(commandRows('word wrap').map((row) => row.key)).toContain(COMMAND_IDS.toggleWordWrap)
    expect(commandRows('developer').map((row) => row.key)).toContain(COMMAND_IDS.toggleDevtools)
  })
})

describe('ISC-394: a toggle with unsaved settings.json edits asks first', () => {
  async function dirtyTab(): Promise<string> {
    const tab = await openPath(MOCK_SETTINGS_FILE)
    const follower = followerOfTab(tab)
    if (follower === undefined) throw new Error('no editor for settings.json')
    follower.dispatch({
      changes: { from: 0, to: follower.state.doc.length, insert: '{"note": "mine"}\n' },
    })
    expect(documentOfTab(tab)?.dirty).toBe(true)
    return tab
  }

  beforeEach(async () => {
    await watchDisk()
  })

  it('writes nothing, holds the change and shows the Settings screen where the question is', async () => {
    await start('{}\n')
    await dirtyTab()
    const before = host.files.read(MOCK_SETTINGS_FILE)
    expect(settingsTabId()).toBeUndefined()

    await runCommand(COMMAND_IDS.toggleWordWrap)
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(before)
    expect(settings.editor.wordWrap).toBe(true)
    expect(pendingSettingChange.value).toMatchObject({ key: 'editor.wordWrap', value: false })
    // The question lives on the Settings screen, so that tab is the one shown.
    expect(settingsTabId()).toBeDefined()
    expect(activeTabId()).toBe(settingsTabId())
  })

  it('Cancel leaves the setting, the file and the tab as they were', async () => {
    await start('{}\n')
    const tab = await dirtyTab()
    await runCommand(COMMAND_IDS.toggleDevtools)
    await resolvePendingSettingChange('cancel')
    expect(settings.devtools).toBe(false)
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe('{}\n')
    expect(documentOfTab(tab)?.dirty).toBe(true)
    expect(pendingSettingChange.value).toBeNull()
  })

  it('Save writes the tab first and the toggle on top of it', async () => {
    await start('{}\n')
    await dirtyTab()
    await runCommand(COMMAND_IDS.toggleWordWrap)
    await resolvePendingSettingChange('save')
    expect(fileObject()).toEqual({ note: 'mine', editor: { wordWrap: false } })
    expect(settings.editor.wordWrap).toBe(false)
    expect(commandState(COMMAND_IDS.toggleWordWrap)).toBe(false)
  })

  it('writes at once when the tab has no unsaved edits, and shows no screen', async () => {
    await start('{}\n')
    await openPath(MOCK_SETTINGS_FILE)
    await runCommand(COMMAND_IDS.toggleWordWrap)
    expect(fileObject()).toEqual({ editor: { wordWrap: false } })
    expect(pendingSettingChange.value).toBeNull()
    expect(settingsTabId()).toBeUndefined()
  })
})

describe('ISC-549: the content width limit has a toggle command', () => {
  const ID = COMMAND_IDS.toggleContentWidth

  it('is a View command with a title and a state that is the setting', async () => {
    await start()
    expect(ID).toBe('view.toggleContentWidth')
    const rows = commandRows('width')
    expect(rows.map((row) => row.key)).toContain(ID)
    expect(rows.find((row) => row.key === ID)?.label).toBe('Toggle Limit Content Width')
    expect(commandState(ID)).toBe(true)
    expect(paletteState(ID)).toBe(true)
    expect(isToggleOn('editor.limitContentWidth')).toBe(true)
  })

  it('is found by the words the setting uses, in the order the setting uses them', async () => {
    await start()
    // The palette matches the words of a search in order, so the title has to say Limit first.
    for (const query of [
      'limit content width',
      'limit content',
      'content width',
      'width',
      'limit',
    ]) {
      expect(
        commandRows(query).map((row) => row.key),
        query,
      ).toContain(ID)
    }
  })

  it('writes the opposite value, as the Settings screen does, and the second run puts it back', async () => {
    await start()
    expect(await runCommand(ID)).toBe(true)
    expect(settings.editor.limitContentWidth).toBe(false)
    expect(fileObject()).toEqual({ editor: { limitContentWidth: false } })
    expect(commandState(ID)).toBe(false)
    expect(paletteState(ID)).toBe(false)

    await runCommand(ID)
    expect(settings.editor.limitContentWidth).toBe(true)
    expect(fileObject()).toEqual({})
    expect(commandState(ID)).toBe(true)
  })

  it('leaves the other toggles alone', async () => {
    await start()
    await runCommand(ID)
    expect(settings.editor.wordWrap).toBe(true)
    expect(settings.devtools).toBe(false)
    expect(fileObject()).toEqual({ editor: { limitContentWidth: false } })
  })

  it('follows a hand edit of the file, since the state reads the live setting', async () => {
    await start('{"editor": {"limitContentWidth": false}}')
    expect(commandState(ID)).toBe(false)
    const { applySettingsText } = await import('@/features/settings/store')
    applySettingsText('{}')
    expect(commandState(ID)).toBe(true)
  })

  it('asks first when settings.json has unsaved edits, like Toggle Word Wrap', async () => {
    await watchDisk()
    await start('{}\n')
    const tab = await openPath(MOCK_SETTINGS_FILE)
    followerOfTab(tab)?.dispatch({
      changes: { from: 0, to: 3, insert: '{"note": "mine"}\n' },
    })
    const before = host.files.read(MOCK_SETTINGS_FILE)
    await runCommand(ID)
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(before)
    expect(settings.editor.limitContentWidth).toBe(true)
    expect(pendingSettingChange.value).toMatchObject({
      key: 'editor.limitContentWidth',
      value: false,
    })
  })
})

describe('ISC-552: the width command also turns word wrap on', () => {
  const ID = COMMAND_IDS.toggleContentWidth

  it('turns word wrap on with the limit, and the word wrap command shows it at once', async () => {
    await start('{"editor": {"wordWrap": false, "limitContentWidth": false}}')
    expect(commandState(COMMAND_IDS.toggleWordWrap)).toBe(false)
    expect(await runCommand(ID)).toBe(true)
    expect(settings.editor.limitContentWidth).toBe(true)
    expect(commandState(ID)).toBe(true)
    expect(commandState(COMMAND_IDS.toggleWordWrap)).toBe(true)
    expect(paletteState(COMMAND_IDS.toggleWordWrap)).toBe(true)
    expect(fileObject()).toEqual({})
  })

  it('turns only the limit off the next time, and leaves word wrap on', async () => {
    await start()
    await runCommand(ID)
    expect(fileObject()).toEqual({ editor: { limitContentWidth: false } })
    expect(commandState(COMMAND_IDS.toggleWordWrap)).toBe(true)
  })

  it('does it after the question about unsaved settings.json edits too', async () => {
    await watchDisk()
    await start('{"editor": {"wordWrap": false, "limitContentWidth": false}}')
    const tab = await openPath(MOCK_SETTINGS_FILE)
    followerOfTab(tab)?.dispatch({ changes: { from: 0, to: 0, insert: '// mine\n' } })
    await runCommand(ID)
    expect(settings.editor.wordWrap).toBe(false)
    await resolvePendingSettingChange('save')
    expect(settings.editor.limitContentWidth).toBe(true)
    expect(settings.editor.wordWrap).toBe(true)
    expect(host.files.read(MOCK_SETTINGS_FILE)).toContain('// mine')
  })
})
