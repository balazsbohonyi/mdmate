// @vitest-environment jsdom
/**
 * settings.json and keybindings.json as JSON with comments (P8-T2 follow-up: ISC-420 to ISC-429).
 * The open commands write the commented template into a file that holds nothing; the screens change
 * one entry and never a comment; comments and trailing commas read without a banner; and taking the
 * `//` off a line takes effect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { documentOfTab, followerOfTab, openPath, resetDocuments } from '@/documents/store'
import {
  applyKeybindingsText,
  changeKeybindings,
  keybindingsFileState,
  loadKeybindings,
  resetKeybindingsState,
} from '@/features/keybindings/store'
import { keybindingsTemplate } from '@/features/keybindings/template'
import SettingsView from '@/features/settings/SettingsView.vue'
import {
  applySettingsText,
  changeSetting,
  loadSettings,
  resetSettingsState,
  settingsFileState,
} from '@/features/settings/store'
import { settingsTemplate } from '@/features/settings/templates'
import { resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import {
  createMockHost,
  MOCK_KEYBINDINGS_FILE,
  MOCK_SETTINGS_FILE,
  type MockHost,
} from '@/platform/mock'
import { clearCommands, commandForEvent, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { openSettingsTab, resetWorkbench } from '@/workbench/store'
import { parseJsonc } from '../helpers/jsonc'
import { tooltipApp } from '../helpers/tooltips'

let host: MockHost
let removeCommands: (() => void) | undefined
let screen: { app: App; root: HTMLElement } | undefined

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

async function start(files: Record<string, string> = {}): Promise<void> {
  host = createMockHost({ files })
  setHost(host)
  await loadSettings()
  await loadKeybindings()
}

const settingsText = (): string | undefined => host.files.read(MOCK_SETTINGS_FILE)
const keysText = (): string | undefined => host.files.read(MOCK_KEYBINDINGS_FILE)
const settingsObject = (): unknown => parseJsonc(settingsText() ?? '{}')
const keysObject = (): unknown => parseJsonc(keysText() ?? '{}')

/** Every line of the text that is a comment, as a list, to see that none was lost. */
const commentLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('//'))

beforeEach(() => {
  clearCommands()
  resetSettings()
  resetSettingsState()
  resetKeybindingsState()
  removeCommands = registerDefaultCommands()
})

afterEach(() => {
  screen?.app.unmount()
  screen?.root.remove()
  screen = undefined
  document.body.replaceChildren()
  removeCommands?.()
  removeCommands = undefined
  clearCommands()
  resetDocuments()
  resetWorkbench()
  setHost(undefined)
})

describe('ISC-424: the open commands write the template into a file that holds nothing', () => {
  const blanks: [string, Record<string, string>][] = [
    ['a file that is missing', {}],
    ['an empty file', { [MOCK_SETTINGS_FILE]: '', [MOCK_KEYBINDINGS_FILE]: '' }],
    ['a file of only {}', { [MOCK_SETTINGS_FILE]: '{}\n', [MOCK_KEYBINDINGS_FILE]: '{ }' }],
  ]

  for (const [what, files] of blanks) {
    it(`for ${what}, settings.json becomes the template and opens`, async () => {
      await start(files)
      expect(await runCommand(COMMAND_IDS.openSettingsFile)).toBe(true)
      expect(settingsText()).toBe(settingsTemplate().text)
      expect([...host.openDocuments().values()]).toContain(MOCK_SETTINGS_FILE)
    })

    it(`for ${what}, keybindings.json becomes the template and opens`, async () => {
      await start(files)
      expect(await runCommand(COMMAND_IDS.openKeybindingsFile)).toBe(true)
      expect(keysText()).toBe(keybindingsTemplate().text)
      expect([...host.openDocuments().values()]).toContain(MOCK_KEYBINDINGS_FILE)
    })
  }

  it('leaves a file with content as it is, comments or not, and opens it', async () => {
    const mine = '{\n  // mine\n  "devtools": true\n}\n'
    const keys = '// shortcuts\n{ "file.new": "Mod+Shift+U" }'
    await start({ [MOCK_SETTINGS_FILE]: mine, [MOCK_KEYBINDINGS_FILE]: keys })
    await runCommand(COMMAND_IDS.openSettingsFile)
    await runCommand(COMMAND_IDS.openKeybindingsFile)
    expect(settingsText()).toBe(mine)
    expect(keysText()).toBe(keys)
    expect([...host.openDocuments().values()]).toEqual(
      expect.arrayContaining([MOCK_SETTINGS_FILE, MOCK_KEYBINDINGS_FILE]),
    )
  })

  it('leaves a file alone while its tab holds edits that are not saved', async () => {
    await start({ [MOCK_SETTINGS_FILE]: '{}\n', [MOCK_KEYBINDINGS_FILE]: '{}\n' })
    for (const path of [MOCK_SETTINGS_FILE, MOCK_KEYBINDINGS_FILE]) {
      const tab = await openPath(path)
      followerOfTab(tab)?.dispatch({ changes: { from: 0, to: 3, insert: '{"x": 1}\n' } })
      expect(documentOfTab(tab)?.dirty).toBe(true)
    }
    await runCommand(COMMAND_IDS.openSettingsFile)
    await runCommand(COMMAND_IDS.openKeybindingsFile)
    expect(settingsText()).toBe('{}\n')
    expect(keysText()).toBe('{}\n')
  })

  it('does not write again when the file already is the template', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: settingsTemplate().text,
      [MOCK_KEYBINDINGS_FILE]: keybindingsTemplate().text,
    })
    let changes = 0
    const stop = host.files.onChange(() => {
      changes++
    })
    await runCommand(COMMAND_IDS.openSettingsFile)
    await runCommand(COMMAND_IDS.openKeybindingsFile)
    stop()
    expect(settingsText()).toBe(settingsTemplate().text)
    expect(keysText()).toBe(keybindingsTemplate().text)
    expect(changes).toBe(0)
  })
})

