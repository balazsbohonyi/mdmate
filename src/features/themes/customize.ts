import { describe, errorKind } from '@/documents/store'
import { requestSettingChange } from '@/features/settings/store'
import { BUILT_IN_THEMES, builtInFor, type BuiltInId } from '@/lib/builtinThemes'
import { formatColor } from '@/lib/color'
import { settings } from '@/lib/settings'
import type { Checked } from '@/lib/settingsFile'
import { editThemeColor, editThemeField, newThemeText } from '@/lib/themeFile'
import { checkThemeLabel, copyLabel, themeStem } from '@/lib/themeNames'
import { effectiveTokens, slotKey, SYSTEM_THEME } from '@/lib/themes'
import { getHost } from '@/platform'
import { reportError, reportWarning } from '@/shell/toasts'
import {
  currentTheme,
  dropThemeText,
  enqueueThemeJob,
  holdThemeNotices,
  noteThemeText,
  previewThemeColor,
  requestEditorScroll,
  systemIsDark,
  themeFileNames,
  themeSlots,
} from './store'

/**
 * Everything that writes a theme file: Customize makes a copy of the theme in force, the color
 * editor changes one color of a user theme, and Open themes folder shows the folder. A built-in
 * theme is never written: the CSS files are not data the app touches, and every file made here
 * lives in `themes/` of the data folder.
 */

/** What a new theme starts from: a palette, and the color of every token. */
interface Source {
  readonly label: string
  readonly palette: BuiltInId
  readonly colors: Map<string, string>
}

/** The names of the user themes, leaving out the one with this file name. */
function userLabels(exceptId?: string): string[] {
  const labels: string[] = []
  for (const slot of themeSlots.value) {
    if (!slot.ok) continue
    if (exceptId !== undefined && slotKey(slot.theme.id) === slotKey(exceptId)) continue
    labels.push(slot.theme.label)
  }
  return labels
}

/**
 * What a theme in the list stands for, as data to start a new theme from: a built-in's palette, a
 * user theme's own colors on its base, or what System shows right now. Null for a name that is
 * nothing (or a file that could not be read).
 */
function sourceOf(value: string): Source | null {
  const key = slotKey(value)
  if (key === SYSTEM_THEME) {
    const palette: BuiltInId = systemIsDark() ? 'dark' : 'light'
    return { label: 'System', palette, colors: effectiveTokens({ palette, overrides: new Map() }) }
  }
  const builtIn = builtInFor(key)
  if (builtIn !== undefined) {
    return {
      label: builtIn.label,
      palette: builtIn.id,
      colors: effectiveTokens({ palette: builtIn.id, overrides: new Map() }),
    }
  }
  for (const slot of themeSlots.value) {
    if (!slot.ok || slotKey(slot.theme.id) !== key) continue
    const { label, base, colors } = slot.theme
    return { label, palette: base, colors: effectiveTokens({ palette: base, overrides: colors }) }
  }
  return null
}

/** Colors as the file should hold them: in the format chosen in Settings, converted where they were in the other. */
function inChosenFormat(colors: ReadonlyMap<string, string>): Map<string, string> {
  const format = settings.themes.colorFormat
  return new Map([...colors].map(([name, value]) => [name, formatColor(value, format)]))
}

/**
 * Writes a new theme file and tells the page about it. A name no file has is found for it; a file
 * that appears between the check and the write is never replaced, the next name is tried. Resolves
 * to the file's name without `.json`, or null after a notice says why nothing was made.
 */
function writeNewTheme(
  label: string,
  palette: BuiltInId,
  colors: ReadonlyMap<string, string>,
): Promise<string | null> {
  return enqueueThemeJob(async () => {
    try {
      const host = await getHost()
      const taken = new Set(themeFileNames().map(slotKey))
      for (let attempt = 0; attempt < 5; attempt++) {
        const stem = themeStem(label, taken)
        const text = newThemeText(label, palette, inChosenFormat(colors))
        try {
          await host.themeWrite(stem, text, true)
          noteThemeText(stem, text)
          return stem
        } catch (error) {
          if (errorKind(error) !== 'exists') throw error
          taken.add(slotKey(stem))
        }
      }
      throw new Error('no free file name was found')
    } catch (error) {
      reportError(`Could not make the theme: ${describe(error)}`)
      return null
    }
  })
}

/** Makes a theme selected and the color editor come into view: what every way of making one ends with. */
async function selectAndShow(id: string): Promise<void> {
  // Selecting goes through the settings screen's path, so unsaved edits in settings.json are asked about.
  await requestSettingChange('theme', id)
  requestEditorScroll()
}

/** What a new theme can start from: a built-in palette, or what is shown now. */
export type StartFrom = BuiltInId | 'current'

/**
 * Makes a new theme from nothing the user has to copy: a name, and a palette to start from (every
 * color is written out, so the file is complete and nothing depends on the base staying as it is).
 * The new theme is selected and the editor scrolled into view. Resolves to the new theme's file
 * name, or why the name was refused.
 */
export async function createTheme(rawName: string, from: StartFrom): Promise<Checked<string>> {
  const checked = checkThemeLabel(rawName, userLabels())
  if (!checked.ok) return checked
  const source = sourceOf(from === 'current' ? currentTheme.value.setting : from)
  const shown = currentTheme.value
  const start: Source =
    from === 'current' && source === null
      ? { label: shown.label, palette: shown.palette, colors: effectiveTokens(shown) }
      : (source ?? {
          label: 'Dark',
          palette: 'dark',
          colors: effectiveTokens({ palette: 'dark', overrides: new Map() }),
        })
  const id = await writeNewTheme(checked.value, start.palette, start.colors)
  if (id === null) return { ok: false, why: 'The theme could not be made.' }
  await selectAndShow(id)
  return { ok: true, value: id }
}

