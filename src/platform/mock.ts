import type { Endings } from '@/lib/endings'
import { freeName, nameProblem } from '@/lib/fileNames'
import type { DiskChange, Host, OpenedFile, ReadOnlyReason, WindowControls } from './host'
import type { LinkInfo } from './links'
import type {
  ClashAnswer,
  CopyReport,
  DroppedItem,
  FileDragEvent,
  Moved,
  MovedDocument,
  Point,
} from './workspace'
import { joinRaw, MockFiles, mockHash, pathKey, splitRaw } from './mockFiles'

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
  /** Files that exist from the start, by path. */
  readonly files?: Readonly<Record<string, string>>
  /** What the open dialog returns each time it is shown. Default: no files, as if cancelled. */
  readonly pick?: () => string[]
  /** What the folder dialog returns each time it is shown. Default: null, as if cancelled. */
  readonly pickFolder?: () => string | null
  /** Workspace roots the host already has, as if the last run left them. */
  readonly roots?: readonly string[]
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
  let dragListener: ((event: FileDragEvent) => void) | undefined
  /** The paths of the last few native drops, newest last. */
  const drops: string[][] = []
  const dropsKept = 4

  const recycled: { path: string; raw: string }[] = []
  const revealed: string[] = []
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
      return attempt(() => (picked === null ? null : addRoot(picked)))
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
      return attempt((): Moved => {
        checkName(newName)
        entryInRoot(path)
        const target = `${parentOf(path)}/${newName}`
        if (slashes(target) === slashes(path)) return { path: target, documents: [] }
        if (exists(target) && trimmed(target) !== trimmed(path)) {
          throw hostError('exists', `${newName} already exists`)
        }
        files.move(path, target)
        return { path: target, documents: followMove(path, target) }
      })
    },
    moveEntry(path, into) {
      return attempt((): Moved => {
        entryInRoot(path)
        folderInRoot(into)
        const [from, destination] = [trimmed(path), trimmed(into)]
        if (destination === from || destination.startsWith(`${from}/`)) {
          throw hostError('invalid', 'a folder cannot be moved into itself')
        }
        const target = `${slashes(into)}/${nameOf(path)}`
        if (slashes(target) === slashes(path)) return { path: target, documents: [] }
        if (exists(target)) throw hostError('exists', `${nameOf(path)} already exists`)
        files.move(path, target)
        return { path: target, documents: followMove(path, target) }
      })
    },
    deleteEntry(path) {
      return attempt(() => {
        entryInRoot(path)
        recycled.push(...files.remove(path))
      })
    },
    revealEntry(path) {
      return attempt(() => {
        if (!insideRoot(path)) throw hostError('not-allowed', `access to ${path} is not allowed`)
        revealed.push(path)
      })
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
    recoverBuffer(name, text) {
      host.recovered.push({ name, text })
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
    openFile(path): Promise<OpenedFile> {
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
      const existing = open.get(id)
      if (existing !== undefined) return Promise.resolve(describe(id, existing, raw))
      const readOnly: ReadOnlyReason | null = files.isUnsupported(canonical)
        ? 'unsupported-encoding'
        : null
      const doc: Open = { path: canonical, readOnly, known: mockHash(raw), reported: null }
      open.set(id, doc)
      return Promise.resolve(describe(id, doc, raw))
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
}

// The Open dialog cycles through the Markdown files that sit directly in the demo folder.
const demoOrder = Object.keys(DEMO_FILES).filter(
  (path) => path.endsWith('.md') && !path.startsWith('/demo/docs/'),
)
let demoNext = 0

/** Browser stand-in, so UI work runs under pnpm dev with no Rust. */
export const mockHost: MockHost = createMockHost({
  files: DEMO_FILES,
  // Each time Open is used, the next demo file: there is no real dialog in a browser tab.
  pick: () => {
    const path = demoOrder[demoNext % demoOrder.length]
    demoNext++
    return path === undefined ? [] : [path]
  },
  pickFolder: () => '/demo',
})
