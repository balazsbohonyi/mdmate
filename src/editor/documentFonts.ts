import { EditorView, ViewPlugin } from '@codemirror/view'
import {
  cssFamilyList,
  DEFAULT_FONT_PRESET,
  FONT_PRESETS,
  inlineCodeScaleFor,
  presetOf,
  resolveFontMetrics,
  type FontPreset,
} from '@/lib/fontPresets'
import type { Settings } from '@/lib/settings'
import { settings } from '@/lib/settings'

export { cssFamilyList }

/**
 * The fonts of the document text, from `fonts.*` in settings.json. They reach the editor as CSS
 * custom properties on the page's root, which only the editor's theme reads: the title bar, menus,
 * tabs, sidebar and the Settings screen never use them, so they keep their own fonts. A change
 * takes effect with no restart: the properties are set again, and each open view is asked to
 * measure its text again.
 *
 * An empty family field uses the active preset's bundled stack (`fonts.preset`, defaulting to
 * Editorial). A written family or list is quoted (expanding bundled display names to their bundled
 * variable faces) and followed by the preset's stack, so an uninstalled or invalid name always
 * falls back cleanly.
 */

/** The default preset's heading, body and code stacks, used as theme `var()` fallbacks. */
export const BUILT_IN_HEADING_FAMILY = FONT_PRESETS[DEFAULT_FONT_PRESET].heading.stack
export const BUILT_IN_BODY_FAMILY = FONT_PRESETS[DEFAULT_FONT_PRESET].body.stack
export const BUILT_IN_CODE_FAMILY = FONT_PRESETS[DEFAULT_FONT_PRESET].code.stack

/** Which kind of text a family is for. */
export type FontKind = 'heading' | 'body' | 'code'

/** The custom properties the editor's theme reads, all of them set by `applyDocumentFonts`. */
export const FONT_VARIABLES = {
  body: '--doc-font-body',
  heading: '--doc-font-heading',
  code: '--doc-font-code',
  size: '--doc-size',
  /**
   * The code size as a multiple of the text size (`codeSize / size`), not as px. Code blocks and
   * plain-source / Raw Mode take it as `calc(ratio * 1em)` or `calc(ratio * var(--doc-size))`, so
   * they render at `fonts.codeSize`. Inline code never reads it (P9.1-T5).
   */
  codeRatio: '--doc-code-ratio',
  /**
   * Optical `em` multiplier for inline code (`0.82` for System/monospace, `0.9` for Lora, Open
   * Sans, Merriweather and custom body fonts) so monospace x-height aligns visually with
   * surrounding text while still scaling inside headings (P9.1-T38).
   */
  inlineCodeScale: '--doc-inline-code-scale',
  /**
   * The line heights, unitless so each line takes them times its own size: a heading and a list
   * item follow the body value, and code blocks / source mode read the code one (P9.1-T20, T38).
   */
  lineHeight: '--doc-line-height',
  codeLineHeight: '--doc-code-line-height',
  /**
   * The fill of every second body row of a table: the theme token when `editor.stripedTables` is
   * on, transparent when it is off (P9.1-T29). It rides with the fonts because the editor's theme
   * reads the same root properties and the views are asked to measure again together.
   */
  tableStripe: '--doc-table-stripe',
  headingScale: (level: number): string => `--doc-heading-${String(level)}`,
} as const

/** Resolver for looking up the active preset by id (overridden by custom preset store in T40). */
let resolvePresetById: (id: string) => FontPreset = presetOf

/** Installs a custom preset lookup so `src/editor/` stays Vue-free while reading user presets. */
export function setFontPresetResolver(resolver: (id: string) => FontPreset): void {
  resolvePresetById = resolver
}

/**
 * The font stack for a kind of text, given what was written for it (empty for the active preset's
 * stack).
 */
export function familyStack(
  kind: FontKind,
  written: string,
  presetOrId: FontPreset | string = DEFAULT_FONT_PRESET,
): string {
  const own = cssFamilyList(written)
  const preset = typeof presetOrId === 'string' ? resolvePresetById(presetOrId) : presetOrId
  const fallback = preset[kind].stack
  return own === '' ? fallback : `${own}, ${fallback}`
}

/** Every custom property and its value, for the fonts in force. */
export function documentFontVariables(
  fonts: Readonly<Settings['fonts']> = settings.fonts,
  editor: Readonly<Settings['editor']> = settings.editor,
  preset: FontPreset = resolvePresetById(fonts.preset),
): Record<string, string> {
  const { effective } = resolveFontMetrics(fonts, preset)
  const variables: Record<string, string> = {
    [FONT_VARIABLES.body]: familyStack('body', fonts.body, preset),
    [FONT_VARIABLES.heading]: familyStack('heading', fonts.heading, preset),
    [FONT_VARIABLES.code]: familyStack('code', fonts.code, preset),
    [FONT_VARIABLES.size]: `${String(effective.size)}px`,
    [FONT_VARIABLES.codeRatio]: String(effective.codeSize / effective.size),
    [FONT_VARIABLES.inlineCodeScale]: String(inlineCodeScaleFor(preset, fonts.body)),
    [FONT_VARIABLES.lineHeight]: String(effective.lineHeight),
    [FONT_VARIABLES.codeLineHeight]: String(effective.codeLineHeight),
    [FONT_VARIABLES.tableStripe]: editor.stripedTables ? 'var(--table-stripe)' : 'transparent',
  }
  effective.headingScale.forEach((multiplier, index) => {
    variables[FONT_VARIABLES.headingScale(index + 1)] = String(multiplier)
  })
  return variables
}

/**
 * Sets the custom properties on the page's root from the live settings. Without a page (the store
 * also runs in tests that have none) there is nothing to set.
 */
export function applyDocumentFonts(
  target: HTMLElement | undefined = typeof document === 'undefined'
    ? undefined
    : document.documentElement,
): void {
  if (target === undefined) return
  for (const [name, value] of Object.entries(documentFontVariables())) {
    target.style.setProperty(name, value)
  }
}

const views = new Set<EditorView>()

/** Tracks the views that show a state with this extension, so a change of font reaches them. */
const tracker = ViewPlugin.define((view) => {
  views.add(view)
  return {
    destroy() {
      views.delete(view)
    },
  }
})

export const documentFonts = [tracker]

/** Asks every open view to measure its text again: a new font changes every width and height. */
export function refreshDocumentFonts(): void {
  for (const view of views) view.requestMeasure()
}

/** What was last set, so a change of another setting does not make every view measure again. */
let applied = ''

/** Sets the properties from the live settings and tells the open views, when they changed. */
export function updateDocumentFonts(): void {
  const key = JSON.stringify(documentFontVariables())
  if (key === applied) return
  applied = key
  applyDocumentFonts()
  refreshDocumentFonts()
}

/** Forgets what was set and takes the properties off the root, for a test. */
export function resetDocumentFonts(
  target: HTMLElement | undefined = typeof document === 'undefined'
    ? undefined
    : document.documentElement,
): void {
  applied = ''
  if (target === undefined) return
  for (const name of Object.keys(documentFontVariables())) target.style.removeProperty(name)
}
