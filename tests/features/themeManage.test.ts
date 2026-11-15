// @vitest-environment jsdom
/**
 * Managing themes (P8-T6): making one from a palette (ISC-474), copying (ISC-475), renaming
 * (ISC-476), deleting to the Recycle Bin (ISC-477) and changing the base (ISC-479). The page runs
 * on the mock host, whose files stand in for the themes folder and whose `recycled` list stands in
 * for the bin.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  copyTheme,
  createTheme,
  deleteTheme,
  duplicateTheme,
  editTheme,
  renameTheme,
  setThemeBase,
  suggestCopyName,
} from '@/features/themes/customize'
import {
  currentTheme,
  editorScrollRequests,
  loadThemes,
  resetThemesState,
  settledThemes,
} from '@/features/themes/store'
import { loadSettings, resetSettingsState } from '@/features/settings/store'
import { BUILT_IN_IDS } from '@/lib/builtinThemes'
import { formatColor, parseColor, toHex } from '@/lib/color'
import { resetSettings, settings } from '@/lib/settings'
import { parseThemeText } from '@/lib/themeFile'
import { effectiveTokens } from '@/lib/themes'
import { THEME_TOKENS } from '@/lib/themeTokens'
import { setHost } from '@/platform'
import {
  createMockHost,
  MOCK_SETTINGS_FILE,
  MOCK_THEMES_FOLDER,
  type MockHost,
  type MockHostOptions,
} from '@/platform/mock'
import { toasts } from '../helpers/toasts'

const themeFile = (name: string): string => `${MOCK_THEMES_FOLDER}/${name}.json`

let host: MockHost

async function start(
  files: Record<string, string> = {},
  options: MockHostOptions = {},
): Promise<void> {
  host = createMockHost({ files, ...options })
  setHost(host)
  await loadSettings()
  await loadThemes()
}

beforeEach(() => {
  resetSettings()
  resetSettingsState()
  resetThemesState()
  document.documentElement.className = 'dark'
  document.documentElement.removeAttribute('style')
})

afterEach(async () => {
  await settledThemes()
  setHost(undefined)
})

/** The names of the theme files, without `.json`, in the order the mock lists them. */
const stems = (): string[] =>
  host.files
    .paths()
    .filter((path) => path.startsWith(`${MOCK_THEMES_FOLDER}/`))
    .map((path) => path.slice(MOCK_THEMES_FOLDER.length + 1, -'.json'.length))
    .sort()

const parsed = (stem: string): Extract<ReturnType<typeof parseThemeText>, { ok: true }> => {
  const result = parseThemeText(host.files.read(themeFile(stem)) ?? '')
  if (!result.ok) throw new Error(`${stem}.json does not parse: ${result.message}`)
  return result
}

const MINE =
  '{ "name": "Mine", "base": "light", "colors": { "background": "#abcdef", "primary": "#112233" } }'
const SELECT_MINE = {
  [MOCK_SETTINGS_FILE]: '{ "theme": "Mine" }',
  [themeFile('Mine')]: MINE,
}

