// @vitest-environment jsdom
/**
 * What a change from the settings screen does to `settings.json`. The screen holds no value of its
 * own: a control calls `changeSetting` or `resetSetting`, and the file is the source of truth. So
 * ISC-349 (only the touched key changes; other and unknown keys stay), ISC-350 (the default takes
 * the key out) and ISC-351 (a hand edit shows with no reload) are checked at that boundary here.
 * The mounted screen (rows, search, banner, prompt) adds its own cases to this file in P8-T1d.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  changeSetting,
  isModified,
  resetSetting,
  resetSettingsState,
  settingsFileState,
  watchSettingsFile,
} from '@/features/settings/store'
import { BUILT_IN_EXCLUDED_FOLDERS, resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, MOCK_SETTINGS_FILE, type MockHost } from '@/platform/mock'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let host: MockHost
let stop: (() => void) | undefined

/** The file as an object, so a test compares keys and not spacing. */
function fileObject(): unknown {
  const text = host.files.read(MOCK_SETTINGS_FILE)
  return text === undefined ? undefined : JSON.parse(text)
}

async function start(file?: string): Promise<void> {
  host = createMockHost(file === undefined ? {} : { files: { [MOCK_SETTINGS_FILE]: file } })
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
