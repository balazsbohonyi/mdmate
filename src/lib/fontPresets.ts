/**
 * Curated font presets for Markdown documents (P9.1-T38, P9.1-T39). All nine Google document
 * typefaces ship locally via Fontsource (`src/styles/fonts.css`) with OFL-1.1 notices in
 * `public/fonts-LICENSE.txt`. Pure TypeScript so `lib/`, `editor/` and `features/settings/` share
 * one source of truth.
 */

export type BuiltInFontPresetId = 'system' | 'editorial' | 'modern' | 'journal'

/** Built-in or custom font preset id (`system`, `editorial`, `modern`, `journal`, or file stem). */
export type FontPresetId = string

/** The built-in preset ids in the order Settings displays them. */
export const FONT_PRESET_IDS: readonly BuiltInFontPresetId[] = [
  'system',
  'editorial',
  'modern',
  'journal',
]

/** The preset a fresh install uses, and what an unset `fonts.preset` falls back to. */
export const DEFAULT_FONT_PRESET: BuiltInFontPresetId = 'system'

/** Typography density mode: Comfort uses preset/base sizes; Compact scales sizes & line heights down. */
export type FontDensity = 'comfort' | 'compact'

export const FONT_DENSITIES: readonly FontDensity[] = ['comfort', 'compact']

export const DEFAULT_FONT_DENSITY: FontDensity = 'comfort'

/** The heading sizes the editor has always had, as multiples of the body size, H1 to H6. */
export const PRESET_HEADING_SCALE: readonly number[] = [1.7, 1.45, 1.25, 1.1, 1, 0.95]

export interface FontMetrics {
  readonly size: number
  readonly lineHeight: number
  readonly codeSize: number
  readonly codeLineHeight: number
  readonly headingScale: readonly number[]
}

export interface FontPresetSlot {
  /** Human-readable display name shown in Settings and FontPicker. */
  readonly name: string
  /** CSS font-family stack ending in a guaranteed generic fallback. */
  readonly stack: string
}

export interface FontPreset extends FontMetrics {
  readonly id: string
  readonly label: string
  readonly builtIn: boolean
  readonly heading: FontPresetSlot
  readonly body: FontPresetSlot
  readonly code: FontPresetSlot
  /**
   * Optical multiplier (`em`) for inline code in this preset's body font so monospace x-height
   * visually aligns with surrounding prose while still scaling inside headings.
   */
  readonly inlineCodeScale: number
}

export const FONT_PRESETS: Readonly<Record<BuiltInFontPresetId, FontPreset>> = {
  system: {
    id: 'system',
    label: 'System',
    builtIn: true,
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
    size: 16,
    lineHeight: 1.5,
    codeSize: 14,
    codeLineHeight: 1.5,
    headingScale: PRESET_HEADING_SCALE,
    inlineCodeScale: 0.82,
  },
  editorial: {
    id: 'editorial',
    label: 'Editorial',
    builtIn: true,
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
    size: 18,
    lineHeight: 1.6,
    codeSize: 14,
    codeLineHeight: 1.5,
    headingScale: PRESET_HEADING_SCALE,
    inlineCodeScale: 0.9,
  },
  modern: {
    id: 'modern',
    label: 'Modern',
    builtIn: true,
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
    size: 17,
    lineHeight: 1.6,
    codeSize: 14,
    codeLineHeight: 1.5,
    headingScale: PRESET_HEADING_SCALE,
    inlineCodeScale: 0.9,
  },
  journal: {
    id: 'journal',
    label: 'Journal',
    builtIn: true,
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
    size: 18,
    lineHeight: 1.6,
    codeSize: 14,
    codeLineHeight: 1.5,
    headingScale: PRESET_HEADING_SCALE,
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

/** The family names CSS reads as keywords: they are never quoted. */
const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
])

/**
 * Formats a written font family or comma-separated list into CSS-safe quoted names (expanding
 * bundled variable display names to include their bundled variable face). Empty gives empty.
 */
