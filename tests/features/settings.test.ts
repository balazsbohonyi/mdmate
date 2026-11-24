// @vitest-environment jsdom
/**
 * `settings.json` applied live (P8-T1): ISC-147 (a saved file changes the app with no restart),
 * ISC-148 and ISC-352 (a file that is not JSON keeps the last good values, with a notice and the
 * line), ISC-353 (a bad value is flagged and the last good one stays), ISC-384 (nothing is read
 * from an opened folder) and ISC-386 (a write that fails changes nothing). The behaviour behind
 * each key (wrapping, fonts, paste folder and the rest) adds its own cases here as it lands.
 */
import { Text } from '@codemirror/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { largeFileNotice } from '@/documents/largeFile'
import { docMeta } from '@/documents/meta'
import { closeAllTabs, documentOfTab, openPath, resetDocuments } from '@/documents/store'
import { createFollowerState, createView } from '@/editor/create'
import {
  applyFontPreset,
  applySettingsText,
  changeSetting,
  loadSettings,
  resetSetting,
  resetSettingsState,
  settingsFileState,
  settledRuntime,
  settledSettings,
  watchSettingsFile,
} from '@/features/settings/store'
import { BUILT_IN_EXCLUDED_FOLDERS, resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, MOCK_SETTINGS_FILE, type MockHost } from '@/platform/mock'
import { isCommandEnabled, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetWorkbench } from '@/workbench/store'
import { toasts } from '../helpers/toasts'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let host: MockHost
let stop: (() => void) | undefined

async function start(files: Record<string, string> = {}): Promise<void> {
  host = createMockHost({ files })
  setHost(host)
  await loadSettings()
}

beforeEach(() => {
  resetSettings()
  resetSettingsState()
})

afterEach(() => {
  stop?.()
  stop = undefined
  setHost(undefined)
})

