// @vitest-environment jsdom
/**
 * Preset cards UI (P9.1-T40, ISC-732 & ISC-733): filter box, capped scrollable grid, Built-in
 * badges, contextual Update/Save-as-new/New toolbar, card ellipsis menu (Duplicate, Reset
 * overrides, Update from current, inline Rename, confirmed Delete) without selecting the card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resetDocumentFonts } from '@/editor/documentFonts'
import { loadFontPresets, resetFontPresetsState } from '@/features/fontPresets/store'
import FontPresetCards from '@/features/settings/FontPresetCards.vue'
import { loadSettings, resetSettingsState, settledSettings } from '@/features/settings/store'
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
let app: App | undefined
let root: HTMLElement | undefined
let selected: string[] = []

async function flush(): Promise<void> {
  await settledSettings()
  await new Promise((resolve) => setTimeout(resolve, 15))
  await nextTick()
  await nextTick()
}

async function mountCards(
  files: Record<string, string> = {},
  props: { customized?: boolean } = {},
): Promise<void> {
  host = createMockHost({ files })
  setHost(host)
  await loadSettings()
  await loadFontPresets()
  app?.unmount()
  root?.remove()
  selected = []
  root = document.createElement('div')
  document.body.append(root)
  app = createApp({
    render: () =>
      h(TooltipProvider, {}, () =>
        h(FontPresetCards, {
          modelValue: settings.fonts.preset,
          customized: props.customized ?? false,
          density: settings.fonts.density,
          onSelect: (id: string) => {
            selected.push(id)
          },
        }),
      ),
  })
  app.mount(root)
  await flush()
}

beforeEach(() => {
  document.body.innerHTML = ''
  toasts.clear()
  resetSettings()
  resetSettingsState()
  resetFontPresetsState()
  resetDocumentFonts()
})

afterEach(() => {
  app?.unmount()
  app = undefined
  root?.remove()
  root = undefined
  setHost(undefined)
})

describe('ISC-732: filter, scrollable grid, Built-in badges and toolbar', () => {
  it('renders a capped scrollable grid, Built-in badges on built-ins only, and filters by name or font', async () => {
    const customText = serializeFontPreset({
      name: 'Nordic Note',
      heading: 'Georgia',
      body: 'Verdana',
      code: 'Fira Code',
      size: 18,
      lineHeight: 1.6,
      codeSize: 14,
      codeLineHeight: 1.5,
      headingScale: PRESET_HEADING_SCALE,
    })
    await mountCards({ [`${MOCK_FONT_PRESETS_FOLDER}/Nordic Note.json`]: customText })

    const grid = document.querySelector<HTMLElement>('[data-font-preset-cards]')
    expect(grid?.className).toContain('overflow-y-auto')
    expect(grid?.className).toContain('max-h-')

    for (const id of ['system', 'editorial', 'modern', 'journal']) {
      expect(
        document.querySelector(`[data-font-preset-card="${id}"] [data-font-preset-builtin]`),
        id,
      ).not.toBeNull()
    }
    expect(
      document.querySelector('[data-font-preset-card="Nordic Note"] [data-font-preset-builtin]'),
    ).toBeNull()

    // Filter by font name matches Editorial (Lora) only.
    const filter = document.querySelector<HTMLInputElement>('[data-font-preset-filter]')
    expect(filter).not.toBeNull()
    if (filter === null) return
    filter.value = 'lora'
    filter.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const visible = [...document.querySelectorAll<HTMLElement>('[data-font-preset-card]')].map(
      (el) => el.dataset.fontPresetCard,
    )
    expect(visible).toEqual(['editorial'])

    // Filter by custom preset name matches Nordic Note.
    filter.value = 'nordic'
    filter.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const visibleCustom = [
      ...document.querySelectorAll<HTMLElement>('[data-font-preset-card]'),
    ].map((el) => el.dataset.fontPresetCard)
    expect(visibleCustom).toEqual(['Nordic Note'])
  })

  it('shows New preset always, Save as new when customized, and Update preset only for customized custom presets', async () => {
    const customText = serializeFontPreset({
      name: 'Studio',
      heading: 'Montserrat',
      body: 'Lora',
      code: 'JetBrains Mono',
      size: 18,
      lineHeight: 1.6,
      codeSize: 14,
      codeLineHeight: 1.5,
      headingScale: PRESET_HEADING_SCALE,
    })
    await mountCards(
      {
        [`${MOCK_FONT_PRESETS_FOLDER}/Studio.json`]: customText,
        [MOCK_SETTINGS_FILE]: JSON.stringify({ fonts: { preset: 'editorial' } }),
      },
      { customized: true },
    )
    expect(document.querySelector('[data-font-preset-new]')).not.toBeNull()
    expect(document.querySelector('[data-font-preset-save-new]')).not.toBeNull()
    expect(document.querySelector('[data-font-preset-update]')).toBeNull()

    await mountCards(
      {
        [`${MOCK_FONT_PRESETS_FOLDER}/Studio.json`]: customText,
        [MOCK_SETTINGS_FILE]: JSON.stringify({ fonts: { preset: 'Studio' } }),
      },
      { customized: true },
    )
    expect(document.querySelector('[data-font-preset-update]')).not.toBeNull()
    expect(document.querySelector('[data-font-preset-save-new]')).not.toBeNull()
  })
})

describe('ISC-733: card ellipsis menu does not select card and exposes built-in vs custom actions', () => {
  it('clicking the ellipsis trigger does not emit select', async () => {
    await mountCards()
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-font-preset-card="editorial"] [data-font-preset-menu]',
    )
    expect(trigger).not.toBeNull()
    trigger?.click()
    await nextTick()
    expect(selected).toEqual([])
  })

  it('creates a new custom preset via the inline form and validates built-in name collisions', async () => {
    await mountCards()
    const newBtn = document.querySelector<HTMLButtonElement>('[data-font-preset-new]')
    newBtn?.click()
    await nextTick()
    const input = document.querySelector<HTMLInputElement>('[data-font-preset-name-input]')
    const form = document.querySelector<HTMLFormElement>('[data-font-preset-form]')
    expect(input).not.toBeNull()
    expect(form).not.toBeNull()
    if (input === null || form === null) return

    // Built-in name collision is refused inline.
    input.value = 'Editorial'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    expect(document.querySelector('[data-font-preset-form-error]')?.textContent).toContain(
      'built-in',
    )

    // Valid name creates and selects the preset, closing the form.
    input.value = 'Atelier'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    expect(document.querySelector('[data-font-preset-form]')).toBeNull()
    expect(settings.fonts.preset).toBe('Atelier')
    expect(document.querySelector('[data-font-preset-card="Atelier"]')).not.toBeNull()
  })

  it('opens the ellipsis menu on custom cards with the right actions, and deletes via confirmation', async () => {
    const customText = serializeFontPreset({
      name: 'Studio',
      heading: 'Montserrat',
      body: 'Lora',
      code: 'JetBrains Mono',
      size: 18,
      lineHeight: 1.6,
      codeSize: 14,
      codeLineHeight: 1.5,
      headingScale: PRESET_HEADING_SCALE,
    })
    await mountCards(
      {
        [`${MOCK_FONT_PRESETS_FOLDER}/Studio.json`]: customText,
        [MOCK_SETTINGS_FILE]: JSON.stringify({ fonts: { preset: 'Studio' } }),
      },
      { customized: true },
    )

    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-font-preset-card="Studio"] [data-font-preset-menu]',
    )
    if (trigger === null) throw new Error('no menu on Studio')
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
    await flush()
    const customActions = [
      ...document.querySelectorAll<HTMLElement>('[data-font-preset-action]'),
    ].map((el) => el.dataset.fontPresetAction ?? '')
    expect(customActions).toEqual(['update', 'duplicate', 'rename', 'delete'])

    // Click Delete → confirmation dialog opens → confirm deletes to Recycle Bin & falls back to system.
    const deleteItem = document.querySelector<HTMLElement>('[data-font-preset-action="delete"]')
    deleteItem?.click()
    await flush()
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-font-preset-delete-confirm]',
    )
    expect(confirmBtn).not.toBeNull()
    confirmBtn?.click()
    await flush()
    expect(settings.fonts.preset).toBe('system')
    expect(document.querySelector('[data-font-preset-card="Studio"]')).toBeNull()
  })
})

describe('ISC-738, ISC-739, ISC-740: active scroll, scroll-only bar and 3-column desktop grid', () => {
  const presetJson = (name: string): string =>
    serializeFontPreset({
      name,
      heading: 'Montserrat',
      body: 'Lora',
      code: 'JetBrains Mono',
      size: 18,
      lineHeight: 1.6,
      codeSize: 14,
      codeLineHeight: 1.5,
      headingScale: PRESET_HEADING_SCALE,
    })

  it('ISC-740: stays 2 columns with 5 presets and switches to 3 columns on desktop with 6+ presets', async () => {
    await mountCards({ [`${MOCK_FONT_PRESETS_FOLDER}/One.json`]: presetJson('One') })
    expect(document.querySelector('[data-font-preset-cards]')?.className).not.toContain(
      '@[46rem]:grid-cols-3',
    )

    await mountCards({
      [`${MOCK_FONT_PRESETS_FOLDER}/One.json`]: presetJson('One'),
      [`${MOCK_FONT_PRESETS_FOLDER}/Two.json`]: presetJson('Two'),
    })
    expect(document.querySelector('[data-font-preset-cards]')?.className).toContain(
      '@[46rem]:grid-cols-3',
    )
  })

  it('ISC-739: sets data-scrolling="true" on user scroll and clears it after idle', async () => {
    await mountCards()
    const grid = document.querySelector<HTMLElement>('[data-font-preset-cards]')
    if (grid === null) throw new Error('no grid')
    expect(grid.dataset.scrolling).toBeUndefined()
    grid.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(grid.dataset.scrolling).toBe('true')
    await new Promise((resolve) => setTimeout(resolve, 900))
    await nextTick()
    expect(grid.dataset.scrolling).toBeUndefined()
  })

  it('ISC-738: scrolls the active preset card into view inside the grid on mount without flashing data-scrolling', async () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.hasAttribute('data-font-preset-cards')) {
          return {
            top: 0,
            bottom: 400,
            height: 400,
            left: 0,
            right: 800,
            width: 800,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          }
        }
        if (this.dataset.fontPresetCard === 'Zeta') {
          return {
            top: 520,
            bottom: 720,
            height: 200,
            left: 0,
            right: 380,
            width: 380,
            x: 0,
            y: 520,
            toJSON: () => ({}),
          }
        }
        return {
          top: 0,
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }
      })
    try {
      await mountCards({
        [`${MOCK_FONT_PRESETS_FOLDER}/Zeta.json`]: presetJson('Zeta'),
        [MOCK_SETTINGS_FILE]: JSON.stringify({ fonts: { preset: 'Zeta' } }),
      })
      const grid = document.querySelector<HTMLElement>('[data-font-preset-cards]')
      expect(grid).not.toBeNull()
      expect(grid?.scrollTop).toBeGreaterThan(0)
      expect(grid?.dataset.scrolling).toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })
})
