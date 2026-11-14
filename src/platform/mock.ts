import type { Endings } from '@/lib/endings'
import { freeName, nameProblem } from '@/lib/fileNames'
import type { LinksOnRename } from '@/lib/settings'
import type {
  DiskChange,
  Host,
  OpenedFile,
  ReadOnlyReason,
  SaveAsHint,
  WindowControls,
} from './host'
import { IDLE_INDEX, type IndexStatus } from './indexStatus'
import type { LinkInfo } from './links'
import type {
  ClashAnswer,
  CopyReport,
  DroppedItem,
  FileDragEvent,
  FileKind,
  Moved,
  MovedDocument,
  Point,
} from './workspace'
import { DEMO_IMAGES } from './demoImages'
import { draftLinkUses, rewriteDraftLinks } from '@/documents/draftLinks'
import { joinRaw, MockFiles, mockHash, pathKey, splitRaw } from './mockFiles'
import { mockQuickOpen } from './mockQuickOpen'
import { applyEdits, isScannable, mockEdits, mockReferences, movedPath } from './mockRewrite'
import type { Reference } from './references'
import type { RewriteChange, RewriteDone, RewritePlanned, TextChange } from './rewrite'
import { mockFilters, mockMatcher, mockSearchText } from './mockSearch'
import { mockOutline } from './mockOutline'
import { MAX_SEARCH_HITS, type SearchSummary } from './search'

/**
 * Window controls for the browser. Maximize flips a flag so the title bar's icon can be seen
 * changing under pnpm dev; minimize and close do nothing, since a tab is not a window.
 */
function mockWindowControls(): WindowControls {
  let maximized = false
  const listeners = new Set<(maximized: boolean) => void>()
  return {
    minimize() {
      return Promise.resolve()
    },
    toggleMaximize() {
      maximized = !maximized
      for (const listener of listeners) listener(maximized)
      return Promise.resolve()
    },
    close() {
      return Promise.resolve()
    },
    isMaximized() {
      return Promise.resolve(maximized)
    },
    onMaximizedChange(handler) {
      listeners.add(handler)
      return Promise.resolve(() => {
        listeners.delete(handler)
      })
    },
  }
}

/** Shaped like the error Rust's `AppError` serializes to, so the page handles both the same way. */
class MockHostError extends Error {
  readonly kind: string

  constructor(kind: string, message: string) {
    super(message)
    this.kind = kind
  }
}

function hostError(kind: string, message: string): MockHostError {
  return new MockHostError(kind, message)
}

/** Runs `run` and hands back what it returns, or what it throws, as a promise. */
function attempt<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run())
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

export interface MockHost extends Host {
  /** The files the app can open. Change them to act as another program editing the disk. */
  readonly files: MockFiles
  /** Document ids the host has open, with their paths. */
  openDocuments(): ReadonlyMap<number, string>
  /**
   * Runs `run` with the watcher deaf, so a change it makes to `files` raises no event, as when a
   * file system drops one. The next save still notices the file changed.
   */
  withoutEvents(run: () => void): void
  /** The session snapshot the page last wrote, or null before the first write. */
  session: string | null
  /** Text the page asked to keep because it could not put it back in a tab. */
  readonly recovered: { name: string; text: string }[]
  /** Pretends the user closed the window: asks the page to flush and quit. False when no page listens. */
  requestClose(): boolean
  /** How many times the page ended the app. */
  quits: number
  /** Every target `followLink` handed to the "OS", in order. */
  readonly opened: string[]
  /** How many times the page asked which links are missing. */
  checks: number
  /** The workspace roots the host keeps, as Rust does between runs. */
  readonly roots: readonly string[]
  /** The folders the page last asked to have watched. */
  watchedFolders(): readonly string[]
  /** Acts as Rust reporting how the workspace index is doing; the page hears it. */
  setIndexStatus(status: IndexStatus): void
  /**
   * Acts as the OS delivering a drop of these paths: Rust's record learns them, and the page
   * hears a drag-drop event at `position` (page pixels).
   */
  simulateDrop(paths: readonly string[], position?: Point): void
  /** Sends a drag event that is not a drop, such as `over`, to the page. */
  simulateDrag(event: FileDragEvent): void
  /** What the Recycle Bin holds: files sent there by a delete or by Replace, oldest first. */
  readonly recycled: { path: string; raw: string }[]
  /** Every path the page asked to show in the file manager, in order. */
  readonly revealed: string[]
  /** The folders opened in the file manager, in order. */
  readonly openedFolders: string[]
  /** Every text the page put on the clipboard, in order. */
  readonly clipboard: string[]
  /** What the host would offer in Open Recent, newest first, with no check that the entries exist. */
  readonly recent: { files: string[]; folders: string[] }
  /** The hints the save dialog was shown, in order. */
  readonly saveDialogs: SaveAsHint[]
  /** Every image `savePastedImage` wrote, in order, with its bytes. */
  readonly pastedImages: { path: string; bytes: Uint8Array }[]
  /** The paths `dropImage` copied into an images folder, in order. */
  readonly copiedImages: string[]
  /** The `keep` lists `sweepDrafts` was called with, in order. */
  readonly sweeps: number[][]
}

/** Where the mock keeps the draft folders of untitled documents. */
export const DRAFT_ROOT = '/mock-data/drafts'

/** The files of a draft's `assets` that can be copied: a name and one of the four extensions. */
const DRAFT_IMAGE = /^[^/\\]+\.(?:png|jpg|gif|webp)$/i

/** Characters a copied picture's name never keeps, as in Rust's `forbidden_in_name`. */
const NAME_FORBIDDEN = new Set([...'<>:"/\\|?*#%&'])

function forbiddenInName(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return (
    code < 0x20 ||
    (code >= 0x7f && code < 0xa0) ||
    NAME_FORBIDDEN.has(char) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  )
}

/** Names Windows keeps for devices, with or without an extension. */
function reservedName(stem: string): boolean {
  const base = (stem.split('.')[0] ?? '').trimEnd().toUpperCase()
  return ['CON', 'PRN', 'AUX', 'NUL'].includes(base) || /^(?:COM|LPT)[1-9]$/.test(base)
}

/** The name a dropped picture's copy keeps, as in Rust's `safe_stem`. Empty when there is none. */
function safeStem(original: string): string {
  const mapped = [...original]
    .map((char) => (forbiddenInName(char) ? '-' : char))
    .slice(0, 100)
    .join('')
  const kept = mapped.replace(/[. ]+$/, '')
  const stem = kept + '-'.repeat(mapped.length - kept.length)
  return reservedName(stem) ? `image-${stem}` : stem
}

/** A name that can sit in a link as it is, with no `<...>` around it. */
const PLAIN_NAME = /^[\p{L}\p{N}_.-]+$/u

