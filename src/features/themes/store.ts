import { computed, shallowRef } from 'vue'
import { describe } from '@/documents/store'
import { settings } from '@/lib/settings'
import { builtInFor } from '@/lib/builtinThemes'
import { checkThemeColor, parseThemeText } from '@/lib/themeFile'
import {
  applyTheme,
  BUILT_IN_CHOICES,
  resolveTheme,
  slotKey,
  SYSTEM_THEME,
  type ResolvedTheme,
  type ThemeChoice,
  type UserThemeSlot,
} from '@/lib/themes'
import { getHost } from '@/platform'
import type { ThemeFileEntry } from '@/platform/host'
import { reportWarning } from '@/shell/toasts'

/**
 * The user theme files as the page lives with them, and the theme in force. The files in
 * `themes/` are the source of truth: this module reads them (at start, and each time the folder
 * changes), checks each with the one validator in `lib/themeFile.ts`, and works out what the
 * `theme` setting shows. Nothing here writes a file; `customize.ts` does.
 */

/** What the folder held at the last read, by file name: the text, or why there is none. */
let known = new Map<string, { text: string | null; error: string | null }>()

const slots = shallowRef<ReadonlyMap<string, UserThemeSlot>>(new Map())
/** Whether the themes folder has been read; until then an unknown name is not reported as missing. */
const loaded = shallowRef(false)
/** Files in the folder that were left out, and why, one sentence each. */
const fileNotes = shallowRef<readonly string[]>([])
/** Whether the operating system is using a dark appearance, for the System theme. */
const systemDark = shallowRef(false)

/** The theme in force: what the `theme` setting resolves to now. */
export const currentTheme = shallowRef<ResolvedTheme>(
  resolveTheme('dark', new Map(), { systemDark: false, loaded: false }),
)

/** The notice for the theme row: what could not be honored or was ignored. Null when all is well. */
export const themeProblem = computed<string | null>(() => {
  const parts = [currentTheme.value.notice, ...fileNotes.value].filter(
    (part): part is string => part !== null,
  )
  return parts.length === 0 ? null : parts.join(' ')
})

/** The built-in themes, then each usable user theme by name: what Switch Theme and the row offer. */
export const themeChoices = computed<readonly ThemeChoice[]>(() => {
  const user: ThemeChoice[] = []
  for (const slot of slots.value.values()) {
    if (slot.ok) user.push({ value: slot.theme.id, label: slot.theme.label })
  }
  user.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  return [...BUILT_IN_CHOICES, ...user]
})

/** Every theme file that was read, usable or not, in no particular order. */
export const themeSlots = computed<readonly UserThemeSlot[]>(() => [...slots.value.values()])

/** Whether the operating system is using a dark appearance (what the System theme shows now). */
export function systemIsDark(): boolean {
  return systemDark.value
}

/** Counts how many times the color editor was asked to come to the top of the Settings screen. */
export const editorScrollRequests = shallowRef(0)

/** Asks the color editor to scroll to the top of the screen: a theme was made, copied or picked to edit. */
export function requestEditorScroll(): void {
  editorScrollRequests.value++
}

/** The names of the files in the folder, in any case, for picking a name no file has. */
export function themeFileNames(): string[] {
  return [...known.keys()]
}

/** The text of a theme file as last read or written, or undefined when the folder had no such file. */
export function knownThemeText(name: string): string | undefined {
  for (const [file, entry] of known) {
    if (slotKey(file) === slotKey(name)) return entry.text ?? undefined
  }
  return undefined
}

function where(message: string, spot: { line: number | null; column: number | null }): string {
  const text = message.replace(/\.$/, '')
  if (spot.line === null) return `${text}.`
  return `${text}, and stops making sense at line ${String(spot.line)}${spot.column === null ? '' : `, column ${String(spot.column)}`}.`
}

/** Turns the folder's files into theme slots, and a note for each file that was left out. */
function buildSlots(entries: ReadonlyMap<string, { text: string | null; error: string | null }>): {
  slots: Map<string, UserThemeSlot>
  notes: string[]
} {
  const out = new Map<string, UserThemeSlot>()
  const notes: string[] = []
  for (const [name, entry] of entries) {
    const key = slotKey(name)
    if (key === SYSTEM_THEME || builtInFor(key) !== undefined) {
      notes.push(`themes/${name}.json is ignored: ${key} is a built-in theme.`)
      continue
    }
    if (out.has(key)) continue
    if (entry.text === null) {
      out.set(key, { ok: false, id: name, message: `${entry.error ?? 'it could not be read'}.` })
      continue
    }
    const parsed = parseThemeText(entry.text)
    if (!parsed.ok) {
      out.set(key, { ok: false, id: name, message: where(parsed.message, parsed.spot) })
      continue
    }
    const data = parsed.theme
    out.set(key, {
      ok: true,
      theme: {
        id: name,
        label: data.name ?? name,
        base: data.base,
        colors: data.colors,
        problems: data.problems,
      },
    })
  }
  return { slots: out, notes }
}

/** While above zero, a change of theme says nothing: a rename passes through a moment with no file. */
let heldNotices = 0

/**
 * Runs `work` with the theme notices held back, then applies the theme once more. A rename or a
 * delete moves the file and the `theme` setting in two steps; the notice for the step in between
 * ("no file for that theme") would be wrong by the time it is read.
 */