describe('reading settings.json', () => {
  it('starts on the defaults when there is no file, and says nothing', async () => {
    await start()
    expect(settings.fonts.size).toBeNull()
    expect(settings.editor.wordWrap).toBe(true)
    expect(settingsFileState).toMatchObject({ loaded: true, broken: null, problems: {} })
    expect(toasts.all).toEqual([])
  })

  it('applies what the file holds at start', async () => {
    await start({
      [MOCK_SETTINGS_FILE]:
        '{"fonts": {"size": 19}, "editor": {"wordWrap": false}, "devtools": true}',
    })
    expect(settings.fonts.size).toBe(19)
    expect(settings.editor.wordWrap).toBe(false)
    expect(settings.devtools).toBe(true)
    expect(settings.fonts.codeSize).toBeNull()
  })

  it('ISC-147: a file saved while the app runs is applied with no restart, a key at a time', async () => {
    await start()
    stop = await watchSettingsFile()
    host.files.write(MOCK_SETTINGS_FILE, '{"fonts": {"size": 21}}')
    await settle()
    expect(settings.fonts.size).toBe(21)
    host.files.write(
      MOCK_SETTINGS_FILE,
      '{"fonts": {"size": 21, "codeSize": 12}, "links": {"onRename": "ask"}}',
    )
    await settle()
    expect([settings.fonts.size, settings.fonts.codeSize, settings.links.onRename]).toEqual([
      21,
      12,
      'ask',
    ])
    // A key taken out of the file goes back to its default (null = inherit active preset).
    host.files.write(MOCK_SETTINGS_FILE, '{"fonts": {"codeSize": 12}}')
    await settle()
    expect([settings.fonts.size, settings.links.onRename]).toEqual([null, 'never'])
  })

  it('ISC-148, ISC-352: a file with a missing comma keeps the last good values and names the line', async () => {
    await start({ [MOCK_SETTINGS_FILE]: '{"fonts": {"size": 19}}' })
    stop = await watchSettingsFile()
    host.files.write(
      MOCK_SETTINGS_FILE,
      '{\n  "fonts": {\n    "size": 25\n  }\n  "devtools": true\n}\n',
    )
    await settle()
    expect(settings.fonts.size).toBe(19)
    expect(settings.devtools).toBe(false)
    expect(settingsFileState.broken?.line).toBe(5)
    expect(settingsFileState.broken?.message).toContain('line 5')
    expect(toasts.last).toContain('The last good settings stay in use')
    expect(toasts.lastLevel).toBe('warning')
    // Fixing the file clears the banner and applies it.
    host.files.write(MOCK_SETTINGS_FILE, '{"fonts": {"size": 25}, "devtools": true}')
    await settle()
    expect(settingsFileState.broken).toBeNull()
    expect([settings.fonts.size, settings.devtools]).toEqual([25, true])
  })

  it('ISC-353: "big" and 400 are ignored for fonts.size, flagged on its key, and the previous size stays', async () => {
    await start({ [MOCK_SETTINGS_FILE]: '{"fonts": {"size": 18}}' })
    stop = await watchSettingsFile()
    for (const bad of ['"big"', '400']) {
      host.files.write(MOCK_SETTINGS_FILE, `{"fonts": {"size": ${bad}}, "devtools": true}`)
      await settle()
      expect(settings.fonts.size, bad).toBe(18)
      expect(settingsFileState.problems['fonts.size'], bad).toMatch(/number/)
      // The rest of the file still applies.
      expect(settings.devtools, bad).toBe(true)
      expect(toasts.last, bad).toContain('fonts.size')
    }
    host.files.write(MOCK_SETTINGS_FILE, '{"fonts": {"size": 30}}')
    await settle()
    expect(settings.fonts.size).toBe(30)
    expect(settingsFileState.problems).toEqual({})
  })

  it('a first load with a bad value starts on the default, since no good value was ever held', async () => {
    await start({ [MOCK_SETTINGS_FILE]: '{"fonts": {"size": "big"}}' })
    expect(settings.fonts.size).toBeNull()
    expect(settingsFileState.problems['fonts.size']).toBeDefined()
  })

  it('says each problem once, however many times the same text is read', async () => {
    await start()
    applySettingsText('{ nope')
    applySettingsText('{ nope')
    expect(toasts.messages).toHaveLength(1)
  })

  it('a file that cannot be read keeps the last good values and says so', async () => {
    await start({ [MOCK_SETTINGS_FILE]: '{"fonts": {"size": 19}}' })
    vi.spyOn(host, 'settingsRead').mockRejectedValueOnce(
      new Error('settings.json is not UTF-8 text'),
    )
    await loadSettings()
    expect(settings.fonts.size).toBe(19)
    expect(settingsFileState.broken?.message).toContain('could not be read')
    expect(toasts.last).toContain('could not be read')
  })
})

describe('ISC-384: only the app data folder is read', () => {
  it('a workspace holding a settings.json and a keybindings.json changes nothing', async () => {
    host = createMockHost({
      files: {
        '/work/settings.json': '{"fonts": {"size": 33}, "devtools": true}',
        '/work/keybindings.json': '{"file.new": "Mod+J"}',
        '/work/.mdmate/settings.json': '{"fonts": {"size": 34}}',
        '/work/readme.md': '# hi\n',
      },
      roots: ['/work'],
    })
    setHost(host)
    await loadSettings()
    const { restoreWorkspace } = await import('@/features/tree/store')
    await restoreWorkspace([])
    await settle()
    expect(settings.fonts.size).toBeNull()
    expect(settings.devtools).toBe(false)
    await changeSetting('fonts.size', 20)
    expect(settings.fonts.size).toBe(20)
    // The file the screen wrote is the data folder's; the workspace's own file is untouched.
    expect(host.files.read(MOCK_SETTINGS_FILE)).toContain('"size": 20')
    expect(host.files.read('/work/settings.json')).toBe('{"fonts": {"size": 33}, "devtools": true}')
  })
})

