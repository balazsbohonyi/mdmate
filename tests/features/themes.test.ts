// @vitest-environment jsdom
/**
 * The themes as the app lives with them (P8-T3): the four built-ins, System following the OS, user
 * theme files read as data and followed live (ISC-448, 449, 451, 452), Customize (ISC-453) and the
 * writes the color editor makes (ISC-454). The page runs on the mock host, whose `files` stand in
 * for the themes folder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  changeThemeColor,
  COLOR_QUIET_MS,
  customizeTheme,
  flushThemeColors,
  openThemesFolder,
} from '@/features/themes/customize'
import {
  applyCurrentTheme,
  currentTheme,
  loadThemes,
  resetThemesState,
  settledThemes,
  themeChoices,
  themeProblem,
  watchSystemAppearance,
  watchThemesFolder,
} from '@/features/themes/store'
import {
  changeSetting,
  loadSettings,
  resetSettingsState,
  settingsFileState,
} from '@/features/settings/store'
import { resetSettings, settings } from '@/lib/settings'
import { THEME_TOKENS } from '@/lib/themeTokens'
import { parseThemeText } from '@/lib/themeFile'
import { setHost } from '@/platform'
import {
  createMockHost,
  MOCK_SETTINGS_FILE,
  MOCK_THEMES_FOLDER,
  type MockHost,
} from '@/platform/mock'
import { toasts } from '../helpers/toasts'
import { parseJsonc } from '../helpers/jsonc'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const root = (): HTMLElement => document.documentElement
const themeFile = (name: string): string => `${MOCK_THEMES_FOLDER}/${name}.json`

let host: MockHost
const stops: (() => void)[] = []

async function start(files: Record<string, string> = {}): Promise<void> {
  host = createMockHost({ files })
  setHost(host)
  await loadSettings()
  await loadThemes()
}

/** A media query the test can flip, as the OS does when its appearance changes. */
function stubSystemAppearance(dark: boolean): { set(value: boolean): void } {
  let matches = dark
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return matches
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }))
  return {
    set(value) {
      matches = value
      for (const listener of listeners) listener()
    },
  }
}

beforeEach(() => {
  resetSettings()
  resetSettingsState()
  resetThemesState()
  root().className = 'dark'
  root().removeAttribute('style')
  root().dataset.theme = 'dark'
})

afterEach(() => {
  while (stops.length > 0) stops.pop()?.()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  setHost(undefined)
})

const savedSettings = (): unknown => {
  const text = host.files.read(MOCK_SETTINGS_FILE)
  return text === undefined ? undefined : parseJsonc(text)
}

describe('the built-in themes', () => {
  it('start on Dark with nothing in the folder and nothing said', async () => {
    await start()
    expect(root().dataset.theme).toBe('dark')
    expect(root().classList.contains('dark')).toBe(true)
    expect(themeProblem.value).toBeNull()
    expect(toasts.all).toEqual([])
  })

  it('show each palette, with the dark class only for Dark', async () => {
    await start()
    for (const [name, dark] of [
      ['light', false],
      ['sepia', false],
      ['dark', true],
    ] as const) {
      await changeSetting('theme', name)
      expect(root().dataset.theme, name).toBe(name)
      expect(root().classList.contains('dark'), name).toBe(dark)
    }
  })

  it('apply the saved theme at start, before anything else asks for it', async () => {
    await start({ [MOCK_SETTINGS_FILE]: '{ "theme": "sepia" }' })
    expect(root().dataset.theme).toBe('sepia')
    expect(root().classList.contains('dark')).toBe(false)
  })

  it('offer Dark, Light, Sepia and System, then the user themes by name', async () => {
    await start({
      [themeFile('zebra')]: '{ "colors": {} }',
      [themeFile('Apple')]: '{ "name": "Orchard", "colors": {} }',
    })
    expect(themeChoices.value.map((choice) => choice.label)).toEqual([
      'Dark',
      'Light',
      'Sepia',
      'System',
      'Orchard',
      'zebra',
    ])
  })
})

