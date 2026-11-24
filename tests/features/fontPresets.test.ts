// @vitest-environment jsdom
/**
 * Custom user font presets store & management (P9.1-T40, ISC-730 & ISC-731): loading at startup,
 * fallback to `system` on missing/broken ids, live reload on folder changes, and create /
 * duplicate / update-from-current / rename / delete (Recycle Bin + active fallback).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watch } from 'vue'
import { resetDocumentFonts } from '@/editor/documentFonts'
import {
  createFontPreset,
  deleteFontPreset,
  duplicateFontPreset,
  renameFontPreset,
  updateFontPresetFromCurrent,
} from '@/features/fontPresets/manage'
import {
  activeFontPreset,
  fontPresetProblem,
  fontPresetSlots,
  loadFontPresets,
  resetFontPresetsState,
  watchFontPresetsFolder,
} from '@/features/fontPresets/store'
import {
  changeSetting,
  loadSettings,
  resetSettingsState,
  settledSettings,
} from '@/features/settings/store'
import { serializeFontPreset } from '@/lib/fontPresetFile'
import { PRESET_HEADING_SCALE } from '@/lib/fontPresets'
import { resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import {
  createMockHost,
  MOCK_FONT_PRESETS_FOLDER,
  MOCK_SETTINGS_FILE,
  type MockHost,
} from '@/platform/mock'
import { toasts } from '../helpers/toasts'

let host: MockHost
let stopWatch: (() => void) | undefined

async function start(files: Record<string, string> = {}): Promise<void> {
  host = createMockHost({ files })
  setHost(host)
  await loadSettings()
  await loadFontPresets()
}

beforeEach(() => {
  toasts.clear()
  resetSettings()
  resetSettingsState()
  resetFontPresetsState()
  resetDocumentFonts()
})

afterEach(() => {
  stopWatch?.()
  stopWatch = undefined
  setHost(undefined)
})

describe('ISC-730: custom preset loading, live reload and fallback', () => {
  it('loads custom presets at startup and applies them to document CSS properties', async () => {
    const presetText = serializeFontPreset({
      name: 'Bookish',
      heading: 'Montserrat',
      body: 'Georgia',
      code: 'JetBrains Mono',
      size: 19,
      lineHeight: 1.7,
      codeSize: 15,
      codeLineHeight: 1.5,
      headingScale: PRESET_HEADING_SCALE,
    })
    await start({
      [`${MOCK_FONT_PRESETS_FOLDER}/Bookish.json`]: presetText,
      [MOCK_SETTINGS_FILE]: JSON.stringify({ fonts: { preset: 'Bookish' } }),
    })

    expect(activeFontPreset.value.id).toBe('Bookish')
    expect(activeFontPreset.value.label).toBe('Bookish')
    expect(activeFontPreset.value.builtIn).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--doc-size')).toBe('19px')
    expect(document.documentElement.style.getPropertyValue('--doc-line-height')).toBe('1.7')
    expect(document.documentElement.style.getPropertyValue('--doc-font-body')).toContain(
      '"Georgia"',
    )
  })

  it('falls back to system with a notice when a selected custom preset is missing or broken, leaving settings.json untouched', async () => {
    const original = JSON.stringify({ fonts: { preset: 'Missing Preset' } })
    await start({ [MOCK_SETTINGS_FILE]: original })

    expect(activeFontPreset.value.id).toBe('system')
    expect(fontPresetProblem.value).toContain('Missing Preset')
    expect(host.files.read(MOCK_SETTINGS_FILE)).toBe(original)

    await start({
      [`${MOCK_FONT_PRESETS_FOLDER}/Broken.json`]: '{ bad json',
      [MOCK_SETTINGS_FILE]: JSON.stringify({ fonts: { preset: 'Broken' } }),
    })
    expect(activeFontPreset.value.id).toBe('system')
    expect(fontPresetProblem.value).toContain('Broken')
    expect(fontPresetSlots.value.some((slot) => !slot.ok && slot.id === 'Broken')).toBe(true)
  })

  it('live-reloads when a preset file changes in font-presets/', async () => {
    await start({
      [`${MOCK_FONT_PRESETS_FOLDER}/Live.json`]: serializeFontPreset({
        name: 'Live',
        heading: 'Montserrat',
        body: 'Lora',
        code: 'JetBrains Mono',
        size: 18,
        lineHeight: 1.6,
        codeSize: 14,
        codeLineHeight: 1.5,
        headingScale: PRESET_HEADING_SCALE,
      }),
      [MOCK_SETTINGS_FILE]: JSON.stringify({ fonts: { preset: 'Live' } }),
    })
    stopWatch = await watchFontPresetsFolder()
    expect(document.documentElement.style.getPropertyValue('--doc-size')).toBe('18px')

    host.files.write(
      `${MOCK_FONT_PRESETS_FOLDER}/Live.json`,
      serializeFontPreset({
        name: 'Live',
        heading: 'Montserrat',
        body: 'Lora',
        code: 'JetBrains Mono',
        size: 21,
        lineHeight: 1.75,
        codeSize: 14,
        codeLineHeight: 1.5,
        headingScale: PRESET_HEADING_SCALE,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.documentElement.style.getPropertyValue('--doc-size')).toBe('21px')
    expect(document.documentElement.style.getPropertyValue('--doc-line-height')).toBe('1.75')
  })
})

describe('ISC-731: create, duplicate, update, rename and delete custom presets', () => {
  it('creates, updates from current overrides, duplicates, renames, and deletes to Recycle Bin', async () => {
    await start({
      [MOCK_SETTINGS_FILE]: JSON.stringify({
        fonts: { preset: 'editorial', body: 'Georgia', size: 20 },
      }),
    })

    // Create from current settings snapshots effective base values and clears overrides.
    const created = await createFontPreset('My Study', 'current')
    await settledSettings()
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(settings.fonts.preset).toBe(created.value)
    expect(settings.fonts.body).toBe('')
    expect(settings.fonts.size).toBeNull()
    expect(activeFontPreset.value.label).toBe('My Study')
    expect(activeFontPreset.value.size).toBe(20)

    // Override size and update preset from current settings.
    await changeSetting('fonts.size', 22)
    expect(await updateFontPresetFromCurrent(created.value)).toBe(true)
    await settledSettings()
    expect(settings.fonts.size).toBeNull()
    expect(activeFontPreset.value.size).toBe(22)

    // Duplicate into a copy.
    const copy = await duplicateFontPreset(created.value, 'My Study copy')
    await settledSettings()
    expect(copy.ok).toBe(true)
    if (!copy.ok) return
    expect(settings.fonts.preset).toBe(copy.value)
    expect(activeFontPreset.value.size).toBe(22)

    // Rename active preset updates both file and settings.fonts.preset.
    const renamed = await renameFontPreset(copy.value, 'Evening Serif')
    await settledSettings()
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(settings.fonts.preset).toBe(renamed.value)
    expect(activeFontPreset.value.label).toBe('Evening Serif')

    // Delete active preset moves it to Recycle Bin and falls back to System.
    expect(await deleteFontPreset(renamed.value)).toBe(true)
    await settledSettings()
    expect(settings.fonts.preset).toBe('system')
    expect(host.recycled.some((entry) => entry.path.includes('Evening Serif.json'))).toBe(true)
  })

  it('ISC-737: never flashes a missing-preset error in fontPresetProblem while renaming the active preset', async () => {
    await start({
      [`${MOCK_FONT_PRESETS_FOLDER}/Old Name.json`]: serializeFontPreset({
        name: 'Old Name',
        heading: 'Montserrat',
        body: 'Lora',
        code: 'JetBrains Mono',
        size: 18,
        lineHeight: 1.6,
        codeSize: 14,
        codeLineHeight: 1.5,
        headingScale: PRESET_HEADING_SCALE,
      }),
      [MOCK_SETTINGS_FILE]: JSON.stringify({ fonts: { preset: 'Old Name' } }),
    })

    const observed: (string | null)[] = []
    const stop = watch(
      fontPresetProblem,
      (value) => {
        observed.push(value)
      },
      { flush: 'sync', immediate: true },
    )
    try {
      const renamed = await renameFontPreset('Old Name', 'New Name')
      await settledSettings()
      expect(renamed).toEqual({ ok: true, value: 'New Name' })
      expect(observed.every((msg) => msg === null)).toBe(true)
    } finally {
      stop()
    }
  })
})
