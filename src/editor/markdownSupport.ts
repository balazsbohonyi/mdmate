import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { Extension } from '@codemirror/state'
import { codeLanguage } from './codeLanguages'

/**
 * The Markdown parser every document uses, tests included. `markdown()` on its own is CommonMark,
 * which has no strikethrough, tables or task lists (tests/editor/markdownSupport.test.ts pins
 * that); the GFM base adds them. The parser decides what the live-preview layer can see, so there
 * is one place to change it. Fenced code is parsed by the language its fence names, loaded the
 * first time it is seen (`codeLanguages.ts`).
 *
 * The package's own paste-a-URL-as-link handler is off: it edits a read-only document and takes
 * text with spaces as an address. `paste.ts` does the same job with those checks (P5-T6).
 */
export function markdownSupport(): Extension {
  return markdown({ base: markdownLanguage, codeLanguages: codeLanguage, pasteURLAsLink: false })
}
