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

/** The parts of a path, with either kind of separator and no empty parts. */
function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter((part) => part !== '')
}

/** Files by path. Change them to see how the app reacts to another program editing a file. */
export class MockFiles {
  readonly #files = new Map<string, { path: string; raw: string }>()
  readonly #unsupported = new Set<string>()
  /** Folders made on purpose, so an empty one exists. Others exist because a file is inside. */
  readonly #folders = new Map<string, string>()
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

  /** Makes a folder, as another program would. Tells every listener about its parent. */
  mkdir(path: string): void {
    if (this.isFolder(path)) return
    this.#folders.set(pathKey(path), path)
    this.#tell(path)
  }

  /**
   * Moves a file, or a folder with everything below it, to a new path, as a rename does. Returns
   * each file's old and new path. Tells every listener about the old and the new places.
   */
  move(from: string, to: string): { from: string; to: string }[] {
    const fromKey = pathKey(from).replace(/\/$/, '')
    const target = to.replaceAll('\\', '/').replace(/\/$/, '')
    const swap = (written: string): string =>
      target + written.replaceAll('\\', '/').slice(fromKey.length)
    const below = (key: string): boolean => key === fromKey || key.startsWith(`${fromKey}/`)
    const moved: { from: string; to: string }[] = []
    for (const [key, file] of [...this.#files]) {
      if (!below(key)) continue
      const now = swap(file.path)
      this.#files.delete(key)
      this.#files.set(pathKey(now), { path: now, raw: file.raw })
      if (this.#unsupported.delete(key)) this.#unsupported.add(pathKey(now))
      moved.push({ from: file.path, to: now })
    }
    for (const [key, folder] of [...this.#folders]) {
      if (!below(key)) continue
      const now = swap(folder)
      this.#folders.delete(key)
      this.#folders.set(pathKey(now), now)
    }
    for (const place of [from, to, ...moved.flatMap((pair) => [pair.from, pair.to])])
      this.#tell(place)
    return moved
  }

  /** Removes a file, or a folder with everything below it. Returns the files that went. */
  remove(path: string): { path: string; raw: string }[] {
    const key = pathKey(path).replace(/\/$/, '')
    const below = (candidate: string): boolean =>
      candidate === key || candidate.startsWith(`${key}/`)
    const gone: { path: string; raw: string }[] = []
    for (const [fileKey, file] of [...this.#files]) {
      if (!below(fileKey)) continue
      this.#files.delete(fileKey)
      gone.push({ path: file.path, raw: file.raw })
    }
    for (const folderKey of [...this.#folders.keys()])
      if (below(folderKey)) this.#folders.delete(folderKey)
    for (const place of [path, ...gone.map((file) => file.path)]) this.#tell(place)
    return gone
  }

  /** True when a folder was made at `path` or a file lies below it. */
  isFolder(path: string): boolean {
    const key = pathKey(path).replace(/\/$/, '')
    if (this.#folders.has(key)) return true
    const prefix = `${key}/`
    for (const file of this.#files.keys()) if (file.startsWith(prefix)) return true
    for (const folder of this.#folders.keys()) if (folder.startsWith(prefix)) return true
    return false
  }

  /**
   * What is directly inside a folder, folders first and each group in name order with case
   * ignored, like Rust's listing. Undefined when there is no such folder.
   */
  listDir(path: string): { name: string; kind: 'file' | 'folder' }[] | undefined {
    if (!this.isFolder(path)) return undefined
    const depth = segments(path).length
    const prefix = `${pathKey(path).replace(/\/$/, '')}/`
    const found = new Map<string, { name: string; kind: 'file' | 'folder' }>()
    const note = (written: string, kind: 'file' | 'folder'): void => {
      if (!pathKey(written).startsWith(prefix)) return
      const parts = segments(written)
      const name = parts[depth]
      if (name === undefined) return
      const entryKind = parts.length > depth + 1 ? 'folder' : kind
      const key = name.toLowerCase()
      // A name that is a folder somewhere wins over the same name as a file.
      if (found.get(key)?.kind !== 'folder') found.set(key, { name, kind: entryKind })
    }
    for (const file of this.#files.values()) note(file.path, 'file')
    for (const folder of this.#folders.values()) note(folder, 'folder')
    return [...found.values()].sort((a, b) => {
      const group = (kind: string): number => (kind === 'file' ? 1 : 0)
      return (
        group(a.kind) - group(b.kind) ||
        (a.name.toLowerCase() < b.name.toLowerCase()
          ? -1
          : a.name.toLowerCase() > b.name.toLowerCase()
            ? 1
            : 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      )
    })
  }

  #tell(path: string): void {
    for (const listener of this.#listeners) listener(path)
  }
}
