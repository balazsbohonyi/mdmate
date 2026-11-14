import { describe, errorKind } from '@/documents/store'
import { requestSettingChange } from '@/features/settings/store'
import { BUILT_IN_THEMES, builtInFor } from '@/lib/builtinThemes'
import { editThemeColor, newThemeText } from '@/lib/themeFile'
import { checkThemeName } from '@/lib/themeNames'
import { effectiveTokens, slotKey, SYSTEM_THEME } from '@/lib/themes'
import { getHost } from '@/platform'
import { reportError } from '@/shell/toasts'
import {
  currentTheme,
  enqueueThemeJob,
  noteThemeText,
  previewThemeColor,
  themeFileNames,
} from './store'

/**
 * Everything that writes a theme file: Customize makes a copy of the theme in force, the color
 * editor changes one color of a user theme, and Open themes folder shows the folder. A built-in
 * theme is never written: the CSS files are not data the app touches, and every file made here
 * lives in `themes/` of the data folder.
 */

/** A copy keeps the stem short enough to hold " copy 99" and stay a valid name. */
const STEM_MAX = 50

const shortened = (text: string): string => [...text].slice(0, STEM_MAX).join('').trim()

/** The ending that makes the first name no file has: ` copy`, then ` copy 2`, and so on. */
function freeSuffix(stem: string, taken: ReadonlySet<string>): string {
  const short = shortened(stem)
  for (let number = 1; number < 1000; number++) {
    const suffix = number === 1 ? ' copy' : ` copy ${String(number)}`
    const key = slotKey(short + suffix)
    if (!taken.has(key) && key !== SYSTEM_THEME && builtInFor(key) === undefined) return suffix
  }
  return ` copy ${String(Date.now())}`
}

/**
 * Copies the theme in force into a new file in `themes/` and selects the copy: the base palette
 * and a literal color for every token of what is shown now (System's current Dark or Light, a
 * user theme's own colors). A file that is already there is never replaced; the next free name is
 * used. Resolves to the new theme's name, or null when nothing was made (a notice says why).
 */
export async function customizeTheme(): Promise<string | null> {
  const shown = currentTheme.value
  const stem = shown.user?.id ?? shown.label
  const label = shown.user?.label ?? shown.label
  const colors = effectiveTokens(shown)
  const made = await enqueueThemeJob(async () => {
    try {
      const host = await getHost()
      const taken = new Set(themeFileNames().map(slotKey))
      for (let attempt = 0; attempt < 5; attempt++) {
        const suffix = freeSuffix(stem, taken)
        const name = shortened(stem) + suffix
        if (!checkThemeName(name).ok) throw new Error('that name is not allowed')
        const display = shortened(label) + suffix
        const text = newThemeText(display, shown.palette, colors)
        try {
          await host.themeWrite(name, text, true)
          noteThemeText(name, text)
          return name
        } catch (error) {
          // A file with that name appeared since the folder was read: take the next free name.
          if (errorKind(error) !== 'exists') throw error
          taken.add(slotKey(name))
        }
      }
      throw new Error('no free name was found')
    } catch (error) {
      reportError(`Could not make a copy of the theme: ${describe(error)}`)
      return null
    }
  })
  if (made === null) return null
  // Selecting goes through the settings screen's path, so unsaved edits in settings.json are asked about.
  await requestSettingChange('theme', made)
  return made
}

/**
 * Changes colors of one user theme's file: the file is read fresh, only those tokens change (every
 * comment, unknown key and the layout stay), and it is written once. A file that is not valid JSON
 * is refused with a notice and left alone. Resolves to whether the file now holds the colors.
 */
export function writeThemeColors(
  id: string,
  changes: ReadonlyMap<string, string>,
): Promise<boolean> {
  return enqueueThemeJob(async () => {
    try {
      const host = await getHost()
      const text = await host.themeRead(id)
      if (text === null) {
        reportError(`The theme ${id} is not in the themes folder any more.`)
        return false
      }
      let next = text
      for (const [token, value] of changes) {
        const edited = editThemeColor(next, token, value, `${id}.json`)
        if (!edited.ok) {
          reportError(edited.message)
          // The page showed the color already; show what the file holds.
          noteThemeText(id, text)
          return false
        }
        next = edited.text
      }
      if (next !== text) await host.themeWrite(id, next, false)
      noteThemeText(id, next)
      showPendingColors(id)
      return true
    } catch (error) {
      reportError(`Could not save ${id}.json: ${describe(error)}`)
      return false
    }
  })
}

/** How long a color picker must rest before what it holds is written. A drag fires many events. */
export const COLOR_QUIET_MS = 150

let pending: { id: string; colors: Map<string, string> } | null = null
let timer: ReturnType<typeof setTimeout> | undefined

/**
 * Shows the colors still waiting to be written on top of what the file now holds, so a write that
 * lands while the picker is still being dragged does not put an older color back for a moment.
 */
function showPendingColors(id: string): void {
  if (pending?.id !== id) return
  for (const [token, value] of pending.colors) previewThemeColor(token, value)
}

/** Writes what is waiting, now. Resolves once it is written. */
export function flushThemeColors(): Promise<boolean> {
  clearTimeout(timer)
  timer = undefined
  const waiting = pending
  pending = null
  if (waiting === null) return Promise.resolve(true)
  return writeThemeColors(waiting.id, waiting.colors)
}

/**
 * A color changed in the editor. It shows on the page at once; the write waits for the pointer or
 * the keys to rest (`COLOR_QUIET_MS`), so a drag of the picker is a few writes and the last value
 * is what the file holds. `now` writes straight away, for a value typed and accepted.
 */
export function changeThemeColor(token: string, value: string, now = false): Promise<boolean> {
  const user = currentTheme.value.user
  if (user === null) return Promise.resolve(false)
  previewThemeColor(token, value)
  if (pending !== null && pending.id !== user.id) void flushThemeColors()
  pending ??= { id: user.id, colors: new Map() }
  pending.colors.set(token, value)
  if (now) return flushThemeColors()
  clearTimeout(timer)
  timer = setTimeout(() => {
    void flushThemeColors()
  }, COLOR_QUIET_MS)
  return Promise.resolve(true)
}

/** Shows the themes folder in the file manager, making it first when it is missing. */
export async function openThemesFolder(): Promise<void> {
  try {
    await (await getHost()).themesFolderOpen()
  } catch (error) {
    reportError(`Could not open the themes folder: ${describe(error)}`)
  }
}

/** The built-in palette a base names, for the color editor's header. */
export function baseLabel(base: keyof typeof BUILT_IN_THEMES): string {
  return BUILT_IN_THEMES[base].label
}