export async function holdThemeNotices<T>(work: () => Promise<T>): Promise<T> {
  heldNotices++
  try {
    return await work()
  } finally {
    heldNotices--
    applyCurrentTheme()
  }
}

/** The last notices shown, so one thing wrong is one toast and not one per re-read. */
let lastNotice = ''

/** Works out the theme from the setting and the files, puts it on the page, and says what is wrong. */
export function applyCurrentTheme(): void {
  const resolved = resolveTheme(settings.theme, slots.value, {
    systemDark: systemDark.value,
    loaded: loaded.value,
  })
  currentTheme.value = resolved
  applyTheme(resolved)
  const notice = themeProblem.value
  if (notice === null) {
    lastNotice = ''
  } else if (heldNotices === 0 && notice !== lastNotice) {
    lastNotice = notice
    reportWarning(notice)
  }
}

/**
 * Shows a color at once, before it is written: the theme in force gets the value, so a color
 * picker that is still being dragged is seen on the page. The file is written a moment later and
 * says the same. A value that is not a color, or no user theme in force, changes nothing.
 */
export function previewThemeColor(token: string, value: string): void {
  const now = currentTheme.value
  if (now.user === null || !checkThemeColor(value).ok) return
  const next: ResolvedTheme = { ...now, overrides: new Map(now.overrides).set(token, value) }
  currentTheme.value = next
  applyTheme(next)
}

/** Takes a list of files as what the folder holds and applies the theme. */
function takeEntries(list: readonly ThemeFileEntry[]): void {
  known = new Map(list.map((entry) => [entry.name, { text: entry.text, error: entry.error }]))
  rebuild()
}

function rebuild(): void {
  const built = buildSlots(known)
  slots.value = built.slots
  fileNotes.value = built.notes
  loaded.value = true
  applyCurrentTheme()
}

/**
 * Puts new text for one file into what the page knows, as if the folder had just been read: the
 * app's own writes take this path so the screen follows at once and the watcher finds nothing new.
 */
export function noteThemeText(name: string, text: string): void {
  known = new Map(known)
  for (const file of known.keys()) if (slotKey(file) === slotKey(name)) known.delete(file)
  known.set(name, { text, error: null })
  rebuild()
}

/** Forgets one file, as if the folder had just been read without it (it was renamed or deleted). */
export function dropThemeText(name: string): void {
  known = new Map(known)
  for (const file of known.keys()) if (slotKey(file) === slotKey(name)) known.delete(file)
  rebuild()
}

/** The same list as the page last held, for deciding whether a re-read found anything new. */
function sameAsKnown(list: readonly ThemeFileEntry[]): boolean {
  if (list.length !== known.size) return false
  return list.every((entry) => {
    const have = known.get(entry.name)
    return have?.text === entry.text && have?.error === entry.error
  })
}

/** Writes to theme files go one after another, each on top of the file as it is when its turn comes. */
let queue: Promise<unknown> = Promise.resolve()

export function enqueueThemeJob<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

/** Resolves once every write that was asked for has been done. */
export function settledThemes(): Promise<void> {
  return queue.then(
    () => undefined,
    () => undefined,
  )
}

/** Reads the themes folder and applies the theme. A folder that cannot be read keeps what was held. */
export async function loadThemes(): Promise<void> {
  try {
    takeEntries(await (await getHost()).themesRead())
  } catch (error) {
    reportWarning(`The themes folder could not be read: ${describe(error)}`)
  }
}

/** Reads the folder again after a change on disk and applies it only when something is new. */
async function onFolderChange(): Promise<void> {
  // A write of ours may still be on its way: wait for it, so its echo is not read as someone else's.
  await settledThemes()
  try {
    const list = await (await getHost()).themesRead()
    if (loaded.value && sameAsKnown(list)) return
    takeEntries(list)
  } catch (error) {
    reportWarning(`The themes folder could not be read: ${describe(error)}`)
  }
}

/** Starts hearing about changes to the themes folder. Returns the function that stops listening. */
export async function watchThemesFolder(): Promise<() => void> {
  const host = await getHost()
  return host.watchThemes(() => {
    void onFolderChange()
  })
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Follows the operating system's light or dark appearance for the System theme: it reads it now and
 * again each time it changes. Returns the function that stops listening. Without a media-query
 * API (a test environment) it stays on light.
 */
export function watchSystemAppearance(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return () => undefined
  const query = window.matchMedia(DARK_QUERY)
  const follow = (): void => {
    if (systemDark.value === query.matches) return
    systemDark.value = query.matches
    applyCurrentTheme()
  }
  systemDark.value = query.matches
  query.addEventListener('change', follow)
  return () => {
    query.removeEventListener('change', follow)
  }
}

/** Back to a folder that was never read, for a test. */
export function resetThemesState(): void {
  known = new Map()
  slots.value = new Map()
  fileNotes.value = []
  loaded.value = false
  systemDark.value = false
  queue = Promise.resolve()
  lastNotice = ''
  heldNotices = 0
  editorScrollRequests.value = 0
  currentTheme.value = resolveTheme(settings.theme, new Map(), { systemDark: false, loaded: false })
}
