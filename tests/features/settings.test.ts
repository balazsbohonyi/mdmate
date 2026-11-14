// @vitest-environment jsdom
/**
 * `settings.json` applied live (P8-T1): ISC-147 (a saved file changes the app with no restart),
 * ISC-148 and ISC-352 (a file that is not JSON keeps the last good values, with a notice and the
 * line), ISC-353 (a bad value is flagged and the last good one stays), ISC-384 (nothing is read
 * from an opened folder) and ISC-386 (a write that fails changes nothing). The behaviour behind
 * each key (wrapping, fonts, paste folder and the rest) adds its own cases here as it lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applySettingsText,
  changeSetting,
  loadSettings,
  resetSettingsState,
  settingsFileState,
  settledSettings,
  watchSettingsFile,
} from '@/features/settings/store'
import { resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, MOCK_SETTINGS_FILE, type MockHost } from '@/platform/mock'
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
    expect(settings.fonts.size).toBe(15)
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
    expect(settings.fonts.codeSize).toBe(14)
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
    // A key taken out of the file goes back to its default.
    host.files.write(MOCK_SETTINGS_FILE, '{"fonts": {"codeSize": 12}}')
    await settle()
    expect([settings.fonts.size, settings.links.onRename]).toEqual([15, 'never'])
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
    expect(settings.fonts.size).toBe(15)
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
    expect(settings.fonts.size).toBe(15)
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

  it('refuses a value the validator refuses, before the file is touched', async () => {
    await start()
    const write = vi.spyOn(host, 'settingsWrite')
    expect(await changeSetting('fonts.size', 400)).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(toasts.last).toContain('fonts.size')
    await settledSettings()
  })
})