/** What a copy of this theme (the one in force when none is named) starts from. */
function copySource(value?: string): Source {
  const source = sourceOf(value ?? currentTheme.value.setting)
  if (source !== null) return source
  const shown = currentTheme.value
  return {
    label: shown.user === null ? shown.label : shown.user.label,
    palette: shown.palette,
    colors: effectiveTokens(shown),
  }
}

/** The name a copy of this theme gets unless the user types another: "<name> copy", numbered when taken. */
export const suggestCopyName = (value?: string): string =>
  copyLabel(copySource(value).label, userLabels())

/**
 * Copies a theme (the one in force unless one is named) into a new file called by the name given,
 * with its colors written out in the chosen format, and selects the copy. Built-in CSS is never written.
 * Resolves to the copy's file name, or why the name was refused (a notice says why for any other
 * failure).
 */
export async function copyTheme(
  value: string | undefined,
  rawName: string,
): Promise<Checked<string>> {
  const checked = checkThemeLabel(rawName, userLabels())
  if (!checked.ok) return checked
  const start = copySource(value)
  const id = await writeNewTheme(checked.value, start.palette, start.colors)
  if (id === null) return { ok: false, why: 'The theme could not be made.' }
  await selectAndShow(id)
  return { ok: true, value: id }
}

/** Copies a theme under the name "<name> copy". Resolves to the copy's file name, or null when nothing was made. */
export async function duplicateTheme(value?: string): Promise<string | null> {
  const made = await copyTheme(value, suggestCopyName(value))
  return made.ok ? made.value : null
}

/** Customize and Duplicate are one thing: a copy of the theme in force, selected and ready to edit. */
export const customizeTheme = (): Promise<string | null> => duplicateTheme()

/** Dark, Light, Sepia and System are built in: no function here renames, deletes or writes one. */
export const isBuiltInTheme = (id: string): boolean =>
  slotKey(id) === SYSTEM_THEME || builtInFor(slotKey(id)) !== undefined

/** Picks a theme to edit: it is selected and the color editor comes into view. A built-in theme has no colors to edit, so nothing happens. */
export async function editTheme(id: string): Promise<void> {
  if (isBuiltInTheme(id)) return
  await selectAndShow(id)
}

/**
 * Gives a user theme another name: the `name` in its file changes and so does the file, so the two
 * agree. A theme in use stays in use. Resolves to the new file name, or why the name was refused
 * (a notice says why for any other failure).
 */
export async function renameTheme(id: string, rawName: string): Promise<Checked<string>> {
  if (isBuiltInTheme(id)) return { ok: false, why: 'A built-in theme cannot be renamed.' }
  const checked = checkThemeLabel(rawName, userLabels(id))
  if (!checked.ok) return checked
  const label = checked.value
  const inUse = slotKey(settings.theme) === slotKey(id)
  const outcome = await holdThemeNotices(async () => {
    const stem = await enqueueThemeJob(async (): Promise<string | null> => {
      try {
        const host = await getHost()
        const text = await host.themeRead(id)
        if (text === null) throw new Error(`${id}.json is not in the themes folder any more`)
        const edited = editThemeField(text, 'name', label, `${id}.json`)
        if (!edited.ok) {
          reportError(edited.message)
          return null
        }
        const others = new Set(themeFileNames().map(slotKey))
        others.delete(slotKey(id))
        const target = themeStem(label, others)
        await host.themeWrite(id, edited.text, false)
        if (target !== id) {
          await host.themeRename(id, target)
          dropThemeText(id)
        }
        noteThemeText(target, edited.text)
        return target
      } catch (error) {
        reportError(`Could not rename the theme: ${describe(error)}`)
        return null
      }
    })
    if (stem !== null && inUse && stem !== id) await requestSettingChange('theme', stem)
    return stem
  })
  return outcome === null
    ? { ok: false, why: 'The theme could not be renamed.' }
    : { ok: true, value: outcome }
}

/**
 * Moves a user theme's file to the Recycle Bin. With no bin the file stays and a notice says so. A
 * theme that was in use gives way to Dark, and the notice says that too. Resolves to whether the
 * file is gone.
 */
export async function deleteTheme(id: string): Promise<boolean> {
  if (isBuiltInTheme(id)) return false
  const label = userLabelOf(id)
  const gone = await holdThemeNotices(async () => {
    const done = await enqueueThemeJob(async () => {
      try {
        await (await getHost()).themeDelete(id)
        dropThemeText(id)
        return true
      } catch (error) {
        reportError(`Could not move ${label} to the Recycle Bin: ${describe(error)}`)
        return false
      }
    })
    if (done && slotKey(settings.theme) === slotKey(id)) await requestSettingChange('theme', 'dark')
    return done
  })
  if (gone)
    reportWarning(
      `${label} is in the Recycle Bin.${slotKey(settings.theme) === 'dark' ? ' The theme is Dark now.' : ''}`,
    )
  return gone
}

function userLabelOf(id: string): string {
  for (const slot of themeSlots.value)
    if (slot.ok && slotKey(slot.theme.id) === slotKey(id)) return slot.theme.label
  return id
}

/** The palette's own color for a token: what a user theme shows when its file leaves the token out. */
export function baseColorOf(base: BuiltInId, token: string): string | undefined {
  return effectiveTokens({ palette: base, overrides: new Map() }).get(token)
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
