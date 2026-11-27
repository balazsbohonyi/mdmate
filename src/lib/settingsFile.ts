import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser'
import { FONT_DENSITIES, type FontDensity, type FontPresetId } from './fontPresets'
import {
  BUILT_IN_EXCLUDED_FOLDERS,
  BUILT_IN_HIDDEN_NAMES,
  cloneSettings,
  COLOR_FORMATS,
  type ColorFormat,
  DEFAULT_SETTINGS,
  LINKS_ON_RENAME,
  type LinksOnRename,
  type Settings,
} from './settings'
import { ZOOM_MAX, ZOOM_MIN } from './zoom'

/**
 * `settings.json`: the keys, their defaults, and the one validator every value passes through.
 * The file is untrusted until it passes, so everything enters as `unknown`. A key that is not here
 * is left alone: it stays in the file and is never read.
 */

/** The result of checking one value. */
export type Checked<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string }

/** Every key a setting has, spelled as the file's keys joined by dots. */
export interface SettingValueMap {
  theme: string
  'fonts.preset': FontPresetId
  'fonts.density': FontDensity
  'fonts.heading': string
  'fonts.body': string
  'fonts.code': string
  'fonts.size': number | null
  'fonts.codeSize': number | null
  'fonts.lineHeight': number | null
  'fonts.codeLineHeight': number | null
  'fonts.headingScale': readonly number[] | null
  'editor.wordWrap': boolean
  'editor.lineNumbers': boolean
  'editor.stripedTables': boolean
  'editor.stickyHeadings': boolean
  'editor.limitContentWidth': boolean
  'editor.contentMaxWidth': number
  'editor.highlightExtensions': readonly string[]
  'images.pasteFolder': string
  'links.onRename': LinksOnRename
  'files.largeFileMB': number
  'recent.files': number
  'recent.folders': number
  'workspace.excludedFolders': readonly string[]
  'workspace.hiddenNames': readonly string[]
  'git.enabled': boolean
  'git.path': string
  'themes.hideContrastWarnings': boolean
  'themes.colorFormat': ColorFormat
  'view.zoom': number
  devtools: boolean
}

export type SettingKey = keyof SettingValueMap

export interface SettingDef<T> {
  readonly key: SettingKey
  /** The keys that lead to it inside the file: `['fonts', 'size']`. */
  readonly path: readonly string[]
  readonly default: T
  /** Checks a value from outside. A bad value says why, in a short sentence for the row. */
  readonly check: (value: unknown) => Checked<T>
  /** Whether two values are the same setting; a value equal to the default has no key in the file. */
  readonly equals: (a: T, b: T) => boolean
}

const good = <T>(value: T): Checked<T> => ({ ok: true, value })
const bad = (why: string): Checked<never> => ({ ok: false, why })

function numberIn(min: number, max: number, whole: boolean): (value: unknown) => Checked<number> {
  return (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return bad('Use a number.')
    if (whole && !Number.isInteger(value)) return bad('Use a whole number.')
    if (value < min || value > max)
      return bad(`Use a number from ${String(min)} to ${String(max)}.`)
    return good(value)
  }
}

/** The line heights: a unitless multiple from 1 to 3, in steps of 0.05 (1.45 yes, 1.42 no). */
export const LINE_HEIGHT_MIN = 1
export const LINE_HEIGHT_MAX = 3
export const LINE_HEIGHT_STEP = 0.05

function checkLineHeight(value: unknown): Checked<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return bad('Use a number.')
  // Steps are counted from the minimum and compared with a little slack, since 1.45 is not exact.
  const steps = (value - LINE_HEIGHT_MIN) / LINE_HEIGHT_STEP
  const onStep = Math.abs(steps - Math.round(steps)) < 1e-9
  if (value < LINE_HEIGHT_MIN || value > LINE_HEIGHT_MAX || !onStep) {
    return bad(
      `Use a number from ${String(LINE_HEIGHT_MIN)} to ${String(LINE_HEIGHT_MAX)} in steps of ${String(LINE_HEIGHT_STEP)}.`,
    )
  }
  return good(value)
}