export function cssFamilyList(written: string): string {
  const names: string[] = []
  const seen = new Set<string>()
  for (const part of written.split(',')) {
    const bare = part
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2')
      .replace(/^["']|["']$/g, '')
      .trim()
    if (bare === '') continue
    const lower = bare.toLowerCase()
    if (GENERIC_FAMILIES.has(lower)) {
      if (!seen.has(lower)) {
        seen.add(lower)
        names.push(lower)
      }
      continue
    }
    for (const expanded of expandBundledFamily(bare)) {
      const key = expanded.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      names.push(`"${expanded.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)
    }
  }
  return names.join(', ')
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

/** Whether `id` is one of the built-in presets. */
export function isBuiltInFontPreset(id: string): id is BuiltInFontPresetId {
  return Object.hasOwn(FONT_PRESETS, id)
}

/** The built-in preset record, falling back to `system` for safety. */
export function presetOf(id: string): FontPreset {
  return isBuiltInFontPreset(id) ? FONT_PRESETS[id] : FONT_PRESETS[DEFAULT_FONT_PRESET]
}

/** Compact pixel size: ×0.86 rounded to whole px, minimum 10px (16→14, 17→15, 18→15, 20→17, 14→12). */
export function compactSize(px: number): number {
  return Math.max(10, Math.round(px * 0.86))
}

/** Compact line height: −0.1 snapped to 0.05 steps, minimum 1.15 (1.6→1.5, 1.5→1.4, 1.4→1.3). */
export function compactLineHeight(lineHeight: number): number {
  return Math.max(1.15, Math.round((lineHeight - 0.1) * 20) / 20)
}

/** Applies Comfort or Compact density to base font metrics without mutating them. */
export function applyDensity(metrics: FontMetrics, density: FontDensity): FontMetrics {
  if (density === 'comfort') return metrics
  return {
    size: compactSize(metrics.size),
    lineHeight: compactLineHeight(metrics.lineHeight),
    codeSize: compactSize(metrics.codeSize),
    codeLineHeight: compactLineHeight(metrics.codeLineHeight),
    headingScale: metrics.headingScale,
  }
}

/** Shape of `settings.fonts` read by `resolveFontMetrics`. */
export interface FontSettingsInput {
  readonly preset: string
  readonly density: FontDensity
  readonly heading: string
  readonly body: string
  readonly code: string
  readonly size: number | null
  readonly lineHeight: number | null
  readonly codeSize: number | null
  readonly codeLineHeight: number | null
  readonly headingScale: readonly number[] | null
}

/** Base (Comfort) metrics, density-adjusted effective metrics, and whether any override is active. */
export interface ResolvedFontMetrics {
  readonly base: FontMetrics
  readonly effective: FontMetrics
  readonly customized: boolean
}

/**
 * Resolves nullable size/line-height/heading-scale overrides against `preset`, applies `density`
 * live to produce `effective`, and reports whether any of the 8 font/metric override keys is set.
 */
export function resolveFontMetrics(
  fonts: FontSettingsInput,
  preset: FontPreset,
): ResolvedFontMetrics {
  const base: FontMetrics = {
    size: fonts.size ?? preset.size,
    lineHeight: fonts.lineHeight ?? preset.lineHeight,
    codeSize: fonts.codeSize ?? preset.codeSize,
    codeLineHeight: fonts.codeLineHeight ?? preset.codeLineHeight,
    headingScale: fonts.headingScale ?? preset.headingScale,
  }
  const customized =
    fonts.heading !== '' ||
    fonts.body !== '' ||
    fonts.code !== '' ||
    fonts.size !== null ||
    fonts.lineHeight !== null ||
    fonts.codeSize !== null ||
    fonts.codeLineHeight !== null ||
    fonts.headingScale !== null
  return {
    base,
    effective: applyDensity(base, fonts.density),
    customized,
  }
}

/** Optical inline-code scale derived purely from a written body font name or stack. */
export function inlineCodeScaleForBody(bodyWritten: string): number {
  const primary = bodyWritten
    .split(',')[0]
    ?.trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .replace(/^["']|["']$/g, '')
    .trim()
    .toLowerCase()
  if (primary === undefined || primary === '')
    return FONT_PRESETS[DEFAULT_FONT_PRESET].inlineCodeScale
  return BODY_INLINE_CODE_SCALES.get(primary) ?? DEFAULT_CUSTOM_INLINE_CODE_SCALE
}

/**
 * Optical multiplier (`em`) for inline code, from the active preset when `bodyWritten` is empty,
 * or from the primary family of `bodyWritten` when overridden.
 */
export function inlineCodeScaleFor(presetOrId: FontPreset | string, bodyWritten: string): number {
  const preset = typeof presetOrId === 'string' ? presetOf(presetOrId) : presetOrId
  const primary = bodyWritten
    .split(',')[0]
    ?.trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .replace(/^["']|["']$/g, '')
    .trim()
    .toLowerCase()
  if (primary === undefined || primary === '') return preset.inlineCodeScale
  return BODY_INLINE_CODE_SCALES.get(primary) ?? DEFAULT_CUSTOM_INLINE_CODE_SCALE
}
