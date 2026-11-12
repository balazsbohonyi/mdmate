import type { SearchRequest } from './search'

/**
 * The browser mock's folder search: the same options as Rust's, on JavaScript's regular
 * expressions (so look-around works here and not in the real app). It is enough for the page's
 * own tests and for trying the panel in a browser; the engine is proven in Rust.
 */

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}_]/u.test(c)

/** The whole-word rule of Rust's `word_ok` and CodeMirror's search. */
function wordOk(line: string, start: number, end: number): boolean {
  const first = [...line.slice(start, end)][0]
  const last = [...line.slice(start, end)].pop()
  const before = [...line.slice(0, start)].pop()
  const after = [...line.slice(end)][0]
  return (!isWordChar(before) || !isWordChar(first)) && (!isWordChar(after) || !isWordChar(last))
}

/** A compiled query, or the words for why there is none. */
export function mockMatcher(
  request: SearchRequest,
): { readonly regex: RegExp } | { readonly error: string } {
  if (request.query === '') return { error: 'Type something to search for.' }
  const source = request.regexp
    ? request.query
    : request.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return { regex: new RegExp(source, request.caseSensitive ? 'gu' : 'giu') }
  } catch {
    return { error: 'This is not a valid regular expression.' }
  }
}

/** One match in a line, with the part of the line shown in the list. */
export interface MockHit {
  readonly line: number
  readonly column: number
  readonly text: string
  readonly start: number
  readonly length: number
}

/** Every match in a text, line by line (a `\r\n`, `\n` or lone `\r` ends a line). */
export function mockSearchText(text: string, regex: RegExp, wholeWord: boolean): MockHit[] {
  const out: MockHit[] = []
  const lines = text.split(/\r\n|\n|\r/)
  lines.forEach((line, index) => {
    const trimmed = line.trimStart()
    const lead = line.length - trimmed.length
    regex.lastIndex = 0
    for (let m = regex.exec(line); m !== null; m = regex.exec(line)) {
      if (m[0] === '') {
        regex.lastIndex += 1
        continue
      }
      const start = m.index
      const end = start + m[0].length
      if (wholeWord && !wordOk(line, start, end)) continue
      const from = Math.min(lead, start)
      out.push({
        line: index + 1,
        column: start,
        text: line.slice(from).trimEnd(),
        start: start - from,
        length: end - start,
      })
    }
  })
  return out
}