const isBoolean = (value: unknown): Checked<boolean> =>
  typeof value === 'boolean' ? good(value) : bad('Use true or false.')

/** A control character, or a character that would end a CSS value: never part of a font stack. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const FAMILY_FORBIDDEN = /[\u0000-\u001f\u007f{};<>\\]/u

function checkFontPreset(value: unknown): Checked<FontPresetId> {
  if (typeof value !== 'string') return bad('Use a font preset name in quotes.')
  const text = value.trim()
  if (text === '') return bad('Name a font preset.')
  if (text.length > 100) return bad('Use at most 100 characters.')
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[/\\\u0000-\u001f\u007f]/u.test(text)) return bad('Use a font preset name, not a path.')
  return good(text)
}

function checkFontDensity(value: unknown): Checked<FontDensity> {
  const found = FONT_DENSITIES.find((density) => density === value)
  return found === undefined ? bad('Use "comfort" or "compact".') : good(found)
}

/** Wraps a validator so `null` passes as "inherit from the active preset". */
function nullable<T>(check: (value: unknown) => Checked<T>): (value: unknown) => Checked<T | null> {
  return (value) => (value === null ? good(null) : check(value))
}

/** An empty family is the preset default stack. What is written is a family name or a CSS family list. */
function checkFamily(value: unknown): Checked<string> {
  if (typeof value !== 'string') return bad('Use a font name in quotes.')
  const text = value.trim()
  if (text.length > 200) return bad('Use at most 200 characters.')
  if (FAMILY_FORBIDDEN.test(text)) return bad('A font name cannot hold ; { } < > or a backslash.')
  return good(text)
}

/** Names Windows keeps for devices, with or without an extension. */
export function reservedName(part: string): boolean {
  const base = (part.split('.')[0] ?? '').trimEnd().toUpperCase()
  return ['CON', 'PRN', 'AUX', 'NUL'].includes(base) || /^(?:COM|LPT)[1-9]$/.test(base)
}

/**
 * A folder name or relative path under the document's folder: never absolute, never leaving it,
 * and spelled so that it is a real folder name on every system. Rust checks the same rules again
 * before it writes anything (`settings::clean_paste_folder`).
 */
export function checkPasteFolder(value: unknown): Checked<string> {
  if (typeof value !== 'string') return bad('Use a folder name in quotes.')
  const text = value.trim().replaceAll('\\', '/')
  if (text === '') return bad('Name a folder.')
  if ([...text].length > 100) return bad('Use at most 100 characters.')
  if (/^(?:[a-z]:|\/|~)/i.test(text))
    return bad('Use a folder inside the document’s folder, not a full path.')
  const parts = text.split('/')
  for (const part of parts) {
    if (part === '') return bad('Leave out empty parts such as // or a trailing /.')
    if (part === '..') return bad('The folder cannot leave the document’s folder.')
    if (part === '.') return bad('Leave out . parts.')
    // The link made from the folder is plain Markdown, so a space or a bracket has no place in it.
    if (!/^[\p{Alphabetic}\p{N}_.-]+$/u.test(part))
      return bad('Use letters, digits, - _ and . only, so the link stays plain.')
    if (part.endsWith('.')) return bad('A folder name cannot end with a dot.')
    if (reservedName(part)) return bad(`${part} is a name Windows keeps.`)
  }
  return good(parts.join('/'))
}

function checkLinksOnRename(value: unknown): Checked<LinksOnRename> {
  const found = LINKS_ON_RENAME.find((mode) => mode === value)
  return found === undefined ? bad('Use "ask", "update" or "never".') : good(found)
}

function checkColorFormat(value: unknown): Checked<ColorFormat> {
  const found = COLOR_FORMATS.find((format) => format === value)
  return found === undefined ? bad('Use "hex" or "oklch".') : good(found)
}

function checkHeadingScale(value: unknown): Checked<readonly number[]> {
  if (!Array.isArray(value) || value.length !== 6)
    return bad('Use six numbers, one for each heading level.')
  const scale: number[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0.5 || item > 4) {
      return bad('Each number must be from 0.5 to 4.')
    }
    scale.push(item)
  }
  return good(scale)
}

