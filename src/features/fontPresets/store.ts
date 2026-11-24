import { computed, shallowRef } from 'vue'
import { describe } from '@/documents/store'
import { setFontPresetResolver, updateDocumentFonts } from '@/editor/documentFonts'
import {
  parseFontPresetText,
  userPresetFromData,
  type UserFontPresetData,
} from '@/lib/fontPresetFile'
import {
  DEFAULT_FONT_PRESET,
  FONT_PRESET_IDS,
  FONT_PRESETS,
  isBuiltInFontPreset,
  type FontPreset,
} from '@/lib/fontPresets'
import { settings } from '@/lib/settings'
import { getHost } from '@/platform'
import type { FontPresetFileEntry } from '@/platform/host'
import { reportWarning } from '@/shell/toasts'

/**
 * Custom user font preset files (`font-presets/*.json`, P9.1-T40) as the page lives with them.
 * Mirrors `features/themes/store.ts`: loaded at startup before first paint, live-reloaded on
 * folder changes, and resolved against `settings.fonts.preset` with fallback to `system`.
 */

export type UserFontPresetSlot =
  | { readonly ok: true; readonly preset: FontPreset; readonly raw: UserFontPresetData }
  | { readonly ok: false; readonly id: string; readonly message: string }

export const presetSlotKey = (id: string): string => id.trim().toLowerCase()

let known = new Map<string, { text: string | null; error: string | null }>()
const slots = shallowRef<ReadonlyMap<string, UserFontPresetSlot>>(new Map())
const loaded = shallowRef(false)
const fileNotes = shallowRef<readonly string[]>([])

export interface ResolvedFontPreset {
  readonly preset: FontPreset
  readonly notice: string | null
}

/** Resolves a preset id against built-ins and loaded user presets, falling back to `system`. */
export function resolveFontPresetById(id: string): ResolvedFontPreset {
  const trimmed = id.trim()
  const key = presetSlotKey(trimmed)
  if (isBuiltInFontPreset(key)) {
    return { preset: FONT_PRESETS[key], notice: null }
  }
  const slot = slots.value.get(key)
  if (slot === undefined) {
    return {
      preset: FONT_PRESETS[DEFAULT_FONT_PRESET],
      notice: loaded.value
        ? `Font preset "${trimmed}" was not found in the font-presets folder. Using System.`
        : null,
    }
  }
  if (!slot.ok) {
    return {
      preset: FONT_PRESETS[DEFAULT_FONT_PRESET],
      notice: `Font preset "${slot.id}" could not be used: ${slot.message} Using System.`,
    }
  }
  return {
    preset: slot.preset,
    notice:
      slot.raw.problems.length === 0
        ? null
        : `Font preset "${slot.preset.label}": ${slot.raw.problems.join(' ')}`,
  }
}

/** Wire the pure editor font module to read resolved custom presets without importing Vue. */
setFontPresetResolver((id) => resolveFontPresetById(id).preset)

/** The active resolved preset (built-in or custom, or `system` fallback). */
export const activeFontPreset = computed<FontPreset>(
  () => resolveFontPresetById(settings.fonts.preset).preset,
)

/** Notice for the `fonts.preset` row when a preset is missing, broken, or had ignored files. */
export const fontPresetProblem = computed<string | null>(() => {
  if (noticesHeld.value > 0) return null
  const active = resolveFontPresetById(settings.fonts.preset).notice
  const parts = [active, ...fileNotes.value].filter((part): part is string => part !== null)
  return parts.length === 0 ? null : parts.join(' ')
})

/** Every user preset file that was read, usable or broken. */
export const fontPresetSlots = computed<readonly UserFontPresetSlot[]>(() => [
  ...slots.value.values(),
])

/** All usable presets: built-ins in fixed order first, then user presets A to Z by label. */
export const allFontPresets = computed<readonly FontPreset[]>(() => {
  const builtIns = FONT_PRESET_IDS.map((id) => FONT_PRESETS[id])
  const user: FontPreset[] = []
  for (const slot of slots.value.values()) {
    if (slot.ok) user.push(slot.preset)
  }
  user.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  return [...builtIns, ...user]
})

/** Every usable user preset slot's raw data by preset id (case-insensitive), or undefined. */
export function userPresetSlotOf(id: string): UserFontPresetSlot | undefined {
  return slots.value.get(presetSlotKey(id))
}

