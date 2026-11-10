import { pathKey } from './mockFiles'
import type { TextChange } from './rewrite'

/**
 * The browser stand-in for Rust's link rewrite, for the mock host. It reads plain inline links
 * (`[text](target)` with no spaces, angle brackets or escapes) and nothing else: the real scanner
 * and its rules are tested in Rust. Offsets are JavaScript string indices, which are the UTF-16
 * units the editor counts.
 */

const LINK = /\]\(([^)\s<>]+)\)/g

function parts(path: string): string[] {
  return path.split(/[\\/]+/).filter((part) => part !== '')
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index])
}

/** The names after `base` when `path` is `base` or lies under it. Case is ignored, as on Windows. */
function below(path: readonly string[], base: readonly string[]): string[] | null {
  const lower = (list: readonly string[]): string[] => list.map((part) => part.toLowerCase())
  const [a, b] = [lower(path), lower(base)]
  return b.length <= a.length && b.every((part, index) => part === a[index])
    ? path.slice(base.length)
    : null
}

/** Where a link written `link` in folder `dir` leads, or null when it climbs out. */
function join(dir: readonly string[], link: string): string[] | null {
  const out = [...dir]
  for (const part of link.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.pop() === undefined) return null
    } else out.push(part)
  }
  return out
}

/**
 * The edits a move from `from` to `to` makes to the text of the file at `file`, which is where the
 * file is before the move. A link that reads the same from the file's new folder is left alone.
 */
export function mockEdits(file: string, text: string, from: string, to: string): TextChange[] {
  const [fromParts, toParts] = [parts(from), parts(to)]
  const after = (path: string[]): string[] => {
    const rest = below(path, fromParts)
    return rest === null ? path : [...toParts, ...rest]
  }
  const filePath = parts(file)
  const dir = filePath.slice(0, -1)
  const newDir = after(filePath).slice(0, -1)
  const edits: TextChange[] = []
  for (const match of text.matchAll(LINK)) {
    const raw = match[1] ?? ''
    if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(raw)) continue
    const hash = raw.indexOf('#')
    const written = hash === -1 ? raw : raw.slice(0, hash)
    if (written === '') continue
    const target = join(dir, written)
    if (target === null) continue
    const wanted = after(target)
    const reached = join(newDir, written)
    if (reached !== null && same(reached, wanted)) continue
    const common = newDir.findIndex(
      (part, index) => wanted[index]?.toLowerCase() !== part.toLowerCase(),
    )
    const shared = common === -1 ? Math.min(newDir.length, wanted.length) : common
    const relative = [...Array<string>(newDir.length - shared).fill('..'), ...wanted.slice(shared)]
    const start = (match.index ?? 0) + 2
    edits.push({ from: start, to: start + written.length, insert: relative.join('/') })
  }
  return edits
}

/** One link that leads to a file: where it is written and the line it is on. */
export interface MockReference {
  readonly line: number
  readonly column: number
  readonly text: string
}

/** The plain inline links in `text`, written in the file at `file`, that lead to `target`. */
export function mockReferences(file: string, text: string, target: string): MockReference[] {
  const wanted = parts(target).map((part) => part.toLowerCase())
  const dir = parts(file).slice(0, -1)
  const found: MockReference[] = []
  for (const match of text.matchAll(LINK)) {
    const raw = match[1] ?? ''
    if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(raw)) continue
    const hash = raw.indexOf('#')
    const written = hash === -1 ? raw : raw.slice(0, hash)
    if (written === '') continue
    const reached = join(dir, written)
    if (
      reached === null ||
      !same(
        reached.map((part) => part.toLowerCase()),
        wanted,
      )
    )
      continue
    const start = (match.index ?? 0) + 2
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const lineEnd = text.indexOf('\n', start)
    const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).replace(/\r$/, '')
    found.push({
      line: text.slice(0, start).split('\n').length,
      column: start - lineStart,
      text: line.trim().slice(0, 200),
    })
  }
  return found
}

/** The text with `edits` applied; they must not overlap. */
export function applyEdits(text: string, edits: readonly TextChange[]): string {
  let out = ''
  let at = 0
  for (const edit of [...edits].sort((a, b) => a.from - b.from)) {
    out += text.slice(at, edit.from) + edit.insert
    at = edit.to
  }
  return out + text.slice(at)
}

/** True when the path is a file the mock scans: Markdown, plain text or HTML. */
export function isScannable(path: string): boolean {
  return /\.(md|markdown|txt|html?)$/i.test(path)
}

/** Where `path` is after `from` moved to `to`. */
export function movedPath(path: string, from: string, to: string): string {
  const key = pathKey(from).replace(/\/$/, '')
  const mine = pathKey(path)
  if (mine !== key && !mine.startsWith(`${key}/`)) return path
  return to.replaceAll('\\', '/').replace(/\/$/, '') + path.replaceAll('\\', '/').slice(key.length)
}