/** The most folder names the list holds, and the longest one. */
export const MAX_EXCLUDED_FOLDERS = 200
const MAX_FOLDER_NAME = 100

/** One name for a list of names: a name, not a path. `noun` is what the messages call it. */
function checkNameIn(value: unknown, noun: string): Checked<string> {
  if (typeof value !== 'string') return bad(`Use ${noun}s in quotes.`)
  const text = value.trim()
  if (text === '') return bad(`A ${noun} cannot be empty.`)
  if (text.length > MAX_FOLDER_NAME)
    return bad(`Use at most ${String(MAX_FOLDER_NAME)} characters.`)
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[/\\\u0000-\u001f\u007f]/u.test(text)) return bad(`Use a ${noun}, not a path.`)
  // These two name a place, not an entry: no directory entry is called either, so they match nothing.
  if (text === '.' || text === '..') return bad(`Use a ${noun}, not a path.`)
  return good(text)
}

/** One folder name for the exclusion list: a name, not a path. */
export function checkFolderName(value: unknown): Checked<string> {
  return checkNameIn(value, 'folder name')
}

function checkExcludedFolders(value: unknown): Checked<readonly string[]> {
  if (!Array.isArray(value)) return bad('Use a list of folder names.')
  if (value.length > MAX_EXCLUDED_FOLDERS)
    return bad(`Use at most ${String(MAX_EXCLUDED_FOLDERS)} names.`)
  const names: string[] = []
  const seen = new Set<string>()
  for (const item of value as unknown[]) {
    const checked = checkFolderName(item)
    if (!checked.ok) return checked
    // Two spellings of one name are one name, as the index compares them.
    const key = checked.value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(checked.value)
  }
  return good(names)
}

/** The most names the hidden-names list holds. A name is as long as a folder name may be. */
export const MAX_HIDDEN_NAMES = 200

/**
 * The names the tree hides: a list of file and folder names, not paths. A blank is dropped without
 * a word, as is a second spelling of a name the list already has (the tree compares without regard
 * to case); a path, `.`, `..`, a name that is not text or a value that is not a list is refused.
 */
function checkHiddenNames(value: unknown): Checked<readonly string[]> {
  if (!Array.isArray(value)) return bad('Use a list of names.')
  const names: string[] = []
  const seen = new Set<string>()
  for (const item of value as unknown[]) {
    if (typeof item === 'string' && item.trim() === '') continue
    const checked = checkNameIn(item, 'name')
    if (!checked.ok) return checked
    const key = checked.value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(checked.value)
  }
  if (names.length > MAX_HIDDEN_NAMES) return bad(`Use at most ${String(MAX_HIDDEN_NAMES)} names.`)
  return good(names)
}

/** The longest git path taken. */
const MAX_GIT_PATH = 500

/**
 * The full path of the git program, or empty for "find it". It must be absolute, and never a
 * network path (using one makes Windows contact that host): a drive letter with a slash, or a
 * slash. Rust applies the same rule (`settings/runtime.rs`, `clean_git_path`); the shared cases are
 * in `tests/data/git-paths.json`.
 */
function checkGitPath(value: unknown): Checked<string> {
  if (typeof value !== 'string') return bad('Use the full path of the git program in quotes.')
  const text = value.trim()
  if (text === '') return good('')
  if (text.length > MAX_GIT_PATH) return bad(`Use at most ${String(MAX_GIT_PATH)} characters.`)
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[\u0000-\u001f\u007f]/u.test(text)) return bad('Use the full path of the git program.')
  const drive = /^[A-Za-z]:[\\/]/u.test(text)
  const rooted = text.startsWith('/') && !text.startsWith('//')
  if (!drive && !rooted)
    return bad(
      'Use the full path, such as C:\\Program Files\\Git\\cmd\\git.exe, or leave it empty.',
    )
  return good(text)
}

/** The most extensions the highlight list holds, and the longest one. */
export const MAX_HIGHLIGHT_EXTENSIONS = 200
const MAX_EXTENSION = 20