describe('ISC-474: New theme', () => {
  it.each(BUILT_IN_IDS)(
    'from %s: the name, the base and every color of the palette in the chosen format, selected, editor asked for',
    async (id) => {
      await start()
      const asked = editorScrollRequests.value
      const made = await createTheme(`My ${id}`, id)
      expect(made).toEqual({ ok: true, value: `My ${id}` })
      const file = parsed(`My ${id}`).theme
      expect(file.name).toBe(`My ${id}`)
      expect(file.base).toBe(id)
      expect(file.colors.size).toBe(THEME_TOKENS.length)
      const palette = effectiveTokens({ palette: id, overrides: new Map() })
      for (const [token, value] of palette)
        expect(file.colors.get(token), token).toBe(formatColor(value, 'hex'))
      expect(settings.theme).toBe(`My ${id}`)
      expect(editorScrollRequests.value).toBe(asked + 1)
      expect(currentTheme.value.user?.label).toBe(`My ${id}`)
    },
  )

  it('from the theme in use: its own colors, on its base', async () => {
    await start(SELECT_MINE)
    expect(await createTheme('Based on mine', 'current')).toEqual({
      ok: true,
      value: 'Based on mine',
    })
    const file = parsed('Based on mine').theme
    expect(file.base).toBe('light')
    expect(file.colors.get('background')).toBe('#abcdef')
    expect(file.colors.get('primary')).toBe('#112233')
    expect(file.colors.size).toBe(THEME_TOKENS.length)
  })

  it.each([
    ['', 'nothing'],
    ['   ', 'only spaces'],
    ['Dark', 'a built-in name'],
    ['SEPIA', 'a built-in name in capitals'],
    ['system', 'the System theme'],
    ['x'.repeat(61), 'over 60 characters'],
    ['mine', 'a name a theme has, in another case'],
    ['bad\u0007name', 'a control character'],
  ])('refuses %j (%s) with a reason and writes nothing', async (name) => {
    await start(SELECT_MINE)
    const before = stems()
    const asked = editorScrollRequests.value
    const made = await createTheme(name, 'dark')
    expect(made.ok).toBe(false)
    if (!made.ok) expect(made.why.length).toBeGreaterThan(5)
    expect(stems()).toEqual(before)
    expect(settings.theme).toBe('Mine')
    expect(editorScrollRequests.value).toBe(asked)
  })

  it('keeps any characters in the name and derives a safe file name from it', async () => {
    await start()
    expect(await createTheme('Café: night/mode?', 'dark')).toEqual({
      ok: true,
      value: 'Café- night-mode-',
    })
    expect(parsed('Café- night-mode-').theme.name).toBe('Café: night/mode?')
    // A different name with the same file name gets a number on the file only.
    expect(await createTheme('Café- night-mode-', 'dark')).toEqual({
      ok: true,
      value: 'Café- night-mode- 2',
    })
    expect(parsed('Café- night-mode- 2').theme.name).toBe('Café- night-mode-')
  })
})

describe('ISC-475: Duplicate', () => {
  it('copies a built-in theme into "<name> copy", colors in the chosen format, and selects it', async () => {
    await start()
    expect(await duplicateTheme('sepia')).toBe('Sepia copy')
    const file = parsed('Sepia copy').theme
    expect(file.name).toBe('Sepia copy')
    expect(file.base).toBe('sepia')
    for (const [token, value] of effectiveTokens({ palette: 'sepia', overrides: new Map() }))
      expect(file.colors.get(token), token).toBe(formatColor(value, 'hex'))
    expect(settings.theme).toBe('Sepia copy')
  })

  it('numbers the next copy, and copies a theme that is not in use without touching it', async () => {
    await start(SELECT_MINE)
    expect(await duplicateTheme('dark')).toBe('Dark copy')
    expect(await duplicateTheme('dark')).toBe('Dark copy 2')
    expect(await duplicateTheme('Mine')).toBe('Mine copy')
    expect(host.files.read(themeFile('Mine'))).toBe(MINE)
    const copy = parsed('Mine copy').theme
    expect(copy.base).toBe('light')
    expect(copy.colors.get('background')).toBe('#abcdef')
    expect(settings.theme).toBe('Mine copy')
  })

  it('copies what System shows now, Light while the system is light', async () => {
    await start()
    expect(await duplicateTheme('system')).toBe('System copy')
    expect(parsed('System copy').theme.base).toBe('light')
  })
})

