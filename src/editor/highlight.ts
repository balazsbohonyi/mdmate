/**
 * The colors of syntax. Every rule names a theme token (`--syntax-*`, defined for the light and
 * the dark theme in `src/styles/themes/`), never a color, so a theme change recolors code and
 * Markdown together and `tests/editor/highlight.test.ts` can check that every token exists.
 *
 * It styles the tags the language packages produce, whichever language they come from, so a
 * fenced block in any language that `@codemirror/language-data` knows is colored by the same
 * handful of tokens. Plain text and names stay in the editor's foreground color.
 */
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

export const tokenHighlight = HighlightStyle.define([
  // Code
  {
    tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword],
    color: 'var(--syntax-keyword)',
  },
  { tag: [t.modifier, t.self], color: 'var(--syntax-keyword)' },
  {
    tag: [t.string, t.special(t.string), t.character, t.regexp, t.attributeValue],
    color: 'var(--syntax-string)',
  },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--syntax-number)' },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: 'var(--syntax-comment)',
    fontStyle: 'italic',
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
    color: 'var(--syntax-function)',
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.attributeName, t.annotation],
    color: 'var(--syntax-type)',
  },
  { tag: [t.tagName, t.standard(t.tagName)], color: 'var(--syntax-keyword)' },
  {
    tag: [t.operator, t.punctuation, t.separator, t.bracket, t.angleBracket, t.derefOperator],
    color: 'var(--syntax-punctuation)',
  },
  { tag: t.invalid, color: 'var(--syntax-invalid)' },

  // Markdown, for source shown without live preview
  { tag: t.heading, fontWeight: '650', color: 'var(--syntax-heading)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  {
    tag: [t.link, t.url],
    color: 'var(--syntax-link)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  { tag: t.quote, color: 'var(--syntax-quote)' },
  { tag: [t.processingInstruction, t.contentSeparator], color: 'var(--syntax-marker)' },
  { tag: t.labelName, color: 'var(--syntax-marker)' },
])