/** One file extension for the highlight list: letters and digits, in lower case, no dot (`.RS` is `rs`). */
export function checkExtension(value: unknown): Checked<string> {
  if (typeof value !== 'string') return bad('Use file extensions in quotes.')
  const text = value.trim().replace(/^\./, '').toLowerCase()
  if (text === '') return bad('An extension cannot be empty.')
  if (text.length > MAX_EXTENSION) return bad(`Use at most ${String(MAX_EXTENSION)} characters.`)
  if (!/^[a-z0-9][a-z0-9_+-]*$/.test(text)) return bad('Use an extension such as ts or rs.')
  return good(text)
}

function checkHighlightExtensions(value: unknown): Checked<readonly string[]> {
  if (!Array.isArray(value)) return bad('Use a list of file extensions.')
  if (value.length > MAX_HIGHLIGHT_EXTENSIONS)
    return bad(`Use at most ${String(MAX_HIGHLIGHT_EXTENSIONS)} extensions.`)
  const found: string[] = []
  const seen = new Set<string>()
  for (const item of value as unknown[]) {
    const checked = checkExtension(item)
    if (!checked.ok) return checked
    if (seen.has(checked.value)) continue
    seen.add(checked.value)
    found.push(checked.value)
  }
  return good(found)
}

function checkTheme(value: unknown): Checked<string> {
  if (typeof value !== 'string') return bad('Use a theme name in quotes.')
  const text = value.trim()
  if (text === '') return bad('Name a theme.')
  if (text.length > 100) return bad('Use at most 100 characters.')
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[/\\\u0000-\u001f\u007f]/u.test(text)) return bad('Use a theme name, not a path.')
  return good(text)
}

const same = <T>(a: T, b: T): boolean => a === b
const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((item, i) => item === b[i])
const sameNullableList = <T>(a: readonly T[] | null, b: readonly T[] | null): boolean =>
  a === b || (a !== null && b !== null && sameList(a, b))