describe('ISC-420: changing one entry never changes a comment', () => {
  it('keeps every comment of the settings template when a setting changes and changes back', async () => {
    await start({ [MOCK_SETTINGS_FILE]: settingsTemplate().text })
    const before = commentLines(settingsTemplate().text)
    expect(await changeSetting('fonts.size', 20)).toBe(true)
    expect(settingsObject()).toEqual({ fonts: { size: 20 } })
    expect(settings.fonts.size).toBe(20)
    const during = commentLines(settingsText() ?? '')
    // Every line of the template is still there, in order; only the `"size"` example is not (it is
    // the entry itself now), and comes back when it is reset.
    expect(during).toEqual(
      expect.arrayContaining(before.filter((line) => !line.includes('"size"'))),
    )
    expect(await changeSetting('fonts.size', 15)).toBe(true)
    expect(settingsText()).toBe(settingsTemplate().text)
  })

  it('keeps comments the user wrote, in the middle of their entries', async () => {
    await start({ [MOCK_SETTINGS_FILE]: '{\n  // my note\n  "theme": "light", // why\n}\n' })
    await changeSetting('devtools', true)
    const text = settingsText() ?? ''
    expect(text).toContain('// my note')
    expect(text).toContain('"theme": "light", // why')
    expect(settingsObject()).toEqual({ theme: 'light', devtools: true })
  })

  it('keeps every comment of the shortcuts template when a shortcut is rebound and reset', async () => {
    await start({ [MOCK_KEYBINDINGS_FILE]: keybindingsTemplate().text })
    expect(await changeKeybindings({ [COMMAND_IDS.newFile]: 'Mod+Shift+U' })).toBe(true)
    expect(keysObject()).toEqual({ [COMMAND_IDS.newFile]: 'Mod+Shift+U' })
    expect(commentLines(keysText() ?? '')).toEqual(
      expect.arrayContaining(
        commentLines(keybindingsTemplate().text).filter((l) => !l.includes('"file.new"')),
      ),
    )
    expect(await changeKeybindings({ [COMMAND_IDS.newFile]: undefined })).toBe(true)
    expect(keysText()).toBe(keybindingsTemplate().text)
  })
})

describe('ISC-421: Reset all keeps the comments', () => {
  it('takes every shortcut out and leaves the comments, entries of unknown commands included', async () => {
    await start({
      [MOCK_KEYBINDINGS_FILE]:
        '{\n  // mine\n  "file.new": "Mod+Shift+U",\n  "gone.command": "Mod+K", // old\n  "file.open": "F6"\n}\n',
    })
    expect(await changeKeybindings('all')).toBe(true)
    expect(keysObject()).toEqual({})
    expect(keysText()).toContain('// mine')
  })

  it('gives the template again when it started as the template (ISC-427 for Reset all)', async () => {
    await start({ [MOCK_KEYBINDINGS_FILE]: keybindingsTemplate().text })
    await changeKeybindings({
      [COMMAND_IDS.newFile]: 'Mod+Shift+U',
      [COMMAND_IDS.open]: 'Mod+Shift+J',
      [COMMAND_IDS.save]: 'F6',
    })
    expect(keysText()).not.toBe(keybindingsTemplate().text)
    await changeKeybindings('all')
    expect(keysText()).toBe(keybindingsTemplate().text)
  })
})

