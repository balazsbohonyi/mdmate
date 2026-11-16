import { EditorView, ViewPlugin } from '@codemirror/view'
import type { Settings } from '@/lib/settings'
import { settings } from '@/lib/settings'

/**
 * The fonts of the document text, from `fonts.*` in settings.json. They reach the editor as CSS
 * custom properties on the page's root, which only the editor's theme reads: the title bar, menus,
 * tabs, sidebar and the Settings screen never use them, so they keep their own fonts. A change
 * takes effect with no restart: the properties are set again, and each open view is asked to
 * measure its text again.
 *
 * A family is written the way CSS does, one name or a list, and always followed by the built-in
 * stack, so an empty field, a name that is not installed and a name the browser cannot read each
 * fall back to the built-in look. Headings fall back to the body family.
 */

/** The family the editor's text has always had, which the built-in body stack is. */
export const BUILT_IN_BODY_FAMILY = 'monospace'
/** The family of code, as the theme tokens have it. */
export const BUILT_IN_CODE_FAMILY = 'var(--font-mono)'

/** Which kind of text a family is for. */
export type FontKind = 'heading' | 'body' | 'code'

/** The custom properties the editor's theme reads, all of them set by `applyDocumentFonts`. */
export const FONT_VARIABLES = {
  body: '--doc-font-body',
  heading: '--doc-font-heading',
  code: '--doc-font-code',
  size: '--doc-size',
  /**
   * The code size as a multiple of the text size (`codeSize / size`), not as px. Code takes it as
   * `calc(ratio * 1em)`, so code in body text is exactly `fonts.codeSize` and code in a heading
   * grows with the heading, as inline code always did (it was 0.92em).
   */
  codeRatio: '--doc-code-ratio',
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
 * the text would lose its font and not fall back to the built-in one; each name is quoted, except
 * the generic keywords, so that cannot happen. Empty gives empty.
 */
export function cssFamilyList(written: string): string {
  const names: string[] = []
  for (const part of written.split(',')) {
    const bare = part
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2')
      .replace(/^["']|["']$/g, '')
      .trim()
    if (bare === '') continue
    names.push(
      GENERIC_FAMILIES.has(bare.toLowerCase())
        ? bare.toLowerCase()
        : `"${bare.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`,
    )
  }
  return names.join(', ')
}

/**
 * The font stack for a kind of text, given what was written for it (empty for the built-in).
 * `bodyWritten` is what the body field holds: headings fall back to the body family, so they
 * follow a body family that was set.
 */
export function familyStack(kind: FontKind, written: string, bodyWritten = ''): string {
  const own = cssFamilyList(written)
  const fallback =
    kind === 'code'
      ? BUILT_IN_CODE_FAMILY
      : kind === 'heading'
        ? familyStack('body', bodyWritten)
        : BUILT_IN_BODY_FAMILY
  return own === '' ? fallback : `${own}, ${fallback}`
}

/** Every custom property and its value, for the fonts in force. */
export function documentFontVariables(
  fonts: Readonly<Settings['fonts']> = settings.fonts,
): Record<string, string> {
  const variables: Record<string, string> = {
    [FONT_VARIABLES.body]: familyStack('body', fonts.body),
    [FONT_VARIABLES.heading]: familyStack('heading', fonts.heading, fonts.body),
    [FONT_VARIABLES.code]: familyStack('code', fonts.code),
    [FONT_VARIABLES.size]: `${String(fonts.size)}px`,
    [FONT_VARIABLES.codeRatio]: String(fonts.codeSize / fonts.size),
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
