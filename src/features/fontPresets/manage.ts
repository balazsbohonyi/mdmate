import { describe, errorKind } from '@/documents/store'
import { requestFontPreset } from '@/features/settings/store'
import {
  checkPresetDisplayName,
  copyPresetLabel,
  presetStem,
  serializeFontPreset,
  type FontPresetWriteData,
} from '@/lib/fontPresetFile'
import {
  DEFAULT_FONT_PRESET,
  FONT_PRESETS,
  inlineCodeScaleFor,
  isBuiltInFontPreset,
  resolveFontMetrics,
} from '@/lib/fontPresets'
import { settings } from '@/lib/settings'
import type { Checked } from '@/lib/settingsFile'
import { getHost } from '@/platform'
import { reportError, reportWarning } from '@/shell/toasts'
import {
  activeFontPreset,
  dropFontPresetText,
  enqueueFontPresetJob,
  fontPresetFileNames,
  fontPresetSlots,
  holdFontPresetNotices,
  noteFontPresetText,
  presetSlotKey,
  userPresetSlotOf,
} from './store'

/**
 * Everything that writes, renames, deletes or opens user font presets in `font-presets/`
 * (P9.1-T40). Built-in presets are immutable; custom presets are plain JSON files in the app data
 * folder, deleted via Recycle Bin.
 */

/** Raw font families for a preset id (empty strings for `system` so it inherits system stacks). */
function rawDataOf(id: string): FontPresetWriteData {
  const key = presetSlotKey(id)
  if (isBuiltInFontPreset(key)) {
    const builtIn = FONT_PRESETS[key]
    return {
      name: builtIn.label,
      heading: key === 'system' ? '' : builtIn.heading.name,
      body: key === 'system' ? '' : builtIn.body.name,
      code: key === 'system' ? '' : builtIn.code.name,
      size: builtIn.size,
      lineHeight: builtIn.lineHeight,
      codeSize: builtIn.codeSize,
      codeLineHeight: builtIn.codeLineHeight,
      headingScale: [...builtIn.headingScale],
      inlineCodeScale: builtIn.inlineCodeScale,
    }
  }
  const slot = userPresetSlotOf(id)
  if (slot?.ok === true) {
    return {
      name: slot.preset.label,
      heading: slot.raw.heading,
      body: slot.raw.body,
      code: slot.raw.code,
      size: slot.raw.size,
      lineHeight: slot.raw.lineHeight,
      codeSize: slot.raw.codeSize,
      codeLineHeight: slot.raw.codeLineHeight,
      headingScale: [...slot.raw.headingScale],
      inlineCodeScale: slot.raw.inlineCodeScale,
    }
  }
  return rawDataOf(DEFAULT_FONT_PRESET)
}

/** Snapshots the currently active preset merged with any Comfort base overrides in `settings.fonts`. */
export function currentEffectiveSnapshot(name: string): FontPresetWriteData {
  const basePreset = activeFontPreset.value
  const raw = rawDataOf(basePreset.id)
  const { base } = resolveFontMetrics(settings.fonts, basePreset)
  return {
    name,
    heading: settings.fonts.heading !== '' ? settings.fonts.heading : raw.heading,
    body: settings.fonts.body !== '' ? settings.fonts.body : raw.body,
    code: settings.fonts.code !== '' ? settings.fonts.code : raw.code,
    size: base.size,
    lineHeight: base.lineHeight,
    codeSize: base.codeSize,
    codeLineHeight: base.codeLineHeight,
    headingScale: [...base.headingScale],
    inlineCodeScale: inlineCodeScaleFor(basePreset, settings.fonts.body),
  }
}

function userLabels(exceptId?: string): string[] {
  const labels: string[] = []
  for (const slot of fontPresetSlots.value) {
    if (!slot.ok) continue
    if (exceptId !== undefined && presetSlotKey(slot.preset.id) === presetSlotKey(exceptId)) {
      continue
    }
    labels.push(slot.preset.label)
  }
  return labels
}

function writeNewPreset(data: FontPresetWriteData): Promise<string | null> {
  return enqueueFontPresetJob(async () => {
    try {
      const host = await getHost()
      const taken = new Set(fontPresetFileNames().map(presetSlotKey))
      const text = serializeFontPreset(data)
      for (let attempt = 0; attempt < 5; attempt++) {
        const stem = presetStem(data.name, taken)
        try {
          await host.fontPresetWrite(stem, text, true)
          noteFontPresetText(stem, text)
          return stem
        } catch (error) {
          if (errorKind(error) !== 'exists') throw error
          taken.add(presetSlotKey(stem))
        }
      }
      throw new Error('no free file name was found')
    } catch (error) {
      reportError(`Could not save font preset: ${describe(error)}`)
      return null
    }
  })
}

/** Suggests a unique copy name (`<label> copy`, `<label> copy 2`, ...). */
export function suggestPresetCopyName(ofId?: string): string {
  const label = ofId === undefined ? activeFontPreset.value.label : rawDataOf(ofId).name
  return copyPresetLabel(label, userLabels())
}