/** The one table: every key, where it sits in the file, its default and how it is checked. */
export const SETTING_DEFS: { readonly [K in SettingKey]: SettingDef<SettingValueMap[K]> } = {
  theme: {
    key: 'theme',
    path: ['theme'],
    default: DEFAULT_SETTINGS.theme,
    check: checkTheme,
    equals: same,
  },
  'fonts.preset': {
    key: 'fonts.preset',
    path: ['fonts', 'preset'],
    default: DEFAULT_SETTINGS.fonts.preset,
    check: checkFontPreset,
    equals: same,
  },
  'fonts.density': {
    key: 'fonts.density',
    path: ['fonts', 'density'],
    default: DEFAULT_SETTINGS.fonts.density,
    check: checkFontDensity,
    equals: same,
  },
  'fonts.heading': {
    key: 'fonts.heading',
    path: ['fonts', 'heading'],
    default: DEFAULT_SETTINGS.fonts.heading,
    check: checkFamily,
    equals: same,
  },
  'fonts.body': {
    key: 'fonts.body',
    path: ['fonts', 'body'],
    default: DEFAULT_SETTINGS.fonts.body,
    check: checkFamily,
    equals: same,
  },
  'fonts.code': {
    key: 'fonts.code',
    path: ['fonts', 'code'],
    default: DEFAULT_SETTINGS.fonts.code,
    check: checkFamily,
    equals: same,
  },
  'fonts.size': {
    key: 'fonts.size',
    path: ['fonts', 'size'],
    default: DEFAULT_SETTINGS.fonts.size,
    check: nullable(numberIn(8, 40, false)),
    equals: same,
  },
  'fonts.codeSize': {
    key: 'fonts.codeSize',
    path: ['fonts', 'codeSize'],
    default: DEFAULT_SETTINGS.fonts.codeSize,
    check: nullable(numberIn(8, 40, false)),
    equals: same,
  },
  'fonts.lineHeight': {
    key: 'fonts.lineHeight',
    path: ['fonts', 'lineHeight'],
    default: DEFAULT_SETTINGS.fonts.lineHeight,
    check: nullable(checkLineHeight),
    equals: same,
  },
  'fonts.codeLineHeight': {
    key: 'fonts.codeLineHeight',
    path: ['fonts', 'codeLineHeight'],
    default: DEFAULT_SETTINGS.fonts.codeLineHeight,
    check: nullable(checkLineHeight),
    equals: same,
  },
  'fonts.headingScale': {
    key: 'fonts.headingScale',
    path: ['fonts', 'headingScale'],
    default: DEFAULT_SETTINGS.fonts.headingScale,
    check: nullable(checkHeadingScale),
    equals: sameNullableList,
  },
  'editor.wordWrap': {
    key: 'editor.wordWrap',
    path: ['editor', 'wordWrap'],
    default: DEFAULT_SETTINGS.editor.wordWrap,
    check: isBoolean,
    equals: same,
  },
  'editor.lineNumbers': {
    key: 'editor.lineNumbers',
    path: ['editor', 'lineNumbers'],
    default: DEFAULT_SETTINGS.editor.lineNumbers,
    check: isBoolean,
    equals: same,
  },
  'editor.stripedTables': {
    key: 'editor.stripedTables',
    path: ['editor', 'stripedTables'],
    default: DEFAULT_SETTINGS.editor.stripedTables,
    check: isBoolean,
    equals: same,
  },
  'editor.stickyHeadings': {
    key: 'editor.stickyHeadings',
    path: ['editor', 'stickyHeadings'],
    default: DEFAULT_SETTINGS.editor.stickyHeadings,
    check: isBoolean,
    equals: same,
  },
  'editor.limitContentWidth': {
    key: 'editor.limitContentWidth',
    path: ['editor', 'limitContentWidth'],
    default: DEFAULT_SETTINGS.editor.limitContentWidth,
    check: isBoolean,
    equals: same,
  },
  'editor.contentMaxWidth': {
    key: 'editor.contentMaxWidth',
    path: ['editor', 'contentMaxWidth'],
    default: DEFAULT_SETTINGS.editor.contentMaxWidth,
    check: numberIn(300, 4000, true),
    equals: same,
  },
  'editor.highlightExtensions': {
    key: 'editor.highlightExtensions',
    path: ['editor', 'highlightExtensions'],
    default: DEFAULT_SETTINGS.editor.highlightExtensions,
    check: checkHighlightExtensions,
    // The list is a set of extensions: order and repeats do not change what is colored.
    equals: (a, b) => sameList([...a].sort(), [...b].sort()),
  },
  'images.pasteFolder': {
    key: 'images.pasteFolder',
    path: ['images', 'pasteFolder'],
    default: DEFAULT_SETTINGS.images.pasteFolder,
    check: checkPasteFolder,
    equals: same,
  },
  'links.onRename': {
    key: 'links.onRename',
    path: ['links', 'onRename'],
    default: DEFAULT_SETTINGS.links.onRename,
    check: checkLinksOnRename,
    equals: same,
  },
  'files.largeFileMB': {
    key: 'files.largeFileMB',
    path: ['files', 'largeFileMB'],
    default: DEFAULT_SETTINGS.files.largeFileMB,
    check: numberIn(1, 1024, false),
    equals: same,
  },
  'recent.files': {
    key: 'recent.files',
    path: ['recent', 'files'],
    default: DEFAULT_SETTINGS.recent.files,
    check: numberIn(0, 50, true),
    equals: same,
  },
  'recent.folders': {
    key: 'recent.folders',
    path: ['recent', 'folders'],
    default: DEFAULT_SETTINGS.recent.folders,
    check: numberIn(0, 50, true),
    equals: same,
  },
  'workspace.excludedFolders': {
    key: 'workspace.excludedFolders',
    path: ['workspace', 'excludedFolders'],
    default: BUILT_IN_EXCLUDED_FOLDERS,
    check: checkExcludedFolders,
    // Case and order are part of a list the user wrote, but the index treats the names as a set.
    equals: (a, b) => sameList([...a].sort(), [...b].sort()),
  },
  'workspace.hiddenNames': {
    key: 'workspace.hiddenNames',
    path: ['workspace', 'hiddenNames'],
    default: BUILT_IN_HIDDEN_NAMES,
    check: checkHiddenNames,
    // The tree compares names without regard to case and ignores the order they are written in.
    equals: (a, b) =>
      sameList(
        a.map((name) => name.toLowerCase()).sort(),
        b.map((name) => name.toLowerCase()).sort(),
      ),
  },
  'git.enabled': {
    key: 'git.enabled',
    path: ['git', 'enabled'],
    default: DEFAULT_SETTINGS.git.enabled,
    check: isBoolean,
    equals: same,
  },
  'git.path': {
    key: 'git.path',
    path: ['git', 'path'],
    default: DEFAULT_SETTINGS.git.path,
    check: checkGitPath,
    equals: same,
  },
  'themes.hideContrastWarnings': {
    key: 'themes.hideContrastWarnings',
    path: ['themes', 'hideContrastWarnings'],
    default: DEFAULT_SETTINGS.themes.hideContrastWarnings,
    check: isBoolean,
    equals: same,
  },
  'themes.colorFormat': {
    key: 'themes.colorFormat',
    path: ['themes', 'colorFormat'],
    default: DEFAULT_SETTINGS.themes.colorFormat,
    check: checkColorFormat,
    equals: same,
  },
  'view.zoom': {
    key: 'view.zoom',
    path: ['view', 'zoom'],
    default: DEFAULT_SETTINGS.view.zoom,
    check: numberIn(ZOOM_MIN, ZOOM_MAX, true),
    equals: same,
  },
  devtools: {
    key: 'devtools',
    path: ['devtools'],
    default: DEFAULT_SETTINGS.devtools,
    check: isBoolean,
    equals: same,
  },
}

