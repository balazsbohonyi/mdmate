/**
 * Curated Google Font presets for Markdown documents (P9.1-T38). All nine document typefaces ship
 * locally via Fontsource (`src/styles/fonts.css`) with OFL-1.1 notices in `public/fonts-LICENSE.txt`.
 * Pure TypeScript so `lib/`, `editor/` and `features/settings/` share one source of truth.
 */

export type FontPresetId = 'system' | 'editorial' | 'modern' | 'journal'

/** The valid preset ids in the order Settings displays them. */
export const FONT_PRESET_IDS: readonly FontPresetId[] = ['system', 'editorial', 'modern', 'journal']

/** The preset a fresh install uses, and what an unset `fonts.preset` falls back to. */
export const DEFAULT_FONT_PRESET: FontPresetId = 'system'

export interface FontPresetSlot {
  /** Human-readable display name shown in Settings and FontPicker. */
  readonly name: string
  /** CSS font-family stack ending in a guaranteed generic fallback. */
  readonly stack: string
}

export interface FontPreset {
  readonly id: FontPresetId
  readonly label: string
  readonly heading: FontPresetSlot
  readonly body: FontPresetSlot
  readonly code: FontPresetSlot
  /**
   * Optical multiplier (`em`) for inline code in this preset's body font so monospace x-height
   * visually aligns with surrounding prose while still scaling inside headings.
   */
  readonly inlineCodeScale: number
}

export const FONT_PRESETS: Readonly<Record<FontPresetId, FontPreset>> = {
  system: {
    id: 'system',
    label: 'System',
    heading: {
      name: 'System Monospace',
      stack: 'monospace',
    },
    body: {
      name: 'System Monospace',
      stack: 'monospace',
    },
    code: {
      name: 'System Code',
      stack: 'var(--font-mono)',
    },
    inlineCodeScale: 0.82,
  },
  editorial: {
    id: 'editorial',
    label: 'Editorial',
    heading: {
      name: 'Montserrat',
      stack: '"Montserrat Variable", "Montserrat", system-ui, sans-serif',
    },
    body: {
      name: 'Lora',
      stack: '"Lora Variable", "Lora", Georgia, serif',
    },
    code: {
      name: 'JetBrains Mono',
      stack: '"JetBrains Mono Variable", "JetBrains Mono", var(--font-mono)',
    },
    inlineCodeScale: 0.9,
  },
  modern: {
    id: 'modern',
    label: 'Modern',
    heading: {
      name: 'Raleway',
      stack: '"Raleway Variable", "Raleway", system-ui, sans-serif',
    },
    body: {
      name: 'Open Sans',
      stack: '"Open Sans Variable", "Open Sans", system-ui, sans-serif',
    },
    code: {
      name: 'Fira Code',
      stack: '"Fira Code Variable", "Fira Code", var(--font-mono)',
    },
    inlineCodeScale: 0.9,
  },
  journal: {
    id: 'journal',
    label: 'Journal',
    heading: {
      name: 'Oswald',
      stack: '"Oswald Variable", "Oswald", system-ui, sans-serif',
    },
    body: {
      name: 'Merriweather',
      stack: '"Merriweather Variable", "Merriweather", Georgia, serif',
    },
    code: {
      name: 'IBM Plex Mono',
      stack: '"IBM Plex Mono", var(--font-mono)',
    },
    inlineCodeScale: 0.9,
  },
}

/**
 * Bundled variable fonts register as `<Name> Variable` in Fontsource. Mapping the human-readable
 * display name to `[variable, display]` lets a user pick or type `"JetBrains Mono"` or
 * `"Montserrat"` and get the bundled font even when it is not installed on the OS.
 */
const BUNDLED_VARIABLE_FACES: ReadonlyMap<string, readonly [string, string]> = new Map([
  ['inter', ['Inter Variable', 'Inter']],
  ['montserrat', ['Montserrat Variable', 'Montserrat']],
  ['lora', ['Lora Variable', 'Lora']],
  ['raleway', ['Raleway Variable', 'Raleway']],
  ['open sans', ['Open Sans Variable', 'Open Sans']],
  ['oswald', ['Oswald Variable', 'Oswald']],
  ['merriweather', ['Merriweather Variable', 'Merriweather']],
  ['jetbrains mono', ['JetBrains Mono Variable', 'JetBrains Mono']],
  ['fira code', ['Fira Code Variable', 'Fira Code']],
])

/** All bundled font display names, sorted A to Z, merged into the Settings FontPicker list. */
export const BUNDLED_FONT_NAMES: readonly string[] = [
  'Fira Code',
  'IBM Plex Mono',
  'Inter',
  'JetBrains Mono',
  'Lora',
  'Merriweather',
  'Montserrat',
  'Open Sans',
  'Oswald',
  'Raleway',
]

/** Expands a bundled variable display name into `[variableName, displayName]`, else `[name]`. */
export function expandBundledFamily(name: string): readonly string[] {
  return BUNDLED_VARIABLE_FACES.get(name.trim().toLowerCase()) ?? [name]
}

/** Optical inline-code scale for known body fonts when selected as a custom override. */
const BODY_INLINE_CODE_SCALES: ReadonlyMap<string, number> = new Map([
  ['monospace', 0.82],
  ['courier new', 0.82],
  ['lora', 0.9],
  ['lora variable', 0.9],
  ['open sans', 0.9],
  ['open sans variable', 0.9],
  ['merriweather', 0.9],
  ['merriweather variable', 0.9],
])

/** Default optical inline-code scale for custom body fonts not in the known table. */
export const DEFAULT_CUSTOM_INLINE_CODE_SCALE = 0.9

/** The active preset record, falling back to `editorial` for safety. */
export function presetOf(id: FontPresetId): FontPreset {
  return FONT_PRESETS[id]
}

/**
 * Optical multiplier (`em`) for inline code, from the active preset when `bodyWritten` is empty,
 * or from the primary family of `bodyWritten` when overridden.
 */
export function inlineCodeScaleFor(presetId: FontPresetId, bodyWritten: string): number {
  const primary = bodyWritten
    .split(',')[0]
    ?.trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .replace(/^["']|["']$/g, '')
    .trim()
    .toLowerCase()
  if (primary === undefined || primary === '') return FONT_PRESETS[presetId].inlineCodeScale
  return BODY_INLINE_CODE_SCALES.get(primary) ?? DEFAULT_CUSTOM_INLINE_CODE_SCALE
}