/** Creates a new custom preset starting from `'current'` effective settings or any preset id. */
export async function createFontPreset(rawName: string, from: string): Promise<Checked<string>> {
  const checked = checkPresetDisplayName(rawName, userLabels())
  if (!checked.ok) return checked
  const data =
    from === 'current'
      ? currentEffectiveSnapshot(checked.value)
      : { ...rawDataOf(from), name: checked.value }
  const id = await writeNewPreset(data)
  if (id === null) return { ok: false, why: 'The font preset could not be saved.' }
  await requestFontPreset(id)
  return { ok: true, value: id }
}

/** Duplicates a built-in or custom preset under `rawName` and selects it. */
export async function duplicateFontPreset(
  ofId: string | undefined,
  rawName: string,
): Promise<Checked<string>> {
  return createFontPreset(rawName, ofId ?? activeFontPreset.value.id)
}

/** Updates an existing custom preset file with the current effective Comfort settings and clears overrides. */
export async function updateFontPresetFromCurrent(id: string): Promise<boolean> {
  if (isBuiltInFontPreset(presetSlotKey(id))) return false
  const slot = userPresetSlotOf(id)
  if (slot?.ok !== true) return false
  const snapshot = currentEffectiveSnapshot(slot.preset.label)
  const text = serializeFontPreset(snapshot)
  const saved = await enqueueFontPresetJob(async () => {
    try {
      await (await getHost()).fontPresetWrite(slot.preset.id, text, false)
      noteFontPresetText(slot.preset.id, text)
      return true
    } catch (error) {
      reportError(`Could not update font preset: ${describe(error)}`)
      return false
    }
  })
  if (saved) await requestFontPreset(slot.preset.id)
  return saved
}

/** Renames a custom preset (updating both its `name` field and filename stem). */
export async function renameFontPreset(id: string, rawName: string): Promise<Checked<string>> {
  if (isBuiltInFontPreset(presetSlotKey(id))) {
    return { ok: false, why: 'A built-in preset cannot be renamed.' }
  }
  const checked = checkPresetDisplayName(rawName, userLabels(id))
  if (!checked.ok) return checked
  const label = checked.value
  const slot = userPresetSlotOf(id)
  if (slot?.ok !== true) {
    return { ok: false, why: 'The font preset is no longer available.' }
  }
  const currentId = slot.preset.id
  const inUse = presetSlotKey(settings.fonts.preset) === presetSlotKey(currentId)
  const nextData: FontPresetWriteData = { ...rawDataOf(currentId), name: label }
  const nextText = serializeFontPreset(nextData)

  const outcome = await holdFontPresetNotices(async () => {
    const stem = await enqueueFontPresetJob(async (): Promise<string | null> => {
      try {
        const host = await getHost()
        const others = new Set(fontPresetFileNames().map(presetSlotKey))
        others.delete(presetSlotKey(currentId))
        const target = presetStem(label, others)
        await host.fontPresetWrite(currentId, nextText, false)
        if (target !== currentId) {
          await host.fontPresetRename(currentId, target)
          dropFontPresetText(currentId)
        }
        noteFontPresetText(target, nextText)
        return target
      } catch (error) {
        reportError(`Could not rename font preset: ${describe(error)}`)
        return null
      }
    })
    if (stem !== null && inUse && stem !== currentId) {
      await requestFontPreset(stem)
    }
    return stem
  })
  return outcome === null
    ? { ok: false, why: 'The font preset could not be renamed.' }
    : { ok: true, value: outcome }
}

/** Moves a custom preset file to the Recycle Bin; switches active preset to `system` if deleted. */
export async function deleteFontPreset(id: string): Promise<boolean> {
  if (isBuiltInFontPreset(presetSlotKey(id))) return false
  const slot = userPresetSlotOf(id)
  const fileId = slot?.ok === true ? slot.preset.id : (slot?.id ?? id)
  const label = slot?.ok === true ? slot.preset.label : fileId
  const wasActive = presetSlotKey(settings.fonts.preset) === presetSlotKey(fileId)
  const gone = await holdFontPresetNotices(async () => {
    const done = await enqueueFontPresetJob(async () => {
      try {
        await (await getHost()).fontPresetDelete(fileId)
        dropFontPresetText(fileId)
        return true
      } catch (error) {
        reportError(`Could not move ${label} to the Recycle Bin: ${describe(error)}`)
        return false
      }
    })
    if (done && wasActive) await requestFontPreset(DEFAULT_FONT_PRESET)
    return done
  })
  if (gone) {
    reportWarning(
      `${label} is in the Recycle Bin.${wasActive ? ' The font preset is System now.' : ''}`,
    )
  }
  return gone
}

/** Opens the `font-presets/` folder in the OS file manager, creating it if missing. */
export async function openFontPresetsFolder(): Promise<void> {
  try {
    await (await getHost()).fontPresetsFolderOpen()
  } catch (error) {
    reportError(`Could not open the font-presets folder: ${describe(error)}`)
  }
}
