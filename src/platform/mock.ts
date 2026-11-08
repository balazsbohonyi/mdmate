import type { Endings } from '@/lib/endings'
import type { DiskChange, Host, OpenedFile, ReadOnlyReason, WindowControls } from './host'
import type { LinkInfo } from './links'
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

  const host: MockHost = {
    kind: 'browser',
    files,
    openDocuments() {
      return new Map([...open].map(([id, doc]) => [id, doc.path]))
    },
    session: null,
    recovered: [],
    quits: 0,
    opened: [],
    describeLink(id, href) {
      const doc = open.get(id)
      if (doc === undefined) return Promise.reject(hostError('not-open', `no open document ${id}`))
      return Promise.resolve(mockDescribeLink(files, doc.path, href))
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
}

const demoOrder = Object.keys(DEMO_FILES)
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
})