describe('System', () => {
  it('shows Dark or Light as the OS is, and follows it live', async () => {
    const media = stubSystemAppearance(true)
    await start({ [MOCK_SETTINGS_FILE]: '{ "theme": "system" }' })
    stops.push(watchSystemAppearance())
    applyCurrentTheme()
    expect(root().dataset.theme).toBe('dark')
    media.set(false)
    expect(root().dataset.theme).toBe('light')
    expect(root().classList.contains('dark')).toBe(false)
    media.set(true)
    expect(root().dataset.theme).toBe('dark')
    expect(root().classList.contains('dark')).toBe(true)
    expect(currentTheme.value.label).toBe('System')
  })

  it('does not follow the OS while another theme is chosen', async () => {
    const media = stubSystemAppearance(true)
    await start({ [MOCK_SETTINGS_FILE]: '{ "theme": "sepia" }' })
    stops.push(watchSystemAppearance())
    media.set(false)
    expect(root().dataset.theme).toBe('sepia')
  })

  it('stays on light where the environment has no media query', async () => {
    vi.stubGlobal('matchMedia', undefined)
    await start({ [MOCK_SETTINGS_FILE]: '{ "theme": "system" }' })
    stops.push(watchSystemAppearance())
    expect(root().dataset.theme).toBe('light')
  })
})

describe('ISC-448: a user theme file is data, and a bad one costs only itself', () => {
  it('puts the file’s colors on the root over its base palette', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
      [themeFile('mine')]:
        '{ "base": "light", "colors": { "background": "#123456", "primary": "oklch(0.5 0.1 250)" } }',
    })
    expect(root().dataset.theme).toBe('light')
    expect(root().classList.contains('dark')).toBe(false)
    expect(root().style.getPropertyValue('--background')).toBe('#123456')
    expect(root().style.getPropertyValue('--primary')).toBe('oklch(0.5 0.1 250)')
    expect(root().style.getPropertyValue('--foreground')).toBe('')
    expect(toasts.all).toEqual([])
  })

  it('drops a bad value, keeps the base color for it, and says which', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
      [themeFile('mine')]: '{ "colors": { "background": "url(x)", "foreground": "#eeeeee" } }',
    })
    expect(root().style.getPropertyValue('--background')).toBe('')
    expect(root().style.getPropertyValue('--foreground')).toBe('#eeeeee')
    expect(toasts.last).toContain('colors.background')
    expect(toasts.last).toContain('ignored')
    expect(toasts.lastLevel).toBe('warning')
  })

  it('shows Dark and names the line for a file that is not JSON; the app keeps going', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
      [themeFile('mine')]: '{\n  "colors": {\n    "background": #fff\n  }\n}',
    })
    expect(root().dataset.theme).toBe('dark')
    expect(root().style.getPropertyValue('--background')).toBe('')
    expect(toasts.last).toContain('mine')
    expect(toasts.last).toContain('line 3')
    expect(toasts.last).toContain('Showing Dark')
    expect(settings.theme).toBe('mine')
  })

  it.each(['[]', '"x"', ''])(
    'shows Dark for a file that holds %j and not an object',
    async (text) => {
      await start({ [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }', [themeFile('mine')]: text })
      expect(root().dataset.theme).toBe('dark')
      expect(toasts.last).toContain('mine')
    },
  )

  it('shows Dark with a notice for a name that has no file, and leaves the setting as written', async () => {
    const written = '{ "theme": "ghost" }'
    await start({ [MOCK_SETTINGS_FILE]: written })
    expect(root().dataset.theme).toBe('dark')
    expect(toasts.last).toContain('ghost')
    expect(themeProblem.value).toContain('ghost')
    expect(settings.theme).toBe('ghost')
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(written)
    expect(settingsFileState.broken).toBeNull()
  })

  it('does not call a name missing before the folder was read', async () => {
    host = createMockHost({ files: { [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }' } })
    setHost(host)
    await loadSettings()
    expect(toasts.all).toEqual([])
    expect(root().dataset.theme).toBe('dark')
  })

  it('says each notice once, not once per re-read', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: '{ "theme": "ghost" }',
    })
    stops.push(await watchThemesFolder())
    host.files.write(themeFile('other'), '{ "colors": {} }')
    await settle()
    await settle()
    expect(toasts.messages.filter((message) => message.includes('ghost'))).toHaveLength(1)
  })
})

