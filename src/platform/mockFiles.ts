import { CR, CRLF, ENDING_TEXT, LF, type EndingCode, type Endings } from '@/lib/endings'

/**
 * The browser stand-in for Rust's file handling: files held in memory, split into text and
 * endings the way `src-tauri/src/fs/eol.rs` does. Real saving never goes through this; it exists
 * so `pnpm dev` and the tests have files to open.
 */

/** Splits raw text into `\n`-only text and its endings, like Rust's `eol::split`. */
export function splitRaw(raw: string): { text: string; endings: Endings } {
  const found: EndingCode[] = []
  const text = raw.replace(/\r\n|\n|\r/g, (match) => {
    found.push(match === '\r\n' ? CRLF : match === '\r' ? CR : LF)
    return '\n'
  })
  const counts = [0, 0, 0]
  const firstSeen = [Infinity, Infinity, Infinity]
  found.forEach((code, index) => {
    counts[code] = (counts[code] ?? 0) + 1
    if ((firstSeen[code] ?? Infinity) === Infinity) firstSeen[code] = index
  })
  let dominant: EndingCode = LF
  let best = 0
  for (const code of [LF, CRLF, CR] as const) {
    const count = counts[code] ?? 0
    const better =
      count > best || (count === best && count > 0 && firstSeen[code]! < firstSeen[dominant]!)
    if (better) {
      dominant = code
      best = count
    }
  }
  const at: number[] = []
  const codes: EndingCode[] = []
  found.forEach((code, index) => {
    if (code !== dominant) {
      at.push(index)
      codes.push(code)
    }
  })
  return { text, endings: { dominant, at, codes } }
}

/** Puts the endings back, like Rust's `eol::join`. */
export function joinRaw(text: string, endings: Endings): string {
  const lines = text.split('\n')
  let next = 0
  let out = ''
  lines.forEach((line, index) => {
    out += line
    if (index === lines.length - 1) return
    let code = endings.dominant
    if (endings.at[next] === index) {
      code = endings.codes[next] ?? endings.dominant
      next++
    }
    out += ENDING_TEXT[code]
  })
  return out
}

/** A short stable fingerprint, as 32 hex digits like the real hash. */
export function mockHash(raw: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(32, '0')
}

/** How a path is compared: two spellings of one file are one file. Like Windows, case is ignored. */
export function pathKey(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase()
}

export type FileListener = (path: string) => void

/** Files by path. Change them to see how the app reacts to another program editing a file. */
export class MockFiles {
  readonly #files = new Map<string, { path: string; raw: string }>()
  readonly #unsupported = new Set<string>()
  readonly #listeners = new Set<FileListener>()

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [path, raw] of Object.entries(initial)) this.#files.set(pathKey(path), { path, raw })
  }

  has(path: string): boolean {
    return this.#files.has(pathKey(path))
  }

  /** The path as first written, so a file keeps its own spelling. */
  canonicalPath(path: string): string | undefined {
    return this.#files.get(pathKey(path))?.path
  }

  read(path: string): string | undefined {
    return this.#files.get(pathKey(path))?.raw
  }

  /** Creates or replaces a file, as another program would. Tells every listener. */
  write(path: string, raw: string): void {
    const existing = this.#files.get(pathKey(path))
    this.#files.set(pathKey(path), { path: existing?.path ?? path, raw })
    for (const listener of this.#listeners) listener(existing?.path ?? path)
  }

  delete(path: string): void {
    const existing = this.#files.get(pathKey(path))
    if (this.#files.delete(pathKey(path)) && existing) {
      for (const listener of this.#listeners) listener(existing.path)
    }
  }

  /** Makes a file open as an unsupported encoding: read-only, with its text shown. */
  markUnsupported(path: string): void {
    this.#unsupported.add(pathKey(path))
  }

  isUnsupported(path: string): boolean {
    return this.#unsupported.has(pathKey(path))
  }

  /** Calls `listener` whenever a file changes by `write` or `delete`. Returns the stop function. */
  onChange(listener: FileListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  paths(): string[] {
    return [...this.#files.values()].map((file) => file.path)
  }
}
