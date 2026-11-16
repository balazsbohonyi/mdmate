import { reservedName, type Checked } from './settingsFile'

/**
 * What a user theme may be called: the name of its file in `themes/` without `.json`. Rust checks
 * the same rules before it reads or writes anything (`settings::themes::clean_name`);
 * `tests/data/theme-names.json` holds the cases both sides read.
 */

export const MAX_THEME_NAME = 64

export function checkThemeName(value: unknown): Checked<string> {
  if (typeof value !== 'string') return { ok: false, why: 'Use a theme name in quotes.' }
  const bad = (why: string): Checked<string> => ({ ok: false, why })
  if (value === '') return bad('Name a theme.')
  if ([...value].length > MAX_THEME_NAME) return bad('Use at most 64 characters.')
  if (!/^[\p{Alphabetic}\p{N} _.-]+$/u.test(value))
    return bad('Use letters, digits, spaces and - _ . only.')
  if (/^[ .]|[ .]$/.test(value)) return bad('A name cannot start or end with a space or a dot.')
  if (value.includes('..')) return bad('A name cannot hold two dots in a row.')
  if (reservedName(value)) return bad('That is a name Windows keeps.')
  return { ok: true, value }
}

/** The longest name a theme is shown with, in characters. */
export const MAX_THEME_LABEL = 60

/** The names the built-in themes go by, lower-cased: no user theme takes one. */
const BUILT_IN_LABELS: readonly string[] = ['dark', 'light', 'sepia', 'system']

/**
 * What a theme may be called on screen (the `name` in its file): free text of 1 to 60 characters
 * once trimmed, with no control characters, that no other theme has (letter case ignored) and no
 * built-in theme goes by. `others` are the names of the other themes.
 */
export function checkThemeLabel(value: string, others: Iterable<string>): Checked<string> {
  const label = value.trim()
  const bad = (why: string): Checked<string> => ({ ok: false, why })
  if (label === '') return bad('Name the theme.')
  if ([...label].length > MAX_THEME_LABEL) return bad('Use at most 60 characters.')
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[\u0000-\u001f\u007f]/u.test(label)) return bad('Use printable characters only.')
  const key = label.toLowerCase()
  if (BUILT_IN_LABELS.includes(key)) return bad(`${label} is a built-in theme.`)
  for (const other of others)
    if (other.trim().toLowerCase() === key) return bad('A theme with that name exists already.')
  return { ok: true, value: label }
}

/**
 * The file a theme of this name is kept in, without `.json`: letters, digits, spaces and `- _ .`
 * as written, every other character a `-`, trimmed and shortened to 50 characters so it is always
 * a name Rust takes. A stem that is taken (in `taken`, lower-cased) or that a built-in theme owns
 * gets a number added. The user never sees it: it is only where the theme lives.
 */
export function themeStem(label: string, taken: ReadonlySet<string>): string {
  const swapped = [...label]
    .map((char) => (/[\p{Alphabetic}\p{N} _.-]/u.test(char) ? char : '-'))
    .join('')
    .replace(/\.{2,}/g, '.')
    .replace(/^[ .]+|[ .]+$/g, '')
  const base = [...(swapped === '' ? 'theme' : swapped)]
    .slice(0, 50)
    .join('')
    .replace(/[ .]+$/, '')
  const stem = base === '' ? 'theme' : base
  for (let number = 1; number < 1000; number++) {
    const candidate = number === 1 ? stem : `${stem} ${String(number)}`
    const key = candidate.toLowerCase()
    if (!taken.has(key) && !BUILT_IN_LABELS.includes(key) && checkThemeName(candidate).ok)
      return candidate
  }
  return `theme ${String(Date.now())}`
}

/** The first name of the form `<name> copy`, `<name> copy 2` and so on that no other theme has. */
export function copyLabel(name: string, others: Iterable<string>): string {
  const held = [...others]
  const short = [...name.trim()].slice(0, 50).join('').trim()
  for (let number = 1; number < 1000; number++) {
    const label = `${short} copy${number === 1 ? '' : ` ${String(number)}`}`
    if (checkThemeLabel(label, held).ok) return label
  }
  return `${short} copy ${String(Date.now())}`
}
