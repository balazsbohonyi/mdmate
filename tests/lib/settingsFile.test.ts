/**
 * The one validator behind `settings.json` (P8-T1): every key, its default, and what happens to a
 * value of the wrong type or outside its range. Data enters as `unknown`.
 */
import { describe, expect, it } from 'vitest'
import pasteFolders from '../data/paste-folders.json'
import { BUILT_IN_EXCLUDED_FOLDERS, cloneSettings, DEFAULT_SETTINGS } from '@/lib/settings'
import {
  checkPasteFolder,
  describeSyntax,
  parseSettingsText,
  SETTING_DEFS,
  SETTING_KEYS,
  settingsAfter,
  type SettingKey,
} from '@/lib/settingsFile'

describe('the key table', () => {
  it('has a default that passes its own check, for every key', () => {
    for (const key of SETTING_KEYS) {
      const def = SETTING_DEFS[key]
      const checked = def.check(def.default)
      expect(checked.ok, key).toBe(true)
    }
  })

  it('keeps the defaults of today: sizes, heading scale, wrapping and the built-in folder list', () => {
    expect(DEFAULT_SETTINGS.fonts.size).toBe(15)
    expect(DEFAULT_SETTINGS.fonts.codeSize).toBe(14)
    expect(DEFAULT_SETTINGS.fonts.headingScale).toEqual([1.7, 1.45, 1.25, 1.1, 1, 0.95])
    expect(DEFAULT_SETTINGS.editor.wordWrap).toBe(true)
    expect(DEFAULT_SETTINGS.images.pasteFolder).toBe('assets')
    expect(DEFAULT_SETTINGS.links.onRename).toBe('never')
    expect(DEFAULT_SETTINGS.files.largeFileMB).toBe(3)
    expect([DEFAULT_SETTINGS.recent.files, DEFAULT_SETTINGS.recent.folders]).toEqual([10, 5])
    expect(DEFAULT_SETTINGS.theme).toBe('dark')
    expect(DEFAULT_SETTINGS.devtools).toBe(false)
    expect(BUILT_IN_EXCLUDED_FOLDERS).toHaveLength(21)
  })

  it('spells every path as the key spells it', () => {
    for (const key of SETTING_KEYS) expect(SETTING_DEFS[key].path.join('.')).toBe(key)
  })
})

describe('parseSettingsText', () => {
  it('reads empty text, a byte order mark and a missing key as nothing set', () => {
    for (const text of ['', '  \n', '\uFEFF', '{}', '\uFEFF{}']) {
      const parsed = parseSettingsText(text)
      expect(parsed.ok, JSON.stringify(text)).toBe(true)
      if (parsed.ok) expect(parsed.present.size).toBe(0)
    }
  })

  it('says where a file that is not JSON stops making sense', () => {
    const parsed = parseSettingsText('{\n  "fonts": {\n    "size": 18\n  }\n  "devtools": true\n}')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.spot.line).toBe(5)
    expect(describeSyntax(parsed)).toContain('line 5')
    expect(describeSyntax(parsed)).toContain('comments and trailing commas')
  })

  it('refuses a file that is JSON but not one object, and a comment', () => {
    for (const text of ['[]', '"x"', '5', 'null', '// hi\n{}', '{"a": 1,}']) {
      expect(parseSettingsText(text).ok, text).toBe(false)
    }
  })

  it('checks each known key on its own: one bad value leaves the others alone', () => {
    const parsed = parseSettingsText('{"fonts": {"size": "big", "codeSize": 16}, "devtools": true}')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.present.get('fonts.size')).toEqual({ ok: false, why: 'Use a number.' })
    expect(parsed.present.get('fonts.codeSize')).toEqual({ ok: true, value: 16 })
    expect(parsed.present.get('devtools')).toEqual({ ok: true, value: true })
    expect(parsed.problems).toEqual([{ key: 'fonts.size', message: 'Use a number.' }])
  })

  it('flags a group that is not an object once, and every key under it as unusable', () => {
    const parsed = parseSettingsText('{"fonts": 5}')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.problems.filter((p) => p.group === 'fonts')).toHaveLength(1)
    for (const key of ['fonts.size', 'fonts.heading', 'fonts.headingScale'] as const) {
      expect(parsed.present.get(key)?.ok, key).toBe(false)
    }
    expect(parsed.present.has('editor.wordWrap')).toBe(false)
  })

  it('ignores keys it does not know', () => {
    const parsed = parseSettingsText('{"nextYear": {"x": 1}, "fonts": {"newKey": 1}}')
    expect(parsed.ok && parsed.present.size).toBe(0)
    expect(parsed.ok && parsed.problems).toEqual([])
  })
})