describe('ISC-476: Rename', () => {
  const COMMENTED = `{
  // my favourite
  "name": "Mine",
  "base": "light",
  "colors": { "background": "#abcdef" }
}
`

  it('renames the theme in use: name and file together, comments kept, still in use, no notice', async () => {
    await start({ ...SELECT_MINE, [themeFile('Mine')]: COMMENTED })
    expect(await renameTheme('Mine', 'Night owl')).toEqual({ ok: true, value: 'Night owl' })
    await settledThemes()
    expect(stems()).toEqual(['Night owl'])
    const text = host.files.read(themeFile('Night owl')) ?? ''
    expect(text).toContain('// my favourite')
    expect(parsed('Night owl').theme.name).toBe('Night owl')
    expect(parsed('Night owl').theme.colors.get('background')).toBe('#abcdef')
    expect(settings.theme).toBe('Night owl')
    expect(currentTheme.value.user?.id).toBe('Night owl')
    expect(toasts.all).toEqual([])
  })

  it('renames a theme that is not in use and leaves the selection alone', async () => {
    await start({ ...SELECT_MINE, [MOCK_SETTINGS_FILE]: '{ "theme": "dark" }' })
    expect((await renameTheme('Mine', 'Other name')).ok).toBe(true)
    expect(stems()).toEqual(['Other name'])
    expect(settings.theme).toBe('dark')
  })

  it('adds a name to a file that had none', async () => {
    await start({ [themeFile('plain')]: '{ "base": "dark", "colors": {} }' })
    expect((await renameTheme('plain', 'Fancy')).ok).toBe(true)
    expect(parsed('Fancy').theme.name).toBe('Fancy')
  })

  it('refuses a name another theme has, in any case, and changes nothing', async () => {
    await start({ ...SELECT_MINE, [themeFile('Other')]: '{ "name": "Other", "colors": {} }' })
    const before = stems().map((stem) => host.files.read(themeFile(stem)))
    const refused = await renameTheme('Mine', 'other')
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.why).toContain('exists')
    expect(stems().map((stem) => host.files.read(themeFile(stem)))).toEqual(before)
    expect(settings.theme).toBe('Mine')
  })

  it('refuses a built-in name, and accepts the same name in another case for itself', async () => {
    await start(SELECT_MINE)
    expect((await renameTheme('Mine', 'Dark')).ok).toBe(false)
    expect((await renameTheme('Mine', 'MINE')).ok).toBe(true)
    expect(parsed('MINE').theme.name).toBe('MINE')
    expect(settings.theme).toBe('MINE')
  })

  it('says so when the file is gone, and when it is not valid JSON, and writes nothing', async () => {
    await start({ ...SELECT_MINE, [themeFile('Broken')]: '{ "colors": ' })
    const broken = host.files.read(themeFile('Broken'))
    expect((await renameTheme('Broken', 'Fixed')).ok).toBe(false)
    expect(host.files.read(themeFile('Broken'))).toBe(broken)
    expect(toasts.last).toContain('valid JSON')
  })
})

describe('ISC-477: Delete', () => {
  it('sends a theme that is not in use to the bin and changes nothing else', async () => {
    await start({ ...SELECT_MINE, [MOCK_SETTINGS_FILE]: '{ "theme": "dark" }' })
    expect(await deleteTheme('Mine')).toBe(true)
    expect(stems()).toEqual([])
    expect(host.recycled.map((one) => one.path)).toEqual([themeFile('Mine')])
    expect(settings.theme).toBe('dark')
  })

  it('gives way to Dark for the theme in use, and says so', async () => {
    await start(SELECT_MINE)
    expect(await deleteTheme('Mine')).toBe(true)
    await settledThemes()
    expect(settings.theme).toBe('dark')
    expect(currentTheme.value.palette).toBe('dark')
    expect(toasts.last).toContain('Recycle Bin')
    expect(toasts.last).toContain('Dark')
    expect(toasts.messages.filter((message) => message.includes('not found'))).toEqual([])
  })

  it('keeps the file and the selection when there is no Recycle Bin, and says why', async () => {
    await start(SELECT_MINE, { noRecycleBin: true })
    expect(await deleteTheme('Mine')).toBe(false)
    expect(stems()).toEqual(['Mine'])
    expect(host.recycled).toEqual([])
    expect(settings.theme).toBe('Mine')
    expect(toasts.lastLevel).toBe('error')
    expect(toasts.last).toContain('Recycle Bin')
  })
})

/** The 8-bit color a value paints, whatever format it is written in. */
const seen = (value: string): string => toHex(parseColor(value))

