import { BUNDLED_FONT_NAMES } from '@/lib/fontPresets'
import { getHost } from '@/platform'

let families: Promise<readonly string[]> | null = null

/** Merges the bundled font display names with the system families, deduplicated and sorted A to Z. */
export function mergeBundledFonts(installed: readonly string[]): string[] {
  const byKey = new Map<string, string>()
  for (const name of installed) byKey.set(name.toLowerCase(), name)
  for (const name of BUNDLED_FONT_NAMES) byKey.set(name.toLowerCase(), name)
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/**
 * The installed and bundled font families, A to Z, for the font fields in Settings. System fonts
 * are read on the first call (a moment of work in Rust), so a window that never opens a font field
 * never pays for it, and the answer is kept for the rest of the run. A failure answers an empty
 * list and is not kept, so opening a field again asks again.
 */
export function fontFamilies(): Promise<readonly string[]> {
  families ??= getHost()
    .then((host) => host.listFontFamilies())
    .then((list) => mergeBundledFonts(list))
    .catch(() => {
      families = null
      return []
    })
  return families
}

/** Forgets the list, so the next call asks the system again. For tests. */
export function resetFontFamilies(): void {
  families = null
}
