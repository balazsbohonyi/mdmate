import type { ThemeFileEntry } from './host'

/** Reads the answer of `themes_read`: a list of `{ name, text, error }`. Anything else is skipped. */
export function parseThemeEntries(value: unknown): ThemeFileEntry[] {
  if (!Array.isArray(value)) return []
  const entries: ThemeFileEntry[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const { name, text, error } = item as Record<string, unknown>
    if (typeof name !== 'string') continue
    entries.push({
      name,
      text: typeof text === 'string' ? text : null,
      error: typeof error === 'string' ? error : null,
    })
  }
  return entries
}