describe('ISC-386: a write that fails changes nothing', () => {
  it('keeps the file and the live value and says why', async () => {
    await start({ [MOCK_SETTINGS_FILE]: '{"fonts": {"size": 18}, "note": "mine"}' })
    vi.spyOn(host, 'settingsWrite').mockRejectedValueOnce(
      Object.assign(new Error('permission was denied'), { kind: 'permission-denied' }),
    )
    expect(await changeSetting('fonts.size', 24)).toBe(false)
    expect(settings.fonts.size).toBe(18)
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe('{"fonts": {"size": 18}, "note": "mine"}')
    expect(toasts.last).toContain('Could not save settings.json')
    expect(toasts.lastLevel).toBe('error')
    // The next change works.
    expect(await changeSetting('fonts.size', 24)).toBe(true)
    expect(settings.fonts.size).toBe(24)
  })

  it('refuses to write over a file that is not valid JSON, and leaves it for the user to fix', async () => {
    const broken = '{\n "fonts": {"size": 18}\n "devtools": true\n}'
    await start({ [MOCK_SETTINGS_FILE]: broken })
    expect(await changeSetting('editor.wordWrap', false)).toBe(false)
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(broken)
    expect(settings.editor.wordWrap).toBe(true)
    expect(toasts.last).toContain('nothing was written')
    expect(toasts.lastLevel).toBe('error')
  })

  it('refuses the content width limit, and the word wrap that goes with it, on a file that is not valid JSON (ISC-552)', async () => {
    const broken = '{\n "editor": {"wordWrap": false}\n "devtools": true\n}'
    await start({ [MOCK_SETTINGS_FILE]: broken })
    toasts.clear()
    expect(await changeSetting('editor.limitContentWidth', true)).toBe(false)
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(broken)
    expect(settings.editor.wordWrap).toBe(true)
    // One notice, and the same one a single key gives.
    expect(toasts.all).toHaveLength(1)
    expect(toasts.last).toContain('nothing was written')
    expect(toasts.lastLevel).toBe('error')
  })

  it('refuses a value the validator refuses, before the file is touched', async () => {
    await start()
    const write = vi.spyOn(host, 'settingsWrite')
    expect(await changeSetting('fonts.size', 400)).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(toasts.last).toContain('fonts.size')
    await settledSettings()
  })
})