describe('ISC-451: a file named like a built-in is ignored', () => {
  it('is not offered, not applied, and one notice says why; the built-in still works', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: '{ "theme": "dark" }',
      [themeFile('dark')]: '{ "colors": { "background": "#ff0000" } }',
      [themeFile('Light')]: '{ "colors": {} }',
      [themeFile('SEPIA')]: '{ "colors": {} }',
      [themeFile('system')]: '{ "colors": {} }',
    })
    expect(root().style.getPropertyValue('--background')).toBe('')
    expect(themeChoices.value.map((choice) => choice.value)).toEqual([
      'dark',
      'light',
      'sepia',
      'system',
    ])
    const notice = themeProblem.value ?? ''
    for (const name of ['dark.json', 'Light.json', 'SEPIA.json', 'system.json'])
      expect(notice).toContain(name)
    expect(toasts.all).toHaveLength(1)
  })
})

describe('ISC-452: the themes folder is followed while the app runs', () => {
  it('follows an edit, a new file and a deletion, and a selected file coming back', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
      [themeFile('mine')]: '{ "colors": { "background": "#111111" } }',
    })
    stops.push(await watchThemesFolder())
    expect(root().style.getPropertyValue('--background')).toBe('#111111')

    host.files.write(themeFile('mine'), '{ "colors": { "background": "#222222" } }')
    await settle()
    await settle()
    expect(root().style.getPropertyValue('--background')).toBe('#222222')

    host.files.write(themeFile('second'), '{ "name": "Second", "colors": {} }')
    await settle()
    await settle()
    expect(themeChoices.value.map((choice) => choice.label)).toContain('Second')

    host.files.delete(themeFile('mine'))
    await settle()
    await settle()
    expect(root().dataset.theme).toBe('dark')
    expect(root().style.getPropertyValue('--background')).toBe('')
    expect(themeProblem.value).toContain('mine')
    expect(settings.theme).toBe('mine')
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe('{ "theme": "mine" }')

    host.files.write(themeFile('mine'), '{ "colors": { "background": "#333333" } }')
    await settle()
    await settle()
    expect(root().style.getPropertyValue('--background')).toBe('#333333')
    expect(themeProblem.value).toBeNull()
  })

  it('does not apply a file in another folder', async () => {
    await start({ [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }' })
    stops.push(await watchThemesFolder())
    host.files.write('/mock-data/elsewhere/mine.json', '{ "colors": { "background": "#444444" } }')
    await settle()
    await settle()
    expect(root().style.getPropertyValue('--background')).toBe('')
  })
})

