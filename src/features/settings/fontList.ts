import { getHost } from '@/platform'

let families: Promise<readonly string[]> | null = null

/**
 * The installed font families, A to Z, for the font fields in Settings. They are read from the
 * system on the first call (a moment of work in Rust), so a window that never opens a font field
 * never pays for it, and the answer is kept for the rest of the run. A failure answers an empty
 * list and is not kept, so opening a field again asks again.
 */
export function fontFamilies(): Promise<readonly string[]> {
  families ??= getHost()
    .then((host) => host.listFontFamilies())
    .then((list) => [...list])
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
