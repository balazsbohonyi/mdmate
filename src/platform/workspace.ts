/**
 * What the workspace commands in Rust (`src-tauri/src/workspace/`, `drops.rs`) send back. These
 * types mirror the Rust ones and change in the same commit as them; every reply is checked here,
 * since a reply that has the wrong shape is a bug worth failing on.
 */

/** What a row of the tree is. Mirrors `workspace::tree::EntryKind`. */
export type EntryKind = 'file' | 'folder'

/** One row of a folder listing. */
export interface TreeEntry {
  readonly name: string
  readonly kind: EntryKind
}

/** What a dropped path is. Mirrors `workspace::DropKind`. */
export type DropKind = 'file' | 'folder' | 'other'

/** What a file opens as. Mirrors `fs::kind::FileKind`. */
export type FileKind = 'markdown' | 'text' | 'image'

/** A path a native drop delivered, as people read it. */
export interface DroppedItem {
  readonly path: string
  readonly kind: DropKind
  /** What a file opens as; absent for a folder or anything else. */
  readonly fileKind?: FileKind
}

/** An image the page may show. Mirrors `workspace::ImageInfo`. */
export interface ImageInfo {
  /** The path as people read it. */
  readonly path: string
  /** The size on disk, in bytes. */
  readonly size: number
}

/** Checks a file kind from Rust. */
export function parseFileKind(value: unknown): FileKind {
  if (value !== 'markdown' && value !== 'text' && value !== 'image') {
    throw new Error(`unknown file kind ${String(value)}`)
  }
  return value
}

/** Checks the answer of `image_info`. */
export function parseImageInfo(value: unknown): ImageInfo {
  const entry = record(value)
  const size = entry.size
  if (typeof size !== 'number') throw new Error('size is not a number')
  return { path: textField(entry, 'path'), size }
}

/** An open document whose file moved. Mirrors `workspace::ops::MovedDocument`. */
export interface MovedDocument {
  readonly id: number
  readonly path: string
}

/** What a rename or move did. Mirrors `workspace::ops::Moved`. */
export interface Moved {
  /** Where the file or folder is now. */
  readonly path: string
  /** The open documents that came with it. */
  readonly documents: readonly MovedDocument[]
}

/** What to do with a copy whose name is taken. */
export type ClashChoice = 'replace' | 'keep-both' | 'skip'

/** The answer for one name that was already there. */
export interface ClashAnswer {
  readonly name: string
  readonly answer: ClashChoice
}

/** What a copy from a drop did. Mirrors `workspace::ops::CopyReport`. */
export interface CopyReport {
  readonly copied: readonly string[]
  readonly skipped: readonly string[]
  readonly failed: readonly { readonly name: string; readonly message: string }[]
  readonly linksLeft: number
}

/** A point in the page's own pixels, the ones CSS and `elementFromPoint` use. */
export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * A file drag over the window. Positions are in the page's pixels: Tauri reports physical pixels,
 * and `toCssPosition` has already divided them by the pixel ratio. `paths` come with `drop` only;
 * the page may show them but never acts on them directly (Rust checks every path it is asked to
 * open or copy against its own record of the drop).
 */
export interface FileDragEvent {
  readonly type: 'enter' | 'over' | 'drop' | 'leave'
  readonly position?: Point
  readonly paths?: readonly string[]
}

/**
 * Tauri hands over drop positions in physical pixels, and everything on the page (hit tests,
 * `elementFromPoint`) works in CSS pixels. At 125% display scale the two differ by a quarter, which
 * is enough to land a drop on the wrong row. P0 measured this on the laptop screen.
 */
export function toCssPosition(physical: Point, pixelRatio: number): Point {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1
  return { x: physical.x / ratio, y: physical.y / ratio }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('not an object')
  // Narrowed above; the fields are read one by one below.
  return value as Record<string, unknown>
}

function textField(value: Record<string, unknown>, field: string): string {
  const found = value[field]
  if (typeof found !== 'string') throw new Error(`${field} is not text`)
  return found
}

/** Checks a folder listing from `list_dir`. */
export function parseTreeEntries(value: unknown): TreeEntry[] {
  if (!Array.isArray(value)) throw new Error('a listing is not a list')
  return (value as unknown[]).map((item) => {
    const entry = record(item)
    const kind = textField(entry, 'kind')
    if (kind !== 'file' && kind !== 'folder') throw new Error(`unknown entry kind ${kind}`)
    return { name: textField(entry, 'name'), kind }
  })
}

/** Checks the answer of `drop_describe`. */
export function parseDroppedItems(value: unknown): DroppedItem[] {
  if (!Array.isArray(value)) throw new Error('a drop is not a list')
  return (value as unknown[]).map((item) => {
    const entry = record(item)
    const kind = textField(entry, 'kind')
    if (kind !== 'file' && kind !== 'folder' && kind !== 'other') {
      throw new Error(`unknown drop kind ${kind}`)
    }
    const fileKind = entry.fileKind === undefined ? undefined : parseFileKind(entry.fileKind)
    return fileKind === undefined
      ? { path: textField(entry, 'path'), kind }
      : { path: textField(entry, 'path'), kind, fileKind }
  })
}

/** Checks the answer of `rename_entry` and `move_entry`. */
export function parseMoved(value: unknown): Moved {
  const moved = record(value)
  const documents = moved.documents
  if (!Array.isArray(documents)) throw new Error('documents is not a list')
  return {
    path: textField(moved, 'path'),
    documents: (documents as unknown[]).map((item) => {
      const entry = record(item)
      const id = entry.id
      if (typeof id !== 'number') throw new Error('id is not a number')
      return { id, path: textField(entry, 'path') }
    }),
  }
}

/** Checks the answer of `copy_dropped`. */
export function parseCopyReport(value: unknown): CopyReport {
  const report = record(value)
  const names = (field: string): string[] => parsePaths(report[field])
  const failed = report.failed
  const linksLeft = report.linksLeft
  if (!Array.isArray(failed)) throw new Error('failed is not a list')
  if (typeof linksLeft !== 'number') throw new Error('linksLeft is not a number')
  return {
    copied: names('copied'),
    skipped: names('skipped'),
    failed: (failed as unknown[]).map((item) => {
      const entry = record(item)
      return { name: textField(entry, 'name'), message: textField(entry, 'message') }
    }),
    linksLeft,
  }
}

/** Checks a list of paths, such as the workspace roots. */
export function parsePaths(value: unknown): string[] {
  if (!Array.isArray(value) || (value as unknown[]).some((item) => typeof item !== 'string')) {
    throw new Error('not a list of paths')
  }
  return [...(value as string[])]
}