describe('ISC-479: the base of a theme', () => {
  const colorsOf = (): Map<string, string> => effectiveTokens(currentTheme.value)

  it('keeps every color shown when the base changes, writing what the file left out first', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: '{ "theme": "Mine" }',
      [themeFile('Mine')]:
        '{ "name": "Mine", "base": "dark", "colors": { "background": "#abcdef" } }',
    })
    const before = colorsOf()
    expect(await setThemeBase('light')).toBe(true)
    await settledThemes()
    const file = parsed('Mine').theme
    expect(file.base).toBe('light')
    expect(file.colors.size).toBe(THEME_TOKENS.length)
    expect(currentTheme.value.palette).toBe('light')
    const after = colorsOf()
    expect([...after.keys()]).toEqual([...before.keys()])
    // Written out in the chosen format, so the text may differ; the color shown may not.
    for (const [token, value] of before)
      expect(seen(after.get(token) ?? ''), token).toEqual(seen(value))
  })

  it('does nothing for the base it already has', async () => {
    await start(SELECT_MINE)
    const before = host.files.read(themeFile('Mine'))
    expect(await setThemeBase('light')).toBe(true)
    expect(host.files.read(themeFile('Mine'))).toBe(before)
  })
})

/** True when every color of the file is written in this format. */
function allIn(stem: string, format: 'hex' | 'oklch'): string[] {
  return [...parsed(stem).theme.colors]
    .filter(([, value]) => (format === 'hex' ? !value.startsWith('#') : !/^oklch\(/i.test(value)))
    .map(([token, value]) => `${token}=${value}`)
}

describe('ISC-491: a made theme holds its colors in the chosen format', () => {
  it.each(['hex', 'oklch'] as const)('New theme in %s mode, from every palette', async (format) => {
    await start({ [MOCK_SETTINGS_FILE]: `{ "themes": { "colorFormat": "${format}" } }` })
    for (const id of BUILT_IN_IDS) {
      await createTheme(`Made ${id}`, id)
      expect(allIn(`Made ${id}`, format), id).toEqual([])
      const palette = effectiveTokens({ palette: id, overrides: new Map() })
      for (const [token, value] of palette)
        expect(seen(parsed(`Made ${id}`).theme.colors.get(token) ?? ''), token).toEqual(seen(value))
    }
  })

  it.each(['hex', 'oklch'] as const)(
    'Duplicate in %s mode, of a built-in (oklch sources) and of a file written in hex',
    async (format) => {
      await start({
        [MOCK_SETTINGS_FILE]: `{ "theme": "Mine", "themes": { "colorFormat": "${format}" } }`,
        [themeFile('Mine')]: MINE,
      })
      expect(await duplicateTheme('dark')).toBe('Dark copy')
      expect(await duplicateTheme('Mine')).toBe('Mine copy')
      expect(allIn('Dark copy', format)).toEqual([])
      expect(allIn('Mine copy', format)).toEqual([])
      expect(seen(parsed('Mine copy').theme.colors.get('background') ?? '')).toBe('#abcdef')
    },
  )

  it.each(['hex', 'oklch'] as const)(
    'a base switch in %s mode writes what the file left out in it',
    async (format) => {
      await start({
        [MOCK_SETTINGS_FILE]: `{ "theme": "Mine", "themes": { "colorFormat": "${format}" } }`,
        [themeFile('Mine')]:
          '{ "name": "Mine", "base": "dark", "colors": { "background": "#abcdef" } }',
      })
      expect(await setThemeBase('light')).toBe(true)
      await settledThemes()
      // The color the user set stays as it was; every color written out for them is in the format.
      expect(parsed('Mine').theme.colors.get('background')).toBe('#abcdef')
      expect(allIn('Mine', format)).toEqual(format === 'hex' ? [] : ['background=#abcdef'])
    },
  )
})

describe('ISC-481: choosing a theme to edit', () => {
  it('asks for the editor, and does not touch the file', async () => {
    await start({ ...SELECT_MINE, [MOCK_SETTINGS_FILE]: '{ "theme": "dark" }' })
    const asked = editorScrollRequests.value
    await editTheme('Mine')
    expect(editorScrollRequests.value).toBe(asked + 1)
    expect(settings.theme).toBe('Mine')
    expect(host.files.read(themeFile('Mine'))).toBe(MINE)
  })
})

describe('ISC-482: a built-in theme is never renamed, deleted or written', () => {
  const BUILT_INS = ['dark', 'light', 'sepia', 'system', 'Dark', 'SYSTEM']

  it.each(BUILT_INS)(
    'refuses to rename, delete or edit %s, with no notice and no change',
    async (id) => {
      await start(SELECT_MINE)
      const files = stems().map((stem) => [stem, host.files.read(themeFile(stem))])
      const asked = editorScrollRequests.value
      const renamed = await renameTheme(id, 'Something else')
      expect(renamed.ok).toBe(false)
      if (!renamed.ok) expect(renamed.why).toContain('built-in')
      expect(await deleteTheme(id)).toBe(false)
      await editTheme(id)
      await settledThemes()
      expect(stems().map((stem) => [stem, host.files.read(themeFile(stem))])).toEqual(files)
      expect(host.recycled).toEqual([])
      expect(settings.theme).toBe('Mine')
      expect(editorScrollRequests.value).toBe(asked)
      expect(toasts.all).toEqual([])
    },
  )

  it.each(['dark', 'light', 'sepia', 'system'])(
    'writes nothing for a base change while %s is in use',
    async (id) => {
      await start({ [MOCK_SETTINGS_FILE]: JSON.stringify({ theme: id }) })
      expect(await setThemeBase('sepia')).toBe(true)
      await settledThemes()
      expect(stems()).toEqual([])
      expect(settings.theme).toBe(id)
    },
  )
})

describe('ISC-486: a copy takes the name it is given', () => {
  it('suggests "<name> copy" for a built-in, for a user theme and for System, numbered when taken', async () => {
    await start(SELECT_MINE)
    expect(suggestCopyName('dark')).toBe('Dark copy')
    expect(suggestCopyName('system')).toBe('System copy')
    expect(suggestCopyName('Mine')).toBe('Mine copy')
    expect(suggestCopyName()).toBe('Mine copy')
    expect(await duplicateTheme('Mine')).toBe('Mine copy')
    expect(suggestCopyName('Mine')).toBe('Mine copy 2')
  })

  it('writes the name given as the theme name and file, with the colors of the source in the chosen format', async () => {
    await start(SELECT_MINE)
    expect(await copyTheme('Mine', 'My brighter one')).toEqual({
      ok: true,
      value: 'My brighter one',
    })
    const file = parsed('My brighter one').theme
    expect(file.name).toBe('My brighter one')
    expect(file.base).toBe('light')
    expect(file.colors.get('background')).toBe('#abcdef')
    expect(file.colors.size).toBe(THEME_TOKENS.length)
    expect(settings.theme).toBe('My brighter one')
    expect(host.files.read(themeFile('Mine'))).toBe(MINE)
  })

  it('copies the theme in force when none is named, and a built-in under the name given', async () => {
    await start()
    expect((await copyTheme(undefined, 'Night')).ok).toBe(true)
    expect(parsed('Night').theme.base).toBe('dark')
    expect((await copyTheme('sepia', 'Warm')).ok).toBe(true)
    expect(parsed('Warm').theme.base).toBe('sepia')
  })

  it.each([
    ['', 'Name the theme'],
    ['dark', 'built-in'],
    ['MINE', 'exists'],
    ['x'.repeat(61), '60'],
  ])('refuses %j with a reason and writes nothing', async (name, reason) => {
    await start(SELECT_MINE)
    const before = stems()
    const asked = editorScrollRequests.value
    const refused = await copyTheme('dark', name)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.why).toContain(reason)
    expect(stems()).toEqual(before)
    expect(settings.theme).toBe('Mine')
    expect(editorScrollRequests.value).toBe(asked)
  })
})