/** All known file stems in `font-presets/`, for picking a free filename. */
export function fontPresetFileNames(): string[] {
  return [...known.keys()]
}

let lastNotice = ''
const noticesHeld = shallowRef(0)

function notify(message: string | null): void {
  if (noticesHeld.value > 0) return
  if (message === null) {
    lastNotice = ''
    return
  }
  if (message === lastNotice) return
  lastNotice = message
  reportWarning(message)
}

/** Suppresses transient missing-preset notices while a rename or delete updates `settings.json`. */
export async function holdFontPresetNotices<T>(run: () => Promise<T>): Promise<T> {
  noticesHeld.value++
  try {
    return await run()
  } finally {
    noticesHeld.value--
    if (noticesHeld.value === 0) applyCurrentFontPreset()
  }
}

/** Re-applies document CSS font properties for the active preset and reports any notice. */
export function applyCurrentFontPreset(): void {
  updateDocumentFonts()
  notify(fontPresetProblem.value)
}

function rebuildSlots(): void {
  const builtInKeys = new Set<string>(FONT_PRESET_IDS.map((id) => id.toLowerCase()))
  const next = new Map<string, UserFontPresetSlot>()
  const notes: string[] = []
  for (const [name, entry] of known) {
    const key = presetSlotKey(name)
    if (builtInKeys.has(key)) {
      notes.push(`Ignored ${name}.json: "${name}" is a built-in preset name.`)
      continue
    }
    if (entry.error !== null || entry.text === null) {
      next.set(key, {
        ok: false,
        id: name,
        message: entry.error ?? 'the file could not be read.',
      })
      continue
    }
    const parsed = parseFontPresetText(entry.text)
    if (!parsed.ok) {
      const spot = parsed.spot.line === null ? '' : ` (line ${String(parsed.spot.line)})`
      next.set(key, { ok: false, id: name, message: `${parsed.message}${spot}` })
      continue
    }
    next.set(key, {
      ok: true,
      preset: userPresetFromData(name, parsed.preset),
      raw: parsed.preset,
    })
  }
  slots.value = next
  fileNotes.value = notes
  applyCurrentFontPreset()
}

function applyEntries(entries: readonly FontPresetFileEntry[]): void {
  const next = new Map<string, { text: string | null; error: string | null }>()
  for (const entry of entries) {
    next.set(entry.name, { text: entry.text, error: entry.error })
  }
  const same =
    next.size === known.size &&
    [...next].every(([name, entry]) => {
      const prev = known.get(name)
      return prev?.text === entry.text && prev.error === entry.error
    })
  known = next
  loaded.value = true
  if (!same || slots.value.size === 0) rebuildSlots()
  else applyCurrentFontPreset()
}

let jobQueue: Promise<unknown> = Promise.resolve()

/** Serializes writes, renames and deletes to `font-presets/`. */
export function enqueueFontPresetJob<T>(job: () => Promise<T>): Promise<T> {
  const run = jobQueue.then(job, job)
  jobQueue = run.catch(() => undefined)
  return run
}

/** Updates in-memory cache right after our own write so the UI responds immediately. */
export function noteFontPresetText(name: string, text: string): void {
  known.set(name, { text, error: null })
  loaded.value = true
  rebuildSlots()
}

/** Removes a file stem from the in-memory cache right after our own rename or delete. */
export function dropFontPresetText(name: string): void {
  const key = presetSlotKey(name)
  for (const existing of [...known.keys()]) {
    if (presetSlotKey(existing) === key) known.delete(existing)
  }
  rebuildSlots()
}

/** Reads every file in `font-presets/` and applies the active preset. */
export async function loadFontPresets(): Promise<void> {
  try {
    const entries = await (await getHost()).fontPresetsRead()
    applyEntries(entries)
  } catch (error) {
    loaded.value = true
    reportWarning(`Could not read the font-presets folder: ${describe(error)}`)
  }
}

/** Starts watching `font-presets/` for external changes. */
export async function watchFontPresetsFolder(): Promise<() => void> {
  const host = await getHost()
  return host.watchFontPresets(() => {
    void jobQueue.then(() => loadFontPresets())
  })
}

/** Resets module state for unit tests. */
export function resetFontPresetsState(): void {
  known = new Map()
  slots.value = new Map()
  loaded.value = false
  fileNotes.value = []
  lastNotice = ''
  noticesHeld.value = 0
  jobQueue = Promise.resolve()
}
