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

export function endingsEqual(a: Endings, b: Endings): boolean {
  if (a === b) return true
  if (a.dominant !== b.dominant || a.at.length !== b.at.length) return false
  return a.at.every((index, i) => index === b.at[i] && a.codes[i] === b.codes[i])
}
