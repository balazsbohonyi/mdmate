import { EditorView, ViewPlugin } from '@codemirror/view'
import {
  DEFAULT_FONT_PRESET,
  expandBundledFamily,
  FONT_PRESETS,
  inlineCodeScaleFor,
  type FontPresetId,
} from '@/lib/fontPresets'
import type { Settings } from '@/lib/settings'
import { settings } from '@/lib/settings'

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
 * What was written in a family field, as a list CSS always accepts. A name that is not a valid CSS
 * identifier (it starts with a digit, holds a symbol) would make the whole declaration invalid, and
 * the text would lose its font and not fall back; each name is quoted, except the generic keywords.
 * Bundled variable display names expand to include their bundled variable face. Empty gives empty.
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

/**
 * The font stack for a kind of text, given what was written for it (empty for the active preset's
 * bundled stack).
 */
export function familyStack(
  kind: FontKind,
  written: string,
  presetId: FontPresetId = DEFAULT_FONT_PRESET,
): string {
  const own = cssFamilyList(written)
  const fallback = FONT_PRESETS[presetId][kind].stack
  return own === '' ? fallback : `${own}, ${fallback}`
}

/** Every custom property and its value, for the fonts in force. */
export function documentFontVariables(
  fonts: Readonly<Settings['fonts']> = settings.fonts,
  editor: Readonly<Settings['editor']> = settings.editor,
): Record<string, string> {
  const variables: Record<string, string> = {
    [FONT_VARIABLES.body]: familyStack('body', fonts.body, fonts.preset),
    [FONT_VARIABLES.heading]: familyStack('heading', fonts.heading, fonts.preset),
    [FONT_VARIABLES.code]: familyStack('code', fonts.code, fonts.preset),
    [FONT_VARIABLES.size]: `${String(fonts.size)}px`,
    [FONT_VARIABLES.codeRatio]: String(fonts.codeSize / fonts.size),
    [FONT_VARIABLES.inlineCodeScale]: String(inlineCodeScaleFor(fonts.preset, fonts.body)),
    [FONT_VARIABLES.lineHeight]: String(fonts.lineHeight),
    [FONT_VARIABLES.codeLineHeight]: String(fonts.codeLineHeight),
    [FONT_VARIABLES.tableStripe]: editor.stripedTables ? 'var(--table-stripe)' : 'transparent',
  }
  fonts.headingScale.forEach((multiplier, index) => {
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
