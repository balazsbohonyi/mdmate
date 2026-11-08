/**
 * The language of a fenced code block, found by the word after its opening fence and loaded the
 * first time one is seen.
 *
 * `@codemirror/language-data` knows about a hundred languages and loads each parser with its own
 * `import()`, but the list of them is code too, and an editor that opens a file without a fenced
 * block should not pay for it. So this module hands the Markdown parser one description per fence
 * word, whose `load` fetches the list and then the one parser it names. The parser's own
 * machinery (`ParseContext.getSkippingParser`) skips the block until that resolves and parses it
 * again afterwards, so the first view of a block is plain text and the next is colored.
 *
 * `scripts/check-arch.mjs languages-lazy` keeps it that way: no static import of the list or of a
 * parser anywhere in `src/`, and no parser inside the entry bundle of a build.
 */
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'

/** Stands in for a word the language list does not know: it parses the block as plain text. */
const plainText = new LanguageSupport(
  StreamLanguage.define({
    token(stream) {
      stream.skipToEnd()
      return null
    },
  }),
)

/** The longest fence word looked up. Anything longer is prose or a mistake, not a language. */
const MAX_WORD = 40
/** Most descriptions kept. Typing a fence word one letter at a time makes one for each prefix. */
const MAX_KEPT = 128

const kept = new Map<string, LanguageDescription>()
/** The list's own name for each word that matched one (`ts` is TypeScript), filled as languages load. */
const names = new Map<string, string>()

async function resolve(word: string): Promise<LanguageSupport> {
  const { languages } = await import('@codemirror/language-data')
  // A name or alias ("python", "shell"), then a file extension ("py", "rs"): people write both,
  // and the list's names and aliases alone do not know "py" or "rs".
  const found =
    LanguageDescription.matchLanguageName(languages, word, false) ??
    LanguageDescription.matchFilename(languages, `file.${word}`)
  if (found === null) return plainText
  names.set(word, found.name)
  return found.load()
}

/**
 * The description for the fence word `info`, or null for none. The same word gives the same
 * description, so a language is loaded once however many blocks use it.
 */
export function codeLanguage(info: string): LanguageDescription | null {
  const word = info.trim().toLowerCase()
  if (word === '' || word.length > MAX_WORD) return null
  let description = kept.get(word)
  if (description === undefined) {
    if (kept.size >= MAX_KEPT) {
      kept.clear()
      names.clear()
    }
    description = LanguageDescription.of({ name: word, load: () => resolve(word) })
    kept.set(word, description)
  }
  return description
}

/**
 * What to call the language of the fence word `info` on screen: the list's name for it once the
 * word has been looked up, or null before that and for a word the list does not know. A block is
 * parsed again when its language arrives, which redraws whatever shows this name.
 */
export function languageName(info: string): string | null {
  return names.get(info.trim().toLowerCase()) ?? null
}
