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