describe('ISC-422: a file of only comments counts as no entries', () => {
  it('leaves Reset all off for the template, and on once an entry is there', async () => {
    await start({ [MOCK_KEYBINDINGS_FILE]: keybindingsTemplate().text })
    const tab = openSettingsTab('keyboard')
    const root = document.createElement('div')
    document.body.append(root)
    const app = tooltipApp(SettingsView, { tabId: tab })
    app.mount(root)
    screen = { app, root }
    await flush()
    const reset = (): HTMLButtonElement | null =>
      document.querySelector<HTMLButtonElement>('[data-keyboard-reset-all]')
    expect(reset()?.disabled).toBe(true)
    applyKeybindingsText('{\n  // a comment\n  "file.new": "Mod+Shift+U"\n}\n')
    await flush()
    expect(reset()?.disabled).toBe(false)
    applyKeybindingsText('// nothing here\n{}\n')
    await flush()
    expect(reset()?.disabled).toBe(true)
  })
})

describe('ISC-423: comments and trailing commas read without a banner; a real error shows where', () => {
  it('uses the values of a file with comments and trailing commas, with no banner', async () => {
    const text =
      '// top\n{\n  /* why */ "fonts": { "size": 18, }, // note\n  "devtools": true,\n}\n'
    await start({ [MOCK_SETTINGS_FILE]: text, [MOCK_KEYBINDINGS_FILE]: '{ "file.new": "Mod+J", }' })
    expect(settingsFileState.broken).toBeNull()
    expect(settings.fonts.size).toBe(18)
    expect(settings.devtools).toBe(true)
    expect(keybindingsFileState.broken).toBeNull()
    expect(
      commandForEvent(
        new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', ctrlKey: true }),
        'other',
      )?.id,
    ).toBe(COMMAND_IDS.newFile)
  })

  it('still names the line of a real syntax error, in both files', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: '{\n  // c\n  "devtools": true\n  "x": 1\n}',
      [MOCK_KEYBINDINGS_FILE]: '{\n  "file.new": "Mod+J"\n  "file.open": "F6"\n}',
    })
    expect(settingsFileState.broken?.line).toBe(4)
    expect(keybindingsFileState.broken?.line).toBe(3)
  })
})

describe('ISC-426: taking the // off a line takes effect', () => {
  it('changes the setting and the shortcut the line names', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: settingsTemplate().text,
      [MOCK_KEYBINDINGS_FILE]: keybindingsTemplate().text,
    })
    const sizeLine = settingsTemplate().example(['fonts', 'size']) ?? ''
    const block = settingsTemplate().block(['fonts']) ?? []
    expect(settings.fonts.size).toBe(15)
    // The whole group is uncommented with its braces, then the value is edited.
    let text = settingsTemplate().text
    for (const line of block) text = text.replace(`  ${line}`, `  ${line.replace(/^\/\/ ?/, '')}`)
    text = text.replace('"size": 15,', '"size": 21,')
    expect(sizeLine).toContain('"size": 15')
    applySettingsText(text)
    expect(settings.fonts.size).toBe(21)

    const line = keybindingsTemplate().example([COMMAND_IDS.newFile]) ?? ''
    applyKeybindingsText(
      keybindingsTemplate().text.replace(`  ${line}`, '  "file.new": "Mod+Shift+U",'),
    )
    const press = (init: KeyboardEventInit): string | undefined =>
      commandForEvent(new KeyboardEvent('keydown', init), 'other')?.id
    expect(press({ key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true })).toBe(
      COMMAND_IDS.newFile,
    )
    expect(press({ key: 'n', code: 'KeyN', ctrlKey: true })).toBeUndefined()
  })
})

describe('ISC-429: the first change starts from the template, and a no-op writes nothing', () => {
  it('writes the template with the one entry for a file that holds nothing', async () => {
    for (const blank of [undefined, '', '{}\n']) {
      await start(blank === undefined ? {} : { [MOCK_SETTINGS_FILE]: blank })
      await changeSetting('devtools', true)
      const text = settingsText() ?? ''
      expect(settingsObject()).toEqual({ devtools: true })
      expect(text).toContain('// mdmate settings.')
      expect(commentLines(text)).toEqual(
        expect.arrayContaining(
          commentLines(settingsTemplate().text).filter((l) => !l.includes('"devtools"')),
        ),
      )
      setHost(undefined)
      resetSettingsState()
    }
  })

  it('writes no file for a change to the value the setting already has', async () => {
    await start()
    expect(await changeSetting('fonts.size', 15)).toBe(true)
    expect(host.files.has(MOCK_SETTINGS_FILE)).toBe(false)
    expect(await changeKeybindings({ [COMMAND_IDS.newFile]: 'Mod+N' })).toBe(true)
    expect(host.files.has(MOCK_KEYBINDINGS_FILE)).toBe(false)
  })

  it('writes no new text for a change that changes nothing in a file that has entries', async () => {
    const text = '{\n  // mine\n  "devtools": true\n}\n'
    await start({ [MOCK_SETTINGS_FILE]: text })
    await changeSetting('fonts.size', 15)
    expect(settingsText()).toBe(text)
  })
})