describe('ISC-453: Customize', () => {
  const NAMES = new Set(THEME_TOKENS.map((token) => token.name))

  function made(name: string): ReturnType<typeof parseThemeText> {
    return parseThemeText(host.files.read(themeFile(name)) ?? '')
  }

  it('copies Dark into "Dark copy", selects it, and writes a literal color for every token', async () => {
    await start()
    const before = new Set(host.files.paths())
    expect(await customizeTheme()).toBe('Dark copy')
    expect(settings.theme).toBe('Dark copy')
    expect(savedSettings()).toEqual({ theme: 'Dark copy' })
    const parsed = made('Dark copy')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.theme.base).toBe('dark')
    expect(new Set(parsed.theme.colors.keys())).toEqual(NAMES)
    expect(parsed.theme.problems).toEqual([])
    const added = host.files.paths().filter((path) => !before.has(path))
    expect(added.filter((path) => !path.endsWith('settings.json'))).toEqual([
      themeFile('Dark copy'),
    ])
    expect(currentTheme.value.user?.id).toBe('Dark copy')
    expect(root().dataset.theme).toBe('dark')
  })

  it('copies Sepia as Sepia, and the next copy of the same theme is "copy 2"', async () => {
    await start({ [MOCK_SETTINGS_FILE]: '{ "theme": "sepia" }' })
    expect(await customizeTheme()).toBe('Sepia copy')
    const sepia = made('Sepia copy')
    expect(sepia.ok && sepia.theme.base).toBe('sepia')
    expect(sepia.ok && sepia.theme.colors.get('background')).toBe('#fdf6e3')
    await changeSetting('theme', 'sepia')
    expect(await customizeTheme()).toBe('Sepia copy 2')
    await changeSetting('theme', 'sepia')
    expect(await customizeTheme()).toBe('Sepia copy 3')
  })

  it('copies what System shows now: Dark while the OS is dark, Light when it is light', async () => {
    const media = stubSystemAppearance(true)
    await start({ [MOCK_SETTINGS_FILE]: '{ "theme": "system" }' })
    stops.push(watchSystemAppearance())
    applyCurrentTheme()
    expect(await customizeTheme()).toBe('System copy')
    const dark = made('System copy')
    expect(dark.ok && dark.theme.base).toBe('dark')
    await changeSetting('theme', 'system')
    media.set(false)
    expect(await customizeTheme()).toBe('System copy 2')
    const light = made('System copy 2')
    expect(light.ok && light.theme.base).toBe('light')
    expect(light.ok && light.theme.colors.get('background')).not.toBe(
      dark.ok ? dark.theme.colors.get('background') : undefined,
    )
  })

  it('duplicates a user theme with its own colors', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
      [themeFile('mine')]:
        '{ "name": "Mine", "base": "light", "colors": { "background": "#abcdef" } }',
    })
    expect(await customizeTheme()).toBe('Mine copy')
    const copy = made('Mine copy')
    expect(copy.ok && copy.theme.name).toBe('Mine copy')
    expect(copy.ok && copy.theme.base).toBe('light')
    expect(copy.ok && copy.theme.colors.get('background')).toBe('#abcdef')
    expect(copy.ok && copy.theme.colors.size).toBe(THEME_TOKENS.length)
  })

  it('never replaces a file: a name taken in any case moves to the next', async () => {
    const taken = '{ "colors": { "background": "#010101" } }'
    await start({ [themeFile('dark COPY')]: taken })
    expect(await customizeTheme()).toBe('Dark copy 2')
    expect(host.files.read(themeFile('dark COPY'))).toBe(taken)
  })

  it('moves on when a file with the name appears after the folder was read', async () => {
    await start()
    host.files.write(themeFile('Dark copy'), '{ "colors": {} }')
    expect(await customizeTheme()).toBe('Dark copy 2')
    expect(host.files.read(themeFile('Dark copy'))).toBe('{ "colors": {} }')
  })

  it('leaves the built-in CSS and every other file alone, and says so when the write fails', async () => {
    await start()
    host.themeWrite = () => Promise.reject(new Error('disk full'))
    expect(await customizeTheme()).toBeNull()
    expect(toasts.last).toContain('disk full')
    expect(settings.theme).toBe('dark')
    expect(host.files.paths().filter((path) => path.includes('/themes/'))).toEqual([])
  })
})