/** The extension Rust gives an image by its first bytes, or null when it is none of the four. */
function sniffImageExtension(bytes: Uint8Array): string | null {
  const at = (...values: number[]): boolean => values.every((value, i) => bytes[i] === value)
  if (at(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png'
  if (at(0xff, 0xd8, 0xff)) return 'jpg'
  if (at(0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return 'gif'
  }
  const text = (from: number, to: number): string => String.fromCharCode(...bytes.slice(from, to))
  if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp'
  return null
}

const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/**
 * A stand-in for Rust's link guard, so links can be followed under `pnpm dev` and in tests. It is
 * deliberately small: web and mail links, anchors, and relative paths to the mock's own files.
 * It is not the guard and is never shipped; the rules that keep a hostile link harmless live in
 * `src-tauri/src/links/guard.rs`.
 */
function mockDescribeLink(files: MockFiles, docPath: string, href: string): LinkInfo {
  const target = href.trim()
  if (target.startsWith('#')) return { kind: 'anchor', fragment: safeDecode(target.slice(1)) }
  if (/^(https?:\/\/[^/@\\]|mailto:[^/\\])/i.test(target)) return { kind: 'web', url: target }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return { kind: 'refused', reason: 'scheme' }
  if (/^[/\\]/.test(target)) return { kind: 'refused', reason: 'absolute' }
  const hash = target.indexOf('#')
  const rawPath = hash === -1 ? target : target.slice(0, hash)
  const fragment = hash === -1 ? null : safeDecode(target.slice(hash + 1))
  if (rawPath === '') return { kind: 'anchor', fragment: fragment ?? '' }
  const parts = docPath.split('/').slice(0, -1)
  for (const part of safeDecode(rawPath).split(/[/\\]/)) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  const path = parts.join('/')
  const canonical = files.canonicalPath(path)
  if (canonical === undefined) return { kind: 'missing', path }
  if (/\.(md|markdown)$/i.test(canonical)) return { kind: 'markdown', path: canonical, fragment }
  if (/\.(png|jpe?g|gif|webp)$/i.test(canonical)) return { kind: 'image', path: canonical }
  return { kind: 'file', path: canonical }
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

export interface MockHostOptions {
  /** What the environment says a rename does about links (the `MDMATE_LINKS_ON_RENAME` variable). Default: nothing. */
  readonly linksOnRename?: LinksOnRename
  /** Files that exist from the start, by path. */
  readonly files?: Readonly<Record<string, string>>
  /** What the open dialog returns each time it is shown. Default: no files, as if cancelled. */
  readonly pick?: () => string[]
  /** What the folder dialog returns each time it is shown. Default: null, as if cancelled. */
  readonly pickFolder?: () => string | null
  /** Workspace roots the host already has, as if the last run left them. */
  readonly roots?: readonly string[]
  /**
   * What the save dialog returns each time it is shown, given what the page suggested. Default:
   * null, as if cancelled.
   */
  readonly pickSave?: (hint: SaveAsHint) => string | null
  /** Open Recent entries the host already has, as if the last run left them. */
  readonly recent?: { readonly files?: readonly string[]; readonly folders?: readonly string[] }
  /**
   * Pictures the files stand for. The mock's files are text, so an image gets its address and its
   * size on disk from here; an image not listed is an SVG made from the file's own text, or fails
   * to load.
   */
  readonly images?: Readonly<Record<string, { readonly url: string; readonly bytes: number }>>
}

/** What a file opens as, by name. Like Rust's `fs::kind`, and just as small. */
function mockKindOf(path: string): FileKind {
  if (/.(md|markdown|mdown|mkd|mdx)$/i.test(path)) return 'markdown'
  if (/.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(path)) return 'image'
  return 'text'
}

/**
 * A host with in-memory files, so the app runs under `pnpm dev` and the document tests have
 * something to open. It mirrors the Rust side: documents get ids, opening a file twice gives the
 * same id, and saves go by id.
 */
export function createMockHost(options: MockHostOptions = {}): MockHost {
  const files = new MockFiles(options.files)
  const ids = new Map<string, number>()
  /**
   * What Rust remembers about an open document. `known` is the hash of the content it is in step
   * with, and `reported` the hash of an outside change the page was already told about.
   */
  interface Open {
    path: string
    readOnly: ReadOnlyReason | null
    known: string
    reported: string | null
  }
  const open = new Map<number, Open>()
  /** Documents with no file yet. They have an id and nothing else. */
  const untitled = new Set<number>()
  /** The number in the name of each untitled document, which keys its draft folder. */
  const draftNumbers = new Map<number, number>()
  const draftFolder = (number: number): string => `${DRAFT_ROOT}/${String(number)}`
  /**
   * Puts a picture in `folder` as Rust's `save_into` does: a file there with the same content is
   * the picture already (nothing is written), otherwise it is written under `stem` and the first
   * free number (`-2`, `-3`), and a taken name is never replaced. `mayReuse` says which names of
   * identical files will do.
   */
  const placeImage = (
    folder: string,
    stem: string,
    ext: string,
    content: string,
    mayReuse: (name: string) => boolean = () => true,
  ): { name: string; reused: boolean } => {
    const held = (files.listDir(folder) ?? [])
      .filter((entry) => entry.kind === 'file' && mayReuse(entry.name))
      .map((entry) => entry.name)
      .sort()
      .find((name) => files.read(`${folder}/${name}`) === content)
    if (held !== undefined) return { name: held, reused: true }
    let name = `${stem}.${ext}`
    for (let n = 2; files.has(`${folder}/${name}`); n++) name = `${stem}-${String(n)}.${ext}`
    files.write(`${folder}/${name}`, content)
    return { name, reused: false }
  }
  /**
   * Copies the images of draft `number` that `text` links to into `<folder>/assets`, under their own
   * names when free and `-2`, `-3` when taken (a picture already there under another name is linked
   * instead), and returns the text with the renamed links updated. What Rust does for the first Save
   * As and for recovered text.
   */
  const adoptDraftImages = (
    number: number,
    text: string,
    folder: string,
  ): { text: string; renamedImages: { from: string; to: string }[] } => {
    const source = `${draftFolder(number)}/assets`
    const names = (files.listDir(source) ?? [])
      .filter((entry) => entry.kind === 'file' && DRAFT_IMAGE.test(entry.name))
      .map((entry) => entry.name)
      .filter((name) => {
        const stem = name.slice(0, name.lastIndexOf('.'))
        return safeStem(stem) === stem
      })
      .sort()
    const used = new Set(draftLinkUses(text, names).map((use) => use.name))
    const target = `${folder}/assets`
    const renamedImages: { from: string; to: string }[] = []
    for (const name of names.filter((candidate) => used.has(candidate))) {
      const dot = name.lastIndexOf('.')
      const placed = placeImage(
        target,
        name.slice(0, dot),
        name.slice(dot + 1),
        files.read(`${source}/${name}`) ?? '',
        (existing) => existing === name || PLAIN_NAME.test(existing),
      )
      const bytes = pastedImages.findLast(
        (image) => pathKey(image.path) === pathKey(`${source}/${name}`),
      )
      if (bytes !== undefined && !placed.reused)
        pastedImages.push({ path: `${target}/${placed.name}`, bytes: bytes.bytes })
      if (placed.name !== name) renamedImages.push({ from: name, to: placed.name })
    }
    const renames = new Map(renamedImages.map((image) => [image.from, image.to]))
    return { text: rewriteDraftLinks(text, renames), renamedImages }
  }
  const recent = {
    files: [...(options.recent?.files ?? [])],
    folders: [...(options.recent?.folders ?? [])],
  }
  const saveDialogs: SaveAsHint[] = []
  let nextId = 0
  let listener: ((change: DiskChange) => void) | undefined
  let deaf = false
  let closeListener: (() => void) | undefined

  function describe(id: number, doc: Open, raw: string): OpenedFile {
    const { text, endings } = splitRaw(raw)
    return {
      id,
      path: doc.path,
      name: doc.path.split('/').pop() ?? doc.path,
      encoding: doc.readOnly === 'unsupported-encoding' ? 'unsupported' : 'utf-8',
      bom: false,
      readOnly: doc.readOnly,
      size: new TextEncoder().encode(raw).length,
      hash: mockHash(raw),
      kind: mockKindOf(doc.path),
      text,
      endings,
    }
  }

  /** What the real watcher does with a file system event: say so only about news. */
  function deliver(path: string): void {
    if (deaf) return
    const key = pathKey(path)
    for (const [id, doc] of open) {
      if (pathKey(doc.path) !== key) continue
      const raw = files.read(doc.path)
      if (raw === undefined) continue // a vanished file says nothing; the tab keeps its text
      const hash = mockHash(raw)
      if (hash === doc.known) {
        doc.reported = null
      } else if (doc.reported !== hash) {
        doc.reported = hash
        listener?.({ id, hash })
      }
    }
  }
  files.onChange(deliver)

  // ---- the workspace, as Rust keeps it ----
  const roots: string[] = [...(options.roots ?? [])]
  let watched: string[] = []
  let treeListener: ((folder: string) => void) | undefined
  let indexListener: ((status: IndexStatus) => void) | undefined
  let indexStatus: IndexStatus = IDLE_INDEX
  let dragListener: ((event: FileDragEvent) => void) | undefined
  /** The paths of the last few native drops, newest last. */
  const drops: string[][] = []
  const dropsKept = 4

  const recycled: { path: string; raw: string }[] = []
  const revealed: string[] = []
  const openedFolders: string[] = []
  const clipboard: string[] = []
  const pastedImages: { path: string; bytes: Uint8Array }[] = []
  const copiedImages: string[] = []
  const sweeps: number[][] = []
  const trimmed = (path: string): string => pathKey(path).replace(/\/$/, '')
  const slashes = (path: string): string => path.replaceAll('\\', '/').replace(/\/$/, '')
  const parentOf = (path: string): string => slashes(path).split('/').slice(0, -1).join('/')
  const nameOf = (path: string): string => slashes(path).split('/').pop() ?? ''
  const exists = (path: string): boolean => files.has(path) || files.isFolder(path)

  const insideRoot = (path: string): boolean => {
    const key = pathKey(path).replace(/\/$/, '')
    return roots.some((root) => {
      const rootKey = pathKey(root).replace(/\/$/, '')
      return key === rootKey || key.startsWith(`${rootKey}/`)
    })
  }

  const addRoot = (path: string): string => {
    if (!files.isFolder(path)) throw hostError('not-found', `${path} does not exist`)
    if (!roots.some((root) => pathKey(root) === pathKey(path))) roots.push(path)
    return path
  }

  /** Puts a path first on a recent list, once, keeping the newest `max`. */
  function remember(list: string[], path: string, max: number): void {
    const key = pathKey(path)
    const at = list.findIndex((entry) => pathKey(entry) === key)
    if (at !== -1) list.splice(at, 1)
    list.unshift(path)
    list.length = Math.min(list.length, max)
  }

  /** Tells the page which watched folder holds a path that changed. */
  function deliverTree(path: string): void {
    const parts = path.replaceAll('\\', '/').split('/')
    parts.pop()
    const parent = parts.join('/')
    const own = watched.find((folder) => pathKey(folder) === pathKey(path))
    const holder = watched.find((folder) => pathKey(folder) === pathKey(parent))
    for (const folder of [holder, own]) if (folder !== undefined) treeListener?.(folder)
  }
  files.onChange(deliverTree)

  /** An entry of the workspace that is not a root itself, like Rust's `entry_in_root`. */
  function entryInRoot(path: string): void {
    if (!insideRoot(path)) throw hostError('not-allowed', `access to ${path} is not allowed`)
    if (roots.some((root) => trimmed(root) === trimmed(path))) {
      throw hostError('invalid', 'a workspace folder leaves the workspace with Remove Folder')
    }
    if (!exists(path)) throw hostError('not-found', `${path} does not exist`)
  }

  function folderInRoot(path: string): void {
    if (!insideRoot(path)) throw hostError('not-allowed', `access to ${path} is not allowed`)
    if (!files.isFolder(path)) throw hostError('invalid', `${path} is not a folder`)
  }

  function checkName(name: string): void {
    const problem = nameProblem(name)
    if (problem !== null) throw hostError('invalid', problem)
  }

  /** Points the open documents at a moved file, like Rust's `documents_moved`. */
  function followMove(from: string, to: string): MovedDocument[] {
    const fromKey = trimmed(from)
    const target = slashes(to)
    const moved: MovedDocument[] = []
    for (const [id, doc] of open) {
      const key = pathKey(doc.path)
      if (key !== fromKey && !key.startsWith(`${fromKey}/`)) continue
      doc.path = target + slashes(doc.path).slice(fromKey.length)
      moved.push({ id, path: doc.path })
    }
    return moved
  }

  /** Renames, like Rust's `rename_entry`. */
  function rename(path: string, newName: string): Moved {
    const target = renameTarget(path, newName)
    if (target === null) return { path: `${parentOf(path)}/${newName}`, documents: [] }
    files.move(path, target)
    return { path: target, documents: followMove(path, target) }
  }

  /** Moves into a folder, like Rust's `move_entry`. */
  function moveInto(path: string, into: string): Moved {
    const target = moveTarget(path, into)
    if (target === null) return { path: `${slashes(into)}/${nameOf(path)}`, documents: [] }
    files.move(path, target)
    return { path: target, documents: followMove(path, target) }
  }

  /** Where a rename puts `path` after the checks; null when the name is the one it has. */
  function renameTarget(path: string, newName: string): string | null {
    checkName(newName)
    entryInRoot(path)
    const target = `${parentOf(path)}/${newName}`
    if (slashes(target) === slashes(path)) return null
    if (exists(target) && trimmed(target) !== trimmed(path)) {
      throw hostError('exists', `${newName} already exists`)
    }
    return target
  }

  /** Where a move puts `path` after the checks; null when it is in that folder already. */
  function moveTarget(path: string, into: string): string | null {
    entryInRoot(path)
    folderInRoot(into)
    const [from, destination] = [trimmed(path), trimmed(into)]
    if (destination === from || destination.startsWith(`${from}/`)) {
      throw hostError('invalid', 'a folder cannot be moved into itself')
    }
    const target = `${slashes(into)}/${nameOf(path)}`
    if (slashes(target) === slashes(path)) return null
    if (exists(target)) throw hostError('exists', `${nameOf(path)} already exists`)
    return target
  }

  // ---- link rewrite, in the small: inline links only (see mockRewrite.ts) ----
  interface Planned {
    token: number
    path: string
    change: RewriteChange
    target: string
    /** The files to write and the edits for each, with the hash of what was read. */
    files: { path: string; hash: string; edits: TextChange[] }[]
  }
  let pending: Planned | null = null
  let cancelled = false
  /** The id of the folder search that may run; zero when none. */
  let searchCurrent = 0
  let lastToken = 0

  function targetOf(path: string, change: RewriteChange): string | null {
    return change.kind === 'rename'
      ? renameTarget(path, change.name)
      : moveTarget(path, change.into)
  }

  async function planRewrite(
    path: string,
    change: RewriteChange,
    buffers: readonly { id: number; text: string }[],
    onProgress: (scanned: number) => void,
  ): Promise<RewritePlanned> {
    const empty: RewritePlanned = {
      token: 0,
      links: 0,
      files: 0,
      scanned: 0,
      binary: 0,
      skipped: [],
      unrelatable: 0,
      cancelled: false,
      buffers: [],
    }
    const target = targetOf(path, change)
    if (target === null) return empty
    cancelled = false
    const held = new Map<string, TextChange[]>()
    for (const buffer of buffers) {
      const doc = open.get(buffer.id)
      if (doc === undefined) continue
      held.set(pathKey(doc.path), mockEdits(doc.path, buffer.text, path, target))
    }
    const found: Planned['files'] = []
    let scanned = 0
    for (const file of files.paths()) {
      if (!insideRoot(file) || !isScannable(file) || held.has(pathKey(file))) continue
      // Give the page a turn between files, as the real scan does by running on another thread.
      await Promise.resolve()
      if (cancelled) return { ...empty, cancelled: true }
      scanned += 1
      onProgress(scanned)
      const raw = files.read(file) ?? ''
      const edits = mockEdits(file, raw, path, target)
      if (edits.length > 0) found.push({ path: file, hash: mockHash(raw), edits })
    }
    const links =
      found.reduce((sum, file) => sum + file.edits.length, 0) +
      [...held.values()].reduce((sum, edits) => sum + edits.length, 0)
    const count = found.length + [...held.values()].filter((edits) => edits.length > 0).length
    lastToken += 1
    pending = { token: lastToken, path, change, target, files: found }
    return {
      ...empty,
      token: lastToken,
      links,
      files: count,
      scanned,
      buffers: buffers.map((b) => b.id),
    }
  }

  function finishRewrite(
    token: number,
    buffers: readonly { id: number; text: string }[],
  ): RewriteDone {
    const plan = pending
    if (plan?.token !== token) {
      throw hostError('invalid', 'the plan is out of date: start the rename again')
    }
    pending = null
    const held = new Map<number, { key: string; edits: TextChange[] }>()
    for (const buffer of buffers) {
      const doc = open.get(buffer.id)
      if (doc === undefined) continue
      held.set(buffer.id, {
        key: pathKey(doc.path),
        edits: mockEdits(doc.path, buffer.text, plan.path, plan.target),
      })
    }
    const heldKeys = new Set([...held.values()].map((doc) => doc.key))
    const moved =
      plan.change.kind === 'rename'
        ? rename(plan.path, plan.change.name)
        : moveInto(plan.path, plan.change.into)
    const written: string[] = []
    const failed: { path: string; reason: string }[] = []
    for (const file of plan.files) {
      if (heldKeys.has(pathKey(file.path))) continue
      const now = movedPath(file.path, plan.path, plan.target)
      const raw = files.read(now)
      if (raw === undefined || mockHash(raw) !== file.hash) {
        failed.push({ path: now, reason: 'it changed since it was scanned' })
        continue
      }
      files.write(now, applyEdits(raw, file.edits))
      written.push(now)
    }
    const writtenKeys = new Set(written.map((path) => pathKey(path)))
    const reload = [...open]
      .filter(([, doc]) => writtenKeys.has(pathKey(doc.path)))
      .map(([id]) => id)
    return {
      moved,
      written,
      failed,
      reload,
      edits: [...held]
        .filter(([, doc]) => doc.edits.length > 0)
        .map(([id, doc]) => ({ id, changes: doc.edits })),
      unrelatable: 0,
    }
  }

  function requireDropped(paths: readonly string[]): void {
    const known = new Set(drops.flat().map((path) => pathKey(path)))
    if (paths.some((path) => !known.has(pathKey(path)))) {
      throw hostError('not-allowed', 'access to a path no drop delivered is not allowed')
    }
  }

  /** Copies a file, or a folder with the files below it. */
  function copyTree(source: string, target: string): void {
    if (!files.isFolder(source)) {
      files.write(target, files.read(source) ?? '')
      return
    }
    files.mkdir(target)
    const sourceKey = trimmed(source)
    for (const path of files.paths()) {
      if (!pathKey(path).startsWith(`${sourceKey}/`)) continue
      files.write(target + slashes(path).slice(sourceKey.length), files.read(path) ?? '')
    }
  }

  const host: MockHost = {
    kind: 'browser',
    recycled,
    revealed,
    openedFolders,
    clipboard,
    recent,
    saveDialogs,
    pastedImages,
    copiedImages,
    sweeps,
    files,
    openDocuments() {
      return new Map([...open].map(([id, doc]) => [id, doc.path]))
    },
    session: null,
    recovered: [],
    quits: 0,
    opened: [],
    checks: 0,
    describeLink(id, href) {
      const doc = open.get(id)
      if (doc === undefined) return Promise.reject(hostError('not-open', `no open document ${id}`))
      return Promise.resolve(mockDescribeLink(files, doc.path, href))
    },
    checkLinks(id, hrefs) {
      const doc = open.get(id)
      if (doc === undefined) return Promise.reject(hostError('not-open', `no open document ${id}`))
      host.checks++
      return Promise.resolve(
        hrefs.map((href) => mockDescribeLink(files, doc.path, href).kind === 'missing'),
      )
    },
    followLink(id, href, confirmed) {
      const doc = open.get(id)
      if (doc === undefined) return Promise.reject(hostError('not-open', `no open document ${id}`))
      const info = mockDescribeLink(files, doc.path, href)
      switch (info.kind) {
        case 'anchor':
          return Promise.resolve({ kind: 'anchor', fragment: info.fragment })
        case 'markdown':
          return Promise.resolve({ kind: 'document', path: info.path, fragment: info.fragment })
        case 'web':
          host.opened.push(info.url)
          return Promise.resolve({ kind: 'opened' })
        case 'image':
          host.opened.push(info.path)
          return Promise.resolve({ kind: 'opened' })
        case 'file':
          if (!confirmed) {
            return Promise.reject(
              hostError('needs-confirmation', `opening ${info.path} needs a confirmation first`),
            )
          }
          host.opened.push(info.path)
          return Promise.resolve({ kind: 'opened' })
        case 'missing':
          return Promise.reject(hostError('not-found', `${info.path} does not exist`))
        case 'refused':
          return Promise.reject(
            hostError('link-refused', `this link may not be followed: ${info.reason}`),
          )
        default: {
          const unreachable: never = info
          return unreachable
        }
      }
    },
    requestClose() {
      closeListener?.()
      return closeListener !== undefined
    },
    get roots() {
      return roots
    },
    setIndexStatus(status) {
      indexStatus = status
      indexListener?.(status)
    },
    watchedFolders() {
      return watched
    },
    simulateDrop(paths, position = { x: 0, y: 0 }) {
      drops.push([...paths])
      while (drops.length > dropsKept) drops.shift()
      dragListener?.({ type: 'drop', position, paths })
    },
    simulateDrag(event) {
      dragListener?.(event)
    },
    openFolder() {
      const picked = options.pickFolder?.() ?? null
      return attempt(() => {
        if (picked === null) return null
        const root = addRoot(picked)
        remember(recent.folders, root, 5)
        return root
      })
    },
    loadWorkspace() {
      // Like Rust: a folder that is gone is not a root any more.
      for (const root of [...roots]) if (!files.isFolder(root)) roots.splice(roots.indexOf(root), 1)
      return Promise.resolve([...roots])
    },
    removeRoot(path) {
      const index = roots.findIndex((root) => pathKey(root) === pathKey(path))
      if (index === -1) return Promise.reject(hostError('invalid', 'not a workspace folder'))
      roots.splice(index, 1)
      return Promise.resolve()
    },
    listDir(path) {
      if (!insideRoot(path))
        return Promise.reject(hostError('not-allowed', `access to ${path} is not allowed`))
      const listed = files.listDir(path)
      if (listed === undefined)
        return Promise.reject(hostError('not-found', `${path} does not exist`))
      return Promise.resolve(listed)
    },
    watchTree(onChange) {
      treeListener = onChange
      return Promise.resolve(() => {
        if (treeListener === onChange) treeListener = undefined
      })
    },
    watchIndex(onStatus) {
      indexListener = onStatus
      onStatus(indexStatus)
      return Promise.resolve(() => {
        if (indexListener === onStatus) indexListener = undefined
      })
    },
    watchFolders(paths) {
      watched = paths.filter((path) => insideRoot(path) && files.isFolder(path))
      return Promise.resolve()
    },
    onFileDrag(handler) {
      dragListener = handler
      return Promise.resolve(() => {
        if (dragListener === handler) dragListener = undefined
      })
    },
    describeDrop(paths) {
      const known = new Set(drops.flat().map((path) => pathKey(path)))
      if (paths.some((path) => !known.has(pathKey(path)))) {
        return Promise.reject(
          hostError('not-allowed', 'access to a path no drop delivered is not allowed'),
        )
      }
      return Promise.resolve(
        paths.map((path): DroppedItem => {
          const kind = files.isFolder(path) ? 'folder' : files.has(path) ? 'file' : 'other'
          return { path, kind }
        }),
      )
    },
    openDropped(paths) {
      const known = new Set(drops.flat().map((path) => pathKey(path)))
      if (paths.some((path) => !known.has(pathKey(path)))) {
        return Promise.reject(
          hostError('not-allowed', 'access to a path no drop delivered is not allowed'),
        )
      }
      return Promise.resolve(
        paths.map((path): DroppedItem => {
          if (files.isFolder(path)) return { path, kind: 'folder' }
          if (!files.has(path)) return { path, kind: 'other' }
          return { path, kind: 'file', fileKind: mockKindOf(path) }
        }),
      )
    },
    fileKind(path) {
      return attempt(() => {
        if (!files.has(path)) throw hostError('not-found', `${path} does not exist`)
        return mockKindOf(path)
      })
    },
    imageInfo(path) {
      return attempt(() => {
        const canonical = files.canonicalPath(path)
        const raw = files.read(path)
        if (canonical === undefined || raw === undefined) {
          throw hostError('not-found', `${path} does not exist`)
        }
        if (mockKindOf(canonical) !== 'image') throw hostError('invalid', 'not an image')
        const listed = options.images?.[canonical]
        return { path: canonical, size: listed?.bytes ?? new TextEncoder().encode(raw).length }
      })
    },
    imageClosed() {
      return Promise.resolve()
    },
    savePastedImage(id, bytes, stamp) {
      return attempt(() => {
        // Like Rust: an untitled document's images go to its draft folder, and a document that
        // cannot be edited takes none.
        const number = draftNumbers.get(id)
        const doc = open.get(id)
        if (number === undefined) {
          if (doc === undefined) throw hostError('not-open', `no open document ${id}`)
          if (doc.readOnly !== null) throw hostError('read-only', 'it cannot be edited')
        }
        if (!/^\d{8}-\d{6}$/.test(stamp)) throw hostError('invalid', 'bad image name stamp')
        const data = new Uint8Array(bytes)
        const ext = sniffImageExtension(data)
        if (ext === null) throw hostError('invalid', 'not a PNG, JPEG, GIF or WebP image')
        const folder =
          number !== undefined
            ? `${draftFolder(number)}/assets`
            : `${parentOf(doc?.path ?? '')}/assets`
        // The same picture again is the file that is there; otherwise the first free name, and a
        // taken one is never replaced.
        const content = Array.from(data, (byte) => String.fromCharCode(byte)).join('')
        const placed = placeImage(folder, `image-${stamp}`, ext, content)
        if (!placed.reused) pastedImages.push({ path: `${folder}/${placed.name}`, bytes: data })
        return { name: placed.name, link: `assets/${placed.name}` }
      })
    },
    dropImage(id, path, stamp) {
      return attempt(() => {
        const known = drops.flat().some((dropped) => pathKey(dropped) === pathKey(path))
        if (!known)
          throw hostError('not-allowed', 'access to a path no drop delivered is not allowed')
        if (mockKindOf(path) !== 'image' || !files.has(path)) {
          throw hostError('invalid', 'not an image')
        }
        // Like Rust: an untitled document copies every picture into its draft folder, and a
        // document that cannot be edited takes none.
        const number = draftNumbers.get(id)
        // The copy keeps the file's own name, cleaned; a file with no usable name is named like
        // a pasted one. Unlike Rust the extension is the file's own: the mock's files are not
        // real images, so there are no bytes to read it from.
        const copyOf = (folder: string): { link: string; copied: true } => {
          const dot = nameOf(path).lastIndexOf('.')
          const own = safeStem(dot > 0 ? nameOf(path).slice(0, dot) : nameOf(path))
          if (own === '' && !/^\d{8}-\d{6}$/.test(stamp)) {
            throw hostError('invalid', 'bad image name stamp')
          }
          const ext =
            dot > 0
              ? nameOf(path)
                  .slice(dot + 1)
                  .toLowerCase()
              : 'png'
          const target = `${folder}/assets`
          const placed = placeImage(
            target,
            own === '' ? `image-${stamp}` : own,
            ext,
            files.read(path) ?? '',
          )
          if (!placed.reused) copiedImages.push(`${target}/${placed.name}`)
          return { link: `assets/${placed.name}`, copied: true }
        }
        if (number !== undefined) return copyOf(draftFolder(number))
        const doc = open.get(id)
        if (doc === undefined) throw hostError('not-open', `no open document ${id}`)
        if (doc.readOnly !== null) throw hostError('read-only', 'it cannot be edited')
        const folder = parentOf(doc.path)
        // The innermost workspace folder that holds the document, or its own folder.
        const boundary = roots
          .filter((root) => pathKey(doc.path).startsWith(`${trimmed(root)}/`))
          .sort((a, b) => b.length - a.length)[0]
        const limit = trimmed(boundary ?? folder)
        const key = pathKey(slashes(path))
        if (key.startsWith(`${limit}/`)) {
          const from = trimmed(folder).split('/')
          const to = slashes(path).split('/')
          let common = 0
          while (
            common < from.length &&
            common < to.length - 1 &&
            pathKey(from[common] ?? '') === pathKey(to[common] ?? '')
          )
            common++
          const link = [
            ...Array<string>(from.length - common).fill('..'),
            ...to.slice(common),
          ].join('/')
          return { link, copied: false }
        }
        return copyOf(folder)
      })
    },
    createFile(parent, name) {
      return attempt(() => {
        checkName(name)
        folderInRoot(parent)
        const path = `${slashes(parent)}/${name}`
        if (exists(path)) throw hostError('exists', `${name} already exists`)
        files.write(path, '')
        return path
      })
    },
    createFolder(parent, name) {
      return attempt(() => {
        checkName(name)
        folderInRoot(parent)
        const path = `${slashes(parent)}/${name}`
        if (exists(path)) throw hostError('exists', `${name} already exists`)
        files.mkdir(path)
        return path
      })
    },
    renameEntry(path, newName) {
      return attempt(() => rename(path, newName))
    },
    moveEntry(path, into) {
      return attempt(() => moveInto(path, into))
    },
    rewriteCheck(path, change) {
      return attempt(() => targetOf(path, change) !== null)
    },
    linksOnRenameOverride() {
      return Promise.resolve(options.linksOnRename ?? null)
    },
    rewritePlan(path, change, buffers, onProgress) {
      return planRewrite(path, change, buffers, onProgress)
    },
    rewriteMove(token, buffers) {
      return attempt(() => finishRewrite(token, buffers))
    },
    rewriteCancel() {
      cancelled = true
      return Promise.resolve()
    },
    rewriteDiscard(token) {
      if (pending?.token === token) pending = null
      return Promise.resolve()
    },
    quickOpenQuery(query, limit) {
      return Promise.resolve(mockQuickOpen(files.paths(), roots, query, limit))
    },
    deleteEntry(path) {
      return attempt(() => {
        entryInRoot(path)
        recycled.push(...files.remove(path))
      })
    },
    revealEntry(path) {
      return attempt(() => {
        // A file the user opened is shown wherever it is; anything else must be inside a root.
        const isOpen = [...open.values()].some((doc) => pathKey(doc.path) === pathKey(path))
        if (!insideRoot(path) && !isOpen) {
          throw hostError('not-allowed', `access to ${path} is not allowed`)
        }
        revealed.push(path)
      })
    },
    showFolder(path) {
      return attempt(() => {
        if (!insideRoot(path)) {
          throw hostError('not-allowed', `access to ${path} is not allowed`)
        }
        if (!files.isFolder(path)) throw hostError('invalid', `${path} is not a folder`)
        openedFolders.push(path)
      })
    },
    async findReferences(path, buffers) {
      const held = new Map<string, string>()
      for (const buffer of buffers) {
        const doc = open.get(buffer.id)
        if (doc !== undefined) held.set(pathKey(doc.path), buffer.text)
      }
      const references: Reference[] = []
      const withLinks = new Set<string>()
      let scanned = 0
      for (const file of files.paths()) {
        if (!insideRoot(file) || !isScannable(file)) continue
        await Promise.resolve()
        scanned += 1
        const text = held.get(pathKey(file)) ?? files.read(file) ?? ''
        for (const hit of mockReferences(file, text, path)) {
          references.push({ path: file, ...hit })
          withLinks.add(pathKey(file))
        }
      }
      references.sort(
        (a, b) =>
          a.path.toLowerCase().localeCompare(b.path.toLowerCase()) ||
          a.line - b.line ||
          a.column - b.column,
      )
      return { references, files: withLinks.size, scanned, skipped: [], truncated: false }
    },
    async searchFolders(request, buffers, onBatch) {
      searchCurrent = request.id
      const stopped = (): boolean => searchCurrent !== request.id
      const empty: SearchSummary = {
        id: request.id,
        scanned: 0,
        files: 0,
        hits: 0,
        skipped: 0,
        truncated: false,
        stopped: false,
        error: null,
        errorField: null,
      }
      const matcher = mockMatcher(request)
      if ('error' in matcher) return { ...empty, error: matcher.error }
      const filters = mockFilters(request, roots)
      if ('error' in filters) {
        return { ...empty, error: filters.error, errorField: filters.errorField }
      }
      const held = new Map<string, string>()
      for (const buffer of buffers) {
        const doc = open.get(buffer.id)
        if (doc !== undefined) held.set(pathKey(doc.path), buffer.text)
      }
      let scanned = 0
      let withHits = 0
      let total = 0
      let truncated = false
      for (const file of [...files.paths()].sort()) {
        const key = pathKey(file)
        if (!insideRoot(file) || /(^|\/)(node_modules|\.git)(\/|$)/i.test(key)) continue
        if (!filters.keeps(file)) continue
        // A turn of the event loop per file, as a search that takes time would give: this is
        // what lets a newer search or a cancel land while this one runs.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        if (stopped()) break
        scanned += 1
        const text = held.get(key) ?? files.read(file) ?? ''
        const found = mockSearchText(text, matcher.regex, request.wholeWord)
        if (found.length > 0) {
          const room = MAX_SEARCH_HITS - total
          if (found.length > room) truncated = true
          const kept = found.slice(0, Math.max(room, 0))
          total += kept.length
          withHits += 1
          onBatch({ id: request.id, scanned, hits: kept.map((hit) => ({ path: file, ...hit })) })
        }
        if (truncated) break
      }
      onBatch({ id: request.id, scanned, hits: [] })
      return { ...empty, scanned, files: withHits, hits: total, truncated, stopped: stopped() }
    },
    searchCancel() {
      searchCurrent = 0
      return Promise.resolve()
    },
    outlineScan(request) {
      // The text the page sent, or the file as the mock holds it. A file that is not there is not
      // allowed, as in the app.
      if (request.text !== undefined) return Promise.resolve(mockOutline(request.id, request.text))
      const file = request.path === undefined ? undefined : files.read(request.path)
      if (file === undefined) return Promise.reject(new Error('That file is not open.'))
      return Promise.resolve(mockOutline(request.id, file))
    },
    writeClipboard(text) {
      clipboard.push(text)
      return Promise.resolve()
    },
    copyClashes(into, paths) {
      return attempt(() => {
        folderInRoot(into)
        requireDropped(paths)
        return paths.map(nameOf).filter((name) => exists(`${slashes(into)}/${name}`))
      })
    },
    copyDropped(into, paths, answers: readonly ClashAnswer[]) {
      return attempt((): CopyReport => {
        folderInRoot(into)
        requireDropped(paths)
        const copied: string[] = []
        const skipped: string[] = []
        const failed: { name: string; message: string }[] = []
        for (const source of paths) {
          const name = nameOf(source)
          const isFolder = files.isFolder(source)
          const intoSelf =
            trimmed(into) === trimmed(source) || trimmed(into).startsWith(`${trimmed(source)}/`)
          if (isFolder && intoSelf) {
            failed.push({ name, message: 'a folder cannot be copied into itself' })
            continue
          }
          let target = `${slashes(into)}/${name}`
          if (exists(target)) {
            const answer =
              trimmed(target) === trimmed(source)
                ? 'keep-both'
                : (answers.find((clash) => clash.name === name)?.answer ?? 'skip')
            if (answer === 'skip') {
              skipped.push(name)
              continue
            }
            if (answer === 'keep-both') {
              const free = freeName(name, isFolder, (item) => exists(`${slashes(into)}/${item}`))
              target = `${slashes(into)}/${free}`
            } else {
              if (files.isFolder(target) !== isFolder) {
                failed.push({ name, message: 'a file and a folder cannot replace each other' })
                continue
              }
              recycled.push(...files.remove(target))
            }
          }
          copyTree(source, target)
          copied.push(target)
        }
        return { copied, skipped, failed, linksLeft: 0 }
      })
    },
    addDroppedRoot(path) {
      const known = new Set(drops.flat().map((entry) => pathKey(entry)))
      if (!known.has(pathKey(path))) {
        return Promise.reject(
          hostError('not-allowed', 'access to a path no drop delivered is not allowed'),
        )
      }
      return attempt(() => addRoot(path))
    },
    loadSession() {
      return Promise.resolve(host.session)
    },
    writeSession(json) {
      host.session = json
      return Promise.resolve()
    },
    recoverBuffer(name, text, untitledNumber) {
      // Like Rust: the images of an untitled document's text are kept beside the recovered file.
      const kept =
        untitledNumber === undefined
          ? text
          : adoptDraftImages(untitledNumber, text, '/recovered').text
      host.recovered.push({ name, text: kept })
      return Promise.resolve(`/recovered/${name}-${String(host.recovered.length)}.md`)
    },
    watchClose(onClose) {
      closeListener = onClose
      return Promise.resolve()
    },
    quitApp() {
      host.quits++
      return Promise.resolve()
    },
    withoutEvents(run) {
      deaf = true
      try {
        run()
      } finally {
        deaf = false
      }
    },
    platformName() {
      return Promise.resolve('browser')
    },
    showWindow() {
      return Promise.resolve()
    },
    windowControls: mockWindowControls(),
    assetUrl(path) {
      const listed = options.images?.[files.canonicalPath(path) ?? path]
      if (listed !== undefined) return listed.url
      const pasted = pastedImages.findLast((image) => pathKey(image.path) === pathKey(path))
      if (pasted !== undefined) {
        const ext = pasted.path.split('.').pop() ?? 'png'
        const binary = Array.from(pasted.bytes, (byte) => String.fromCharCode(byte)).join('')
        return `data:${IMAGE_MIME[ext] ?? 'image/png'};base64,${btoa(binary)}`
      }
      // The mock's files are text, so an image here is an SVG. Anything else, or a file that is
      // not there, gets an address that fails to load, as a missing file does in the real app.
      const raw = path.toLowerCase().endsWith('.svg') ? files.read(path) : undefined
      if (raw === undefined) return `mock-asset-missing:${encodeURIComponent(path)}`
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`
    },
    readFile(path) {
      const raw = files.read(path)
      if (raw === undefined) return Promise.reject(hostError('not-found', `${path} does not exist`))
      return Promise.resolve(new TextEncoder().encode(raw).buffer)
    },
    pickFiles() {
      return Promise.resolve(options.pick?.() ?? [])
    },
    openFile(path, rememberIt): Promise<OpenedFile> {
      const raw = files.read(path)
      const canonical = files.canonicalPath(path)
      if (raw === undefined || canonical === undefined) {
        return Promise.reject(hostError('not-found', `${path} does not exist`))
      }
      const key = canonical.toLowerCase()
      let id = ids.get(key)
      if (id === undefined) {
        id = ++nextId
        ids.set(key, id)
      }
      // Like Rust: a file that is already open keeps what the host recorded for it. The page holds
      // the text it read earlier, and decides what the fresh content means.
      // Like Rust, a file the user chose goes on the recent list every time, open already or not.
      if (rememberIt === true) remember(recent.files, canonical, 10)
      const existing = open.get(id)
      if (existing !== undefined) return Promise.resolve(describe(id, existing, raw))
      const readOnly: ReadOnlyReason | null = files.isUnsupported(canonical)
        ? 'unsupported-encoding'
        : null
      const doc: Open = { path: canonical, readOnly, known: mockHash(raw), reported: null }
      open.set(id, doc)
      return Promise.resolve(describe(id, doc, raw))
    },
    newUntitled(number) {
      if ([...draftNumbers.values()].includes(number)) {
        return Promise.reject(hostError('invalid', `Untitled-${String(number)} is already open`))
      }
      const id = ++nextId
      untitled.add(id)
      draftNumbers.set(id, number)
      return Promise.resolve({ id, draftFolder: draftFolder(number) })
    },
    sweepDrafts(keep) {
      sweeps.push([...keep])
      const held = new Set([...keep, ...draftNumbers.values()])
      let removed = 0
      for (const entry of files.listDir(DRAFT_ROOT) ?? []) {
        const number = Number(entry.name)
        if (entry.kind !== 'folder' || !Number.isInteger(number) || held.has(number)) continue
        files.remove(`${DRAFT_ROOT}/${entry.name}`)
        removed++
      }
      return Promise.resolve(removed)
    },
    saveAs(id, text, endings, hint) {
      const doc = open.get(id)
      if (!untitled.has(id) && doc === undefined) {
        return Promise.reject(hostError('not-open', `no open document ${id}`))
      }
      saveDialogs.push(hint)
      const chosen = options.pickSave?.(hint) ?? null
      if (chosen === null) return Promise.resolve(null)
      let target = slashes(chosen)
      if (untitled.has(id) && !/\.[^/]+$/.test(nameOf(target))) {
        // Like Rust: a name with no extension becomes .md, and never replaces a file unasked.
        target = `${target}.md`
        if (files.has(target)) {
          return Promise.reject(hostError('exists', `${target} already exists`))
        }
      }
      const canonical = files.canonicalPath(target) ?? target
      const key = canonical.toLowerCase()
      if (key === doc?.path.toLowerCase()) {
        // The document's own file: an ordinary save, and an unwritable original is never replaced.
        if (doc.readOnly !== null) {
          return Promise.reject(
            hostError('read-only', 'choose a different file name; the original is left as it is'),
          )
        }
        return host.saveFile(id, text, endings).then((saved) => ({
          path: doc.path,
          name: nameOf(doc.path),
          hash: saved.hash,
          size: saved.size,
          kind: mockKindOf(doc.path),
          encoding: 'utf-8',
          bom: false,
          renamedImages: [],
        }))
      }
      const other = ids.get(key)
      if (other !== undefined && other !== id && open.has(other)) {
        return Promise.reject(
          hostError(
            'invalid',
            `${nameOf(canonical)} is open in another tab; close it or choose another name`,
          ),
        )
      }
      const number = draftNumbers.get(id)
      if (number !== undefined && pathKey(canonical).startsWith(`${pathKey(DRAFT_ROOT)}/`)) {
        return Promise.reject(hostError('invalid', 'choose a folder of your own'))
      }
      // Like Rust: the images of an untitled document the text links to are copied beside the new
      // file first, a taken name is not overwritten, and the links in what is written follow.
      let renamedImages: { from: string; to: string }[] = []
      let written = text
      if (number !== undefined) {
        const adopted = adoptDraftImages(number, text, parentOf(canonical))
        renamedImages = adopted.renamedImages
        written = adopted.text
        files.remove(draftFolder(number))
        draftNumbers.delete(id)
      }
      const raw = joinRaw(written, endings)
      const hash = mockHash(raw)
      // Like Rust, the file is written before the document is pointed at it, and its hash is
      // recorded, so the write is not news to the watcher.
      files.write(canonical, raw)
      if (doc === undefined) {
        untitled.delete(id)
        open.set(id, { path: canonical, readOnly: null, known: hash, reported: null })
      } else {
        ids.delete(doc.path.toLowerCase())
        doc.path = canonical
        doc.readOnly = null
        doc.known = hash
        doc.reported = null
      }
      ids.set(key, id)
      remember(recent.files, canonical, 10)
      return Promise.resolve({
        path: canonical,
        name: nameOf(canonical),
        hash,
        size: new TextEncoder().encode(raw).length,
        kind: mockKindOf(canonical),
        encoding: 'utf-8',
        bom: false,
        renamedImages,
      })
    },
    documentExists(id) {
      const doc = open.get(id)
      if (doc === undefined) return Promise.reject(hostError('not-open', `no open document ${id}`))
      return Promise.resolve(files.has(doc.path))
    },
    recentList() {
      return Promise.resolve({
        files: recent.files.filter((path) => files.has(path)),
        folders: recent.folders.filter((path) => files.isFolder(path)),
      })
    },
    recentClear() {
      recent.files.length = 0
      recent.folders.length = 0
      return Promise.resolve()
    },
    recentOpenFile(path) {
      const key = pathKey(path)
      const entry = recent.files.find((file) => pathKey(file) === key)
      if (entry === undefined) {
        return Promise.reject(hostError('not-allowed', `access to ${path} is not allowed`))
      }
      remember(recent.files, entry, 10)
      return Promise.resolve(entry)
    },
    recentOpenFolder(path) {
      const key = pathKey(path)
      const entry = recent.folders.find((folder) => pathKey(folder) === key)
      if (entry === undefined) {
        return Promise.reject(hostError('not-allowed', `access to ${path} is not allowed`))
      }
      return attempt(() => {
        const root = addRoot(entry)
        remember(recent.folders, root, 5)
        return root
      })
    },
    saveFile(id: number, text: string, endings: Endings) {
      const doc = open.get(id)
      if (doc === undefined) return Promise.reject(hostError('not-open', `no open document ${id}`))
      if (doc.readOnly !== null) {
        return Promise.reject(hostError('read-only', 'the document is read-only'))
      }
      // Like Rust: a file that changed since the document last read or wrote it is not overwritten.
      const current = files.read(doc.path)
      if (current !== undefined && mockHash(current) !== doc.known) {
        return Promise.reject(
          hostError('disk-changed', 'the file changed on disk since it was opened or last saved'),
        )
      }
      const raw = joinRaw(text, endings)
      const hash = mockHash(raw)
      // Recorded before the write, so the event the write raises is recognized as our own.
      doc.known = hash
      doc.reported = null
      files.write(doc.path, raw)
      return Promise.resolve({ hash, size: new TextEncoder().encode(raw).length })
    },
    closeDocument(id) {
      open.delete(id)
      untitled.delete(id)
      const number = draftNumbers.get(id)
      if (number !== undefined) {
        draftNumbers.delete(id)
        files.remove(draftFolder(number))
      }
      return Promise.resolve()
    },
    reloadDocument(id) {
      const doc = open.get(id)
      if (doc === undefined) return Promise.reject(hostError('not-open', `no open document ${id}`))
      const raw = files.read(doc.path)
      if (raw === undefined) {
        return Promise.reject(hostError('not-found', `${doc.path} does not exist`))
      }
      doc.known = mockHash(raw)
      doc.reported = null
      doc.readOnly = files.isUnsupported(doc.path) ? 'unsupported-encoding' : null
      return Promise.resolve(describe(id, doc, raw))
    },
    watchChanges(onChange) {
      listener = onChange
      return Promise.resolve(() => {
        if (listener === onChange) listener = undefined
      })
    },
  }
  return host
}

/** A few files to open under pnpm dev, one with Windows line endings and one with mixed endings. */
const DEMO_FILES: Readonly<Record<string, string>> = {
  '/demo/README.md':
    '# mdmate\n\nA **fast** inline Markdown editor.\n\n- Open a file with Ctrl+O\n- Edit it\n- Save with Ctrl+S\n',
  '/demo/notes.md': '# Notes\n\nSome *notes* with `code`.\n\n> A quote.\n',
  '/demo/crlf.md': '# Windows file\r\n\r\nEvery line here ends in CRLF.\r\nSo does this one.\r\n',
  '/demo/mixed.md': 'LF line\nCRLF line\r\nold Mac line\rlast line\n',
  '/demo/roadmap.md': '# Roadmap\n\n1. Documents\n2. Preview\n3. Links\n',
  // Not Markdown, and one level down: they give the sidebar something to dim and to open.
  '/demo/docs/guide.md': '# Guide\n\nA file in a folder.\n',
  '/demo/docs/todo.txt': 'buy milk\n',
  '/demo/docs/logo.png': 'not really a png',
  '/demo/docs/big.png': 'a large picture, drawn from demoImages',
  '/demo/docs/scripted.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">' +
    '<rect width="400" height="200" fill="gold"/>' +
    '<text x="24" y="112" font-size="26">An SVG with a script in it</text>' +
    "<script>top.postMessage('SVG-RAN', '*'); document.title = 'SVG-RAN'</script></svg>",
}

// The Open dialog cycles through the Markdown files that sit directly in the demo folder.
const demoOrder = Object.keys(DEMO_FILES).filter(
  (path) => path.endsWith('.md') && !path.startsWith('/demo/docs/'),
)
let demoNext = 0

/** Browser stand-in, so UI work runs under pnpm dev with no Rust. */
export const mockHost: MockHost = createMockHost({
  files: DEMO_FILES,
  images: DEMO_IMAGES,
  // Each time Open is used, the next demo file: there is no real dialog in a browser tab.
  pick: () => {
    const path = demoOrder[demoNext % demoOrder.length]
    demoNext++
    return path === undefined ? [] : [path]
  },
  pickFolder: () => '/demo',
})
