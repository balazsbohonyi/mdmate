import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { Extension } from '@codemirror/state'

/**
 * The Markdown parser every document uses, tests included. `markdown()` on its own is CommonMark,
 * which has no strikethrough, tables or task lists (tests/editor/markdownSupport.test.ts pins
 * that); the GFM base adds them. The parser decides what the live-preview layer can see, so there
 * is one place to change it.
 */
export function markdownSupport(): Extension {
  return markdown({ base: markdownLanguage })
}