describe('the behaviour behind each key (P8-T1b)', () => {
  it('ISC-359: editor.wordWrap false stops the editor wrapping long lines, and true wraps again, with no restart', async () => {
    await start()
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = createView(parent, createFollowerState({ doc: Text.of(['a long line']) }))
    const wrapping = (): boolean => view.contentDOM.classList.contains('cm-lineWrapping')
    expect(wrapping()).toBe(true)
    expect(await changeSetting('editor.wordWrap', false)).toBe(true)
    expect(wrapping()).toBe(false)
    // The file changed by hand reaches the same view.
    host.files.write(MOCK_SETTINGS_FILE, '{}')
    stop = await watchSettingsFile()
    host.files.write(MOCK_SETTINGS_FILE, '{"editor": {"wordWrap": true}}')
    await settle()
    expect(wrapping()).toBe(true)
    host.files.write(MOCK_SETTINGS_FILE, '{"editor": {"wordWrap": false}}')
    await settle()
    expect(wrapping()).toBe(false)
    view.destroy()
    parent.remove()
  })

  it('ISC-364: files.largeFileMB sets the size above which the next opened file is plain text', async () => {
    const MIB = 1024 * 1024
    host = createMockHost({
      files: { '/f/two.md': '# two\n' + 'x'.repeat(2 * MIB), '/f/small.md': '# small\n' },
    })
    setHost(host)
    resetWorkbench()
    resetDocuments()
    // The default is 3 MB, so a 2 MB file has the parser.
    const first = await openPath('/f/two.md')
    expect(docMeta(documentOfTab(first)?.id ?? -1)?.plainSource).toBe(false)
    await closeAllTabs()
    expect(await changeSetting('files.largeFileMB', 1)).toBe(true)
    const second = await openPath('/f/two.md')
    expect(docMeta(documentOfTab(second)?.id ?? -1)?.plainSource).toBe(true)
    expect(largeFileNotice()).toContain('1 MB')
    // A small file is not caught by the lower cutoff, and a file is judged when it opens.
    const small = await openPath('/f/small.md')
    expect(docMeta(documentOfTab(small)?.id ?? -1)?.plainSource).toBe(false)
    expect(docMeta(documentOfTab(second)?.id ?? -1)?.plainSource).toBe(true)
    await closeAllTabs()
    resetWorkbench()
    resetDocuments()
  })

  it('ISC-365: recent.files and recent.folders reach the host, which cuts its two lists to them', async () => {
    await start({
      '/r/a.md': 'a',
      '/r/b.md': 'b',
      '/r/c.md': 'c',
      '/r/d.md': 'd',
    })
    for (const name of ['a', 'b', 'c', 'd']) await host.openFile(`/r/${name}.md`, true)
    expect(await changeSetting('recent.files', 3)).toBe(true)
    await settledRuntime()
    expect(host.runtime.values).toMatchObject({ recentFiles: 3, recentFolders: 5 })
    expect(await changeSetting('recent.folders', 2)).toBe(true)
    await settledRuntime()
    expect(host.runtime.values).toMatchObject({ recentFiles: 3, recentFolders: 2 })
    expect((await host.recentList()).files.length).toBeLessThanOrEqual(3)
  })

  it('ISC-366: a changed workspace.excludedFolders reaches the host once, and an unrelated change does not', async () => {
    await start()
    const sent = (): number => host.runtime.calls.length
    const base = sent()
    expect(host.runtime.values.excludedFolders).toEqual([...BUILT_IN_EXCLUDED_FOLDERS])
    expect(
      await changeSetting('workspace.excludedFolders', [...BUILT_IN_EXCLUDED_FOLDERS, 'drafts']),
    ).toBe(true)
    await settledRuntime()
    expect(sent()).toBe(base + 1)
    expect(host.runtime.values.excludedFolders).toContain('drafts')
    // A change to a key Rust does not use sends nothing; the same list again sends nothing.
    expect(await changeSetting('fonts.size', 18)).toBe(true)
    await settledRuntime()
    expect(sent()).toBe(base + 1)
    // Taking the key out goes back to the built-in names.
    expect(await resetSetting('workspace.excludedFolders')).toBe(true)
    await settledRuntime()
    expect(host.runtime.values.excludedFolders).toEqual([...BUILT_IN_EXCLUDED_FOLDERS])
    expect(sent()).toBe(base + 2)
  })

  it('ISC-647: workspace.hiddenNames belongs to the page alone: a change sends nothing to Rust', async () => {
    await start()
    const base = host.runtime.calls.length
    expect(Object.keys(host.runtime.values)).not.toContain('hiddenNames')
    expect(await changeSetting('workspace.hiddenNames', ['.git', 'drafts'])).toBe(true)
    await settledRuntime()
    expect(host.runtime.calls.length).toBe(base)
    expect(host.runtime.values.excludedFolders).toEqual([...BUILT_IN_EXCLUDED_FOLDERS])
    expect(await resetSetting('workspace.hiddenNames')).toBe(true)
    await settledRuntime()
    expect(host.runtime.calls.length).toBe(base)
  })

  it('ISC-653: git.enabled and git.path reach the host, and only a change sends them', async () => {
    await start()
    const base = host.runtime.calls.length
    expect(host.runtime.values).toMatchObject({ gitEnabled: true, gitPath: '' })
    expect(await changeSetting('git.enabled', false)).toBe(true)
    await settledRuntime()
    expect(host.runtime.calls.length).toBe(base + 1)
    expect(host.runtime.values).toMatchObject({ gitEnabled: false, gitPath: '' })
    expect(await changeSetting('git.path', '/usr/bin/git')).toBe(true)
    await settledRuntime()
    expect(host.runtime.calls.length).toBe(base + 2)
    expect(host.runtime.values).toMatchObject({ gitEnabled: false, gitPath: '/usr/bin/git' })
    expect(await changeSetting('git.path', '/usr/bin/git')).toBe(true)
    await settledRuntime()
    expect(host.runtime.calls.length).toBe(base + 2)
    expect(await resetSetting('git.path')).toBe(true)
    expect(await resetSetting('git.enabled')).toBe(true)
    await settledRuntime()
    expect(host.runtime.values).toMatchObject({ gitEnabled: true, gitPath: '' })
  })

  it('applies what the file holds to Rust at start, before anything is pasted or restored', async () => {
    await start({
      [MOCK_SETTINGS_FILE]:
        '{"images": {"pasteFolder": "media"}, "recent": {"files": 4}, "devtools": true}',
    })
    expect(host.runtime.values).toMatchObject({
      pasteFolder: 'media',
      recentFiles: 4,
      devtools: true,
    })
  })

  it('warns, applies none of it and tries again at the next change when Rust refuses what the page sent', async () => {
    await start()
    vi.spyOn(host, 'settingsApply').mockRejectedValueOnce(new Error('rust disagrees'))
    expect(await changeSetting('recent.files', 7)).toBe(true)
    await settledRuntime()
    expect(toasts.last).toContain('Could not apply the settings')
    expect(await changeSetting('recent.files', 8)).toBe(true)
    await settledRuntime()
    expect(host.runtime.values.recentFiles).toBe(8)
  })

  it('ISC-249: F12 opens the developer tools only while the devtools setting is on', async () => {
    await start()
    const dispose = registerDefaultCommands()
    try {
      expect(isCommandEnabled(COMMAND_IDS.openDevtools)).toBe(false)
      expect(await runCommand(COMMAND_IDS.openDevtools)).toBe(false)
      expect(host.runtime.devtoolsOpened).toBe(0)
      // A page that skips its own check still gets refused by the host.
      await expect(host.devtoolsOpen()).rejects.toMatchObject({ kind: 'not-allowed' })

      expect(await changeSetting('devtools', true)).toBe(true)
      await settledRuntime()
      expect(isCommandEnabled(COMMAND_IDS.openDevtools)).toBe(true)
      expect(await runCommand(COMMAND_IDS.openDevtools)).toBe(true)
      expect(host.runtime.devtoolsOpened).toBe(1)

      expect(await resetSetting('devtools')).toBe(true)
      await settledRuntime()
      expect(isCommandEnabled(COMMAND_IDS.openDevtools)).toBe(false)
      await expect(host.devtoolsOpen()).rejects.toMatchObject({ kind: 'not-allowed' })
    } finally {
      dispose()
    }
  })

  it('ISC-723: applyFontPreset clears all eight font and typography metric overrides atomically', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: JSON.stringify({
        fonts: {
          preset: 'editorial',
          density: 'compact',
          heading: 'Georgia',
          body: 'Verdana',
          code: 'Consolas',
          size: 20,
          lineHeight: 1.8,
          codeSize: 15,
          codeLineHeight: 1.7,
          headingScale: [2, 1.5, 1.25, 1.1, 1, 0.9],
        },
      }),
    })
    expect(await applyFontPreset('modern')).toBe(true)
    expect(JSON.parse(host.files.read(MOCK_SETTINGS_FILE) ?? '{}')).toEqual({
      fonts: { preset: 'modern', density: 'compact' },
    })
    expect(settings.fonts).toEqual({
      preset: 'modern',
      density: 'compact',
      heading: '',
      body: '',
      code: '',
      size: null,
      codeSize: null,
      lineHeight: null,
      codeLineHeight: null,
      headingScale: null,
    })
  })
})