describe('the value rules', () => {
  const check = (key: SettingKey, value: unknown): boolean => SETTING_DEFS[key].check(value).ok

  it('takes a size from 8 to 40 and refuses text, 400 and NaN', () => {
    expect(check('fonts.size', 20)).toBe(true)
    expect(check('fonts.size', 15.5)).toBe(true)
    for (const bad of ['big', 400, 7.9, Number.NaN, Infinity, null, [], '20']) {
      expect(check('fonts.size', bad), String(bad)).toBe(false)
    }
    expect(check('fonts.codeSize', 18)).toBe(true)
    expect(check('fonts.codeSize', 41)).toBe(false)
  })

  it('takes six heading multiples from 0.5 to 4', () => {
    expect(check('fonts.headingScale', [2, 1.5, 1.25, 1.1, 1, 0.9])).toBe(true)
    for (const bad of [
      [1, 2],
      [],
      'x',
      [1, 1, 1, 1, 1, 9],
      [1, 1, 1, 1, 1, '1'],
      [1, 1, 1, 1, 1, 0.2],
    ]) {
      expect(check('fonts.headingScale', bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('takes a font family or an empty one, and refuses what could end a CSS value', () => {
    for (const good of ['', 'Georgia', '"Source Serif 4", serif', 'Cascadia Code']) {
      expect(check('fonts.body', good), good).toBe(true)
    }
    for (const bad of ['a;b', 'a{b', 'a}b', '<x>', 'a\\b', 'a\nb', 5, 'x'.repeat(201)]) {
      expect(check('fonts.body', bad), String(bad)).toBe(false)
    }
  })

  it('takes a folder name or a relative path for the paste folder and nothing that leaves it', () => {
    for (const good of ['assets', 'img', 'images/pasted', 'a-b_c', 'my.images', '.assets']) {
      expect(checkPasteFolder(good).ok, good).toBe(true)
    }
    for (const bad of [
      'C:/x',
      'c:\\x',
      '/x',
      '\\x',
      '../x',
      'a/../b',
      '..',
      '.',
      'a//b',
      'a/',
      '~/x',
      '',
      '  ',
      'con',
      'a/NUL.txt',
      'a.',
      'a /b',
      'a b',
      'a(b)',
      'a#b',
      'a:b',
      'a<b',
      'x'.repeat(101),
      5,
      null,
    ]) {
      expect(checkPasteFolder(bad).ok, String(bad)).toBe(false)
    }
  })

  it('writes a backslash path with slashes', () => {
    expect(checkPasteFolder('images\\pasted')).toEqual({ ok: true, value: 'images/pasted' })
  })

  it('takes the three link behaviours and nothing else', () => {
    for (const good of ['ask', 'update', 'never']) expect(check('links.onRename', good)).toBe(true)
    for (const bad of ['Ask', 'always', '', true, null])
      expect(check('links.onRename', bad)).toBe(false)
  })

  it('takes whole recent counts from 0 to 50 and a size from 1 to 1024 MB', () => {
    expect(check('recent.files', 0)).toBe(true)
    expect(check('recent.files', 50)).toBe(true)
    for (const bad of [-1, 51, 2.5, '3'])
      expect(check('recent.files', bad), String(bad)).toBe(false)
    expect(check('files.largeFileMB', 1)).toBe(true)
    expect(check('files.largeFileMB', 0.5)).toBe(false)
    expect(check('files.largeFileMB', 2000)).toBe(false)
  })

  it('takes a list of folder names, drops repeats and refuses paths', () => {
    expect(SETTING_DEFS['workspace.excludedFolders'].check(['a', 'B', 'b', 'c'])).toEqual({
      ok: true,
      value: ['a', 'B', 'c'],
    })
    expect(check('workspace.excludedFolders', [])).toBe(true)
    for (const bad of [
      'a',
      [''],
      ['a/b'],
      ['a\\b'],
      [1],
      Array.from({ length: 201 }, (_, i) => `f${String(i)}`),
    ]) {
      expect(check('workspace.excludedFolders', bad), JSON.stringify(bad).slice(0, 30)).toBe(false)
    }
  })

  it('takes a theme name and refuses a path', () => {
    expect(check('theme', 'sepia')).toBe(true)
    expect(check('theme', 'my theme')).toBe(true)
    for (const bad of ['', '../x', 'a/b', 5]) expect(check('theme', bad), String(bad)).toBe(false)
  })
})

describe('settingsAfter', () => {
  const base = cloneSettings(DEFAULT_SETTINGS)

  it('applies a good value, defaults a key the file lacks, and keeps the last good value for a bad one', () => {
    const before = cloneSettings(DEFAULT_SETTINGS)
    before.fonts.size = 18
    before.devtools = true
    const parsed = parseSettingsText('{"fonts": {"size": "big"}, "editor": {"wordWrap": false}}')
    const after = settingsAfter(before, parsed)
    expect(after.fonts.size).toBe(18) // bad: the last good value
    expect(after.editor.wordWrap).toBe(false) // good
    expect(after.devtools).toBe(false) // absent: the default
  })

  it('changes nothing for a file that does not parse', () => {
    const before = cloneSettings(DEFAULT_SETTINGS)
    before.fonts.size = 22
    expect(settingsAfter(before, parseSettingsText('{ nope'))).toEqual(before)
  })

  it('does not share arrays with its input or with the defaults', () => {
    const after = settingsAfter(base, parseSettingsText('{}'))
    expect(after.fonts.headingScale).not.toBe(DEFAULT_SETTINGS.fonts.headingScale)
    expect(after.workspace.excludedFolders).not.toBe(BUILT_IN_EXCLUDED_FOLDERS)
  })
})

describe('the paste folder rule shared with Rust (tests/data/paste-folders.json)', () => {
  it('reads the shared cases', () => {
    expect(pasteFolders.length).toBeGreaterThan(20)
  })

  for (const sample of pasteFolders as readonly { input: string; folder: string | null }[]) {
    it(`says the same as Rust about ${JSON.stringify(sample.input)}`, () => {
      const checked = checkPasteFolder(sample.input)
      expect(checked.ok ? checked.value : null).toBe(sample.folder)
    })
  }
})
