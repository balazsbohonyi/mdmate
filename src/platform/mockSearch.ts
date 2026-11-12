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

// ---- files to include and files to exclude ----

/** What the mock's filters say, or why a pattern cannot be used and in which box it was typed. */
export type MockFilters =
  | { readonly keeps: (path: string) => boolean }
  | { readonly error: string; readonly errorField: 'include' | 'exclude' }

const slashed = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')

/** The pieces of a comma list: commas inside `{}` and `[]` do not split. */
function splitPatterns(text: string): string[] {
  const out: string[] = []
  let current = ''
  let depth = 0
  for (const c of text) {
    if (c === '{' || c === '[') depth += 1
    if (c === '}' || c === ']') depth = Math.max(0, depth - 1)
    if (c === ',' && depth === 0) {
      if (current.trim() !== '') out.push(current.trim())
      current = ''
    } else {
      current += c
    }
  }
  if (current.trim() !== '') out.push(current.trim())
  return out
}

/** A glob as a regular expression: `*` `?` `**` `{a,b}` `[abc]` `[!abc]`. Throws on an unclosed `{` or `[`. */
function globRegExp(glob: string): RegExp {
  let out = ''
  let braces = 0
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob.charAt(i)
    if (c === '*') {
      if (glob.charAt(i + 1) === '*') {
        i += 1
        if (glob.charAt(i + 1) === '/') {
          i += 1
          out += '(?:.*/)?'
        } else out += '.*'
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else if (c === '{') {
      braces += 1
      out += '(?:'
    } else if (c === '}' && braces > 0) {
      braces -= 1
      out += ')'
    } else if (c === ',' && braces > 0) out += '|'
    else if (c === '[') {
      const end = glob.indexOf(']', i + 2)
      if (end < 0) throw new Error('unclosed character class')
      const body = glob.slice(i + 1, end)
      out += `[${body.startsWith('!') ? '^' : ''}${body.replace(/^!/, '').replace(/\\/g, '\\\\')}]`
      i = end
    } else out += c.replace(/[.+^$()|\\]/g, '\\$&')
  }
  if (braces > 0) throw new Error('unclosed alternate group')
  return new RegExp(`^${out}$`, 'i')
}

/**
 * VS Code's two boxes, in the small: enough for the page's tests and the browser demo. Rust's
 * `search::filters` is the real thing and has the grammar tests.
 */
export function mockFilters(request: SearchRequest, roots: readonly string[]): MockFilters {
  interface Rule {
    test: (relative: readonly { root: number; path: string }[]) => boolean
  }
  const names = roots.map((root) => slashed(root).split('/').pop() ?? '')
  const rulesOf = (text: string, field: 'include' | 'exclude'): Rule[] | string => {
    const rules: Rule[] = []
    for (const segment of splitPatterns(text.replace(/\\/g, '/'))) {
      try {
        let allowed: readonly number[] = roots.map((_, index) => index)
        let pattern = segment.replace(/\/+$/, '')
        if (pattern.startsWith('./') || pattern === '.') {
          pattern = pattern.replace(/^\.\/?/, '')
          if (roots.length >= 2 && pattern !== '') {
            const [name = '', ...rest] = pattern.split('/')
            allowed = names
              .map((n, index) => (n.toLowerCase() === name.toLowerCase() ? index : -1))
              .filter((index) => index >= 0)
            if (allowed.length === 0) return `Workspace folder does not exist: ${name}`
            pattern = rest.join('/')
          }
          const inside = pattern === '' ? '**' : pattern
          const whole = [globRegExp(inside), globRegExp(`${inside}/**`)]
          rules.push({
            test: (places) =>
              places.some((p) => allowed.includes(p.root) && whole.some((re) => re.test(p.path))),
          })
        } else {
          const base = pattern.startsWith('**/') || pattern === '**' ? pattern : `**/${pattern}`
          const whole = [globRegExp(base), globRegExp(`${base}/**`)]
          rules.push({ test: (places) => places.some((p) => whole.some((re) => re.test(p.path))) })
        }
      } catch (error) {
        const why = error instanceof Error ? error.message : 'invalid'
        return `files to ${field}: ${segment} is not a valid pattern (${why}).`
      }
    }
    return rules
  }
  const include = rulesOf(request.include, 'include')
  if (typeof include === 'string') return { error: include, errorField: 'include' }
  const exclude = rulesOf(request.exclude, 'exclude')
  if (typeof exclude === 'string') return { error: exclude, errorField: 'exclude' }
  return {
    keeps(path) {
      const whole = slashed(path)
      const places = roots.flatMap((root, index) => {
        const base = slashed(root)
        return whole.toLowerCase().startsWith(`${base.toLowerCase()}/`)
          ? [{ root: index, path: whole.slice(base.length + 1) }]
          : []
      })
      const kept = include.length === 0 || include.some((rule) => rule.test(places))
      return kept && !exclude.some((rule) => rule.test(places))
    },
  }
}