describe('ISC-454: writing colors', () => {
  const FILE = `{
  // my theme
  "base": "dark",
  "future": true,
  "colors": {
    "background": "#101010"
  }
}
`
  async function startWithMine(): Promise<void> {
    await start({ [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }', [themeFile('mine')]: FILE })
    stops.push(await watchThemesFolder())
  }

  it('shows a change at once and writes only that token a moment later', async () => {
    vi.useFakeTimers()
    await startWithMine()
    const pending = changeThemeColor('foreground', '#fafafa')
    expect(root().style.getPropertyValue('--foreground')).toBe('#fafafa')
    expect(host.files.read(themeFile('mine'))).toBe(FILE)
    await vi.advanceTimersByTimeAsync(COLOR_QUIET_MS + 10)
    await pending
    const text = host.files.read(themeFile('mine')) ?? ''
    expect(text).toContain('// my theme')
    expect(parseJsonc(text)).toEqual({
      base: 'dark',
      future: true,
      colors: { background: '#101010', foreground: '#fafafa' },
    })
  })

  it('writes a drag of 40 inputs as one write holding the last value', async () => {
    vi.useFakeTimers()
    await startWithMine()
    const write = vi.spyOn(host, 'themeWrite')
    for (let step = 0; step < 40; step++) {
      void changeThemeColor('primary', `#${(step + 16).toString(16)}0000`)
      await vi.advanceTimersByTimeAsync(5)
    }
    await vi.advanceTimersByTimeAsync(COLOR_QUIET_MS + 10)
    await settledThemes()
    expect(write.mock.calls.length).toBeLessThanOrEqual(2)
    expect(
      (parseJsonc(host.files.read(themeFile('mine')) ?? '') as { colors: { primary: string } })
        .colors.primary,
    ).toBe('#370000')
  })

  it('writes at once for a value typed and accepted', async () => {
    await startWithMine()
    expect(await changeThemeColor('primary', '#336699', true)).toBe(true)
    expect(host.files.read(themeFile('mine'))).toContain('"primary": "#336699"')
  })

  it('reads the file fresh, so a hand edit made a moment ago survives the write', async () => {
    await startWithMine()
    host.files.write(
      themeFile('mine'),
      FILE.replace('"future": true', '"future": "edited by hand"'),
    )
    await changeThemeColor('primary', '#336699', true)
    const text = host.files.read(themeFile('mine')) ?? ''
    expect(text).toContain('"future": "edited by hand"')
    expect(text).toContain('#336699')
  })

  it('refuses to write over a file that is not valid JSON, and leaves it as it is', async () => {
    await startWithMine()
    const broken = '{ "colors": { "background": #fff } }'
    host.files.write(themeFile('mine'), broken)
    await settle()
    await settle()
    // The theme fell back to Dark; a write for it is refused all the same.
    const { writeThemeColors } = await import('@/features/themes/customize')
    expect(await writeThemeColors('mine', new Map([['primary', '#336699']]))).toBe(false)
    expect(host.files.read(themeFile('mine'))).toBe(broken)
    expect(toasts.lastLevel).toBe('error')
    expect(toasts.last).toContain('not valid JSON')
  })

  it('does nothing for a built-in theme, which is never written', async () => {
    await start()
    expect(await changeThemeColor('primary', '#336699', true)).toBe(false)
    expect(host.files.paths().filter((path) => path.includes('/themes/'))).toEqual([])
    expect(root().style.getPropertyValue('--primary')).toBe('')
  })

  it('does not show or write a value that is not a color', async () => {
    await startWithMine()
    await changeThemeColor('primary', 'url(x)', true)
    expect(root().style.getPropertyValue('--primary')).toBe('')
    expect(host.files.read(themeFile('mine'))).toBe(FILE)
  })

  it('does not take its own write for someone else’s edit', async () => {
    await startWithMine()
    const toastsBefore = toasts.all.length
    await changeThemeColor('primary', '#336699', true)
    await settle()
    await settle()
    expect(toasts.all).toHaveLength(toastsBefore)
    expect(root().style.getPropertyValue('--primary')).toBe('#336699')
  })

  it('does not roll a color the user has moved on from back to the file’s older one', async () => {
    await startWithMine()
    const first = changeThemeColor('primary', '#111111', true)
    // The picker is dragged on while the first write is still being heard about.
    void changeThemeColor('primary', '#222222')
    await first
    await settle()
    await settle()
    expect(root().style.getPropertyValue('--primary')).toBe('#222222')
    await flushThemeColors()
    await settledThemes()
    expect(host.files.read(themeFile('mine'))).toContain('#222222')
  })

  it('writes what is waiting when asked to, and has nothing to write otherwise', async () => {
    await startWithMine()
    expect(await flushThemeColors()).toBe(true)
    void changeThemeColor('primary', '#336699')
    expect(await flushThemeColors()).toBe(true)
    expect(host.files.read(themeFile('mine'))).toContain('#336699')
  })
})

describe('ISC-457: Open themes folder', () => {
  it('makes the folder when it is missing and shows it', async () => {
    await start()
    expect(host.files.isFolder(MOCK_THEMES_FOLDER)).toBe(false)
    await openThemesFolder()
    expect(host.files.isFolder(MOCK_THEMES_FOLDER)).toBe(true)
    expect(host.openedFolders).toEqual([MOCK_THEMES_FOLDER])
  })

  it('says so when it cannot', async () => {
    await start()
    host.themesFolderOpen = () => Promise.reject(new Error('no file manager'))
    await openThemesFolder()
    expect(toasts.last).toContain('no file manager')
  })
})

describe('the themes folder on the mock host, as Rust holds it', () => {
  it('refuses a name that is not a plain one', async () => {
    await start()
    await expect(host.themeWrite('..\\x', '{}', true)).rejects.toMatchObject({ kind: 'invalid' })
    await expect(host.themeRead('a/b')).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('never replaces on create, and never makes on write', async () => {
    await start({ [themeFile('a')]: '{}' })
    await expect(host.themeWrite('a', '{"x":1}', true)).rejects.toMatchObject({ kind: 'exists' })
    await expect(host.themeWrite('b', '{}', false)).rejects.toMatchObject({ kind: 'not-found' })
    expect(host.files.read(themeFile('a'))).toBe('{}')
  })
})