export const SETTING_KEYS = Object.keys(SETTING_DEFS) as SettingKey[]

/** A value of the given key, whatever its type, for code that walks every key. */
export function settingDef<K extends SettingKey>(key: K): SettingDef<SettingValueMap[K]> {
  return SETTING_DEFS[key]
}

/** Reads the value at `path` of a settings object. */
export function getSettingFrom<K extends SettingKey>(
  from: Readonly<Settings>,
  key: K,
): SettingValueMap[K] {
  let at: unknown = from
  for (const step of SETTING_DEFS[key].path) at = (at as Record<string, unknown>)[step]
  return at as SettingValueMap[K]
}

/** Puts a value at the path of its key in a settings object. */
export function putSettingIn<K extends SettingKey>(
  into: Settings,
  key: K,
  value: SettingValueMap[K],
): void {
  const path = SETTING_DEFS[key].path
  let at = into as unknown as Record<string, unknown>
  for (const step of path.slice(0, -1)) at = at[step] as Record<string, unknown>
  const last = path[path.length - 1]
  if (last !== undefined) at[last] = Array.isArray(value) ? [...(value as unknown[])] : value
}

/** What is wrong with the file, or with one key of it. */
export interface SettingsProblem {
  /** The key it is about, or `null` for a problem with the file as a whole. */
  readonly key: SettingKey | null
  /** The group that is not an object, such as `fonts`, when that is the problem. */
  readonly group?: string
  readonly message: string
}

/** A line and column in the file, 1-based, when the engine's message gave them. */
export interface SyntaxSpot {
  readonly line: number | null
  readonly column: number | null
}

export type ParsedSettings =
  | {
      readonly ok: true
      /** One entry per key the file holds, valid or not. */
      readonly present: ReadonlyMap<SettingKey, Checked<unknown>>
      readonly problems: readonly SettingsProblem[]
    }
  | { readonly ok: false; readonly message: string; readonly spot: SyntaxSpot }

/** The line and column of a character position in the text, 1-based. */
export function spotAt(offset: number, text: string): SyntaxSpot {
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  return { line, column: offset - (before.lastIndexOf('\n') + 1) + 1 }
}

/** What reading the text of one of the JSON files gave. */
export type ParsedObject =
  | {
      readonly kind: 'ok'
      readonly root: Record<string, unknown>
      /** False for text of only comments: no object at all, which counts as an empty one. */
      readonly hasValue: boolean
    }
  | { readonly kind: 'syntax'; readonly spot: SyntaxSpot }
  | { readonly kind: 'not-object' }

/**
 * Reads the text of `settings.json` or `keybindings.json`: JSON with comments (`//` and block
 * comments) and trailing commas. Text of only comments is an empty object. Anything that is not one
 * object, or that has a syntax error, says where it stopped making sense.
 */
