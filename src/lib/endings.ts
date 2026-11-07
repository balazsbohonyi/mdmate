/**
 * Line endings, as the page sees them. A document's text uses `\n` only; the ending each break had
 * on disk travels beside it, and Rust joins them back on save.
 *
 * Only the breaks that differ from the file's dominant ending are listed, so a plain CRLF or LF
 * file carries no list. `src-tauri/src/fs/eol.rs` is the Rust half and must change with this.
 */

/** 0 is `\n`, 1 is `\r\n`, 2 is a lone `\r`. The numbers are part of the frame format. */
export type EndingCode = 0 | 1 | 2

export const LF = 0
export const CRLF = 1
export const CR = 2

export const ENDING_TEXT: readonly [string, string, string] = ['\n', '\r\n', '\r']

export function isEndingCode(value: number): value is EndingCode {
  return value === 0 || value === 1 || value === 2
}

/**
 * The ending of every line break. Break `i` is the one that ends line `i + 1`. `at` holds the
 * indices of the breaks that differ from `dominant`, ascending, and `codes` their endings.
 */
export interface Endings {
  readonly dominant: EndingCode
  readonly at: readonly number[]
  readonly codes: readonly EndingCode[]
}

export function uniformEndings(dominant: EndingCode = LF): Endings {
  return { dominant, at: [], codes: [] }
}

/**
 * Reads endings from data that came off disk, or returns null when they are not valid for a text
 * with `breaks` line breaks. Same rules as Rust's frame decoder: indices ascending and in range,
 * and no exception equal to the dominant ending.
 */
export function readEndings(value: unknown, breaks: number): Endings | null {
  if (typeof value !== 'object' || value === null) return null
  const { dominant, at, codes } = value as Record<string, unknown>
  if (typeof dominant !== 'number' || !isEndingCode(dominant)) return null
  if (!Array.isArray(at) || !Array.isArray(codes) || at.length !== codes.length) return null
  const indices: number[] = []
  const exceptions: EndingCode[] = []
  let previous = -1
  for (let i = 0; i < at.length; i++) {
    const index: unknown = at[i]
    const code: unknown = codes[i]
    if (typeof index !== 'number' || !Number.isInteger(index)) return null
    if (index <= previous || index >= breaks) return null
    if (typeof code !== 'number' || !isEndingCode(code) || code === dominant) return null
    indices.push(index)
    exceptions.push(code)
    previous = index
  }
  return { dominant, at: indices, codes: exceptions }
}

/**
 * Puts the endings back into text whose only break is `\n`, like Rust's join. Assumes the endings
 * are valid for it. `firstBreak` is the index, in the whole document, of the first break in `text`,
 * for text that is a piece of the document.
 */
export function joinWithEndings(text: string, endings: Endings, firstBreak = 0): string {
  const lines = text.split('\n')
  let next = 0
  while (next < endings.at.length && (endings.at[next] ?? 0) < firstBreak) next++
  let out = ''
  lines.forEach((line, index) => {
    out += line
    if (index === lines.length - 1) return
    let code = endings.dominant
    if (endings.at[next] === index + firstBreak) {
      code = endings.codes[next] ?? endings.dominant
      next++
    }
    out += ENDING_TEXT[code]
  })
  return out
}

export function endingsEqual(a: Endings, b: Endings): boolean {
  if (a === b) return true
  if (a.dominant !== b.dominant || a.at.length !== b.at.length) return false
  return a.at.every((index, i) => index === b.at[i] && a.codes[i] === b.codes[i])
}