export function parseObject(source: string): ParsedObject {
  const errors: ParseError[] = []
  const value: unknown = parse(source, errors, { allowTrailingComma: true })
  const first = errors[0]
  if (first !== undefined) {
    const onlyComments =
      value === undefined &&
      errors.length === 1 &&
      printParseErrorCode(first.error) === 'ValueExpected' &&
      source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').trim() === ''
    if (onlyComments) return { kind: 'ok', root: {}, hasValue: false }
    return { kind: 'syntax', spot: spotAt(first.offset, source) }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'not-object' }
  }
  return { kind: 'ok', root: value as Record<string, unknown>, hasValue: true }
}

/** The text without a leading byte order mark, which Notepad adds. */
export function stripBom(text: string): string {
  return text.startsWith('﻿') ? text.slice(1) : text
}

/**
 * Parses the text of `settings.json` and checks every key it holds. A file that is not one JSON
 * object is `ok: false` and nothing in it is used; comments and trailing commas are fine. Otherwise
 * each known key is checked on its own: a bad one is a problem for its row and the rest still count.
 * Empty text is an empty object.
 */
export function parseSettingsText(text: string): ParsedSettings {
  const source = stripBom(text)
  if (source.trim() === '') return { ok: true, present: new Map(), problems: [] }
  const parsed = parseObject(source)
  if (parsed.kind === 'syntax') {
    return { ok: false, message: 'settings.json is not valid JSON.', spot: parsed.spot }
  }
  if (parsed.kind === 'not-object') {
    return {
      ok: false,
      message: 'settings.json must hold one JSON object, { ... }.',
      spot: { line: null, column: null },
    }
  }
  return checkObject(parsed.root)
}

/** The checking half of `parseSettingsText`, for an object that is already parsed. */
export function checkObject(root: Record<string, unknown>): ParsedSettings {
  const present = new Map<SettingKey, Checked<unknown>>()
  const problems: SettingsProblem[] = []
  const groupsGone = new Set<string>()
  for (const key of SETTING_KEYS) {
    const path = SETTING_DEFS[key].path
    let at: unknown = root
    let held = true
    for (const [index, step] of path.entries()) {
      if (typeof at !== 'object' || at === null || Array.isArray(at)) {
        // The group in front of this key is not an object. Every key under it is then unusable, and
        // the file says so once, at the group.
        const group = path.slice(0, index).join('.')
        if (!groupsGone.has(group)) {
          groupsGone.add(group)
          problems.push({ key: null, group, message: `"${group}" must be an object, { ... }.` })
        }
        present.set(key, { ok: false, why: `"${group}" must be an object, { ... }.` })
        held = false
        break
      }
      if (!Object.hasOwn(at, step)) {
        held = false
        break
      }
      at = (at as Record<string, unknown>)[step]
    }
    if (!held) continue
    if (present.has(key)) continue
    const checked = SETTING_DEFS[key].check(at)
    present.set(key, checked)
    if (!checked.ok) problems.push({ key, message: checked.why })
  }
  return { ok: true, present, problems }
}

/** One line for the banner: the message and where the file stopped making sense. */
export function describeSyntax(parsed: Extract<ParsedSettings, { ok: false }>): string {
  const { line, column } = parsed.spot
  if (line === null) return parsed.message
  return `${parsed.message} It stops making sense at line ${String(line)}${column === null ? '' : `, column ${String(column)}`}.`
}

/**
 * What the settings are after reading this text, given the values that were in force before it.
 * A key the file does not hold goes back to its default; a key it holds a good value for takes it;
 * a key it holds a bad value for keeps its last good value. A file that does not parse changes
 * nothing.
 */
export function settingsAfter(before: Readonly<Settings>, parsed: ParsedSettings): Settings {
  const next = cloneSettings(before)
  if (!parsed.ok) return next
  for (const key of SETTING_KEYS) {
    const found = parsed.present.get(key)
    if (found === undefined) putSettingIn(next, key, SETTING_DEFS[key].default as never)
    else if (found.ok) putSettingIn(next, key, found.value as never)
  }
  return next
}
