import type { Endings } from '@/lib/endings'
import type { Host, OpenedFile, ReadOnlyReason, WindowControls } from './host'
import { joinRaw, MockFiles, mockHash, splitRaw } from './mockFiles'

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
  const open = new Map<number, { path: string; readOnly: ReadOnlyReason | null }>()
  let nextId = 0

  const host: MockHost = {
    kind: 'browser',
    files,
    openDocuments() {
      return new Map([...open].map(([id, doc]) => [id, doc.path]))
    },
    platformName() {
      return Promise.resolve('browser')
    },
    showWindow() {
      return Promise.resolve()
    },
    windowControls: mockWindowControls(),
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
      const unsupported = files.isUnsupported(canonical)
      const readOnly: ReadOnlyReason | null = unsupported ? 'unsupported-encoding' : null
      open.set(id, { path: canonical, readOnly })
      const { text, endings } = splitRaw(raw)
      return Promise.resolve({
        id,
        path: canonical,
        name: canonical.split('/').pop() ?? canonical,
        encoding: unsupported ? 'unsupported' : 'utf-8',
        bom: false,
        readOnly,
        size: new TextEncoder().encode(raw).length,
        hash: mockHash(raw),
        text,
        endings,
      })
    },
    saveFile(id: number, text: string, endings: Endings) {
      const doc = open.get(id)
      if (doc === undefined) return Promise.reject(hostError('not-open', `no open document ${id}`))
      if (doc.readOnly !== null) {
        return Promise.reject(hostError('read-only', 'the document is read-only'))
      }
      const raw = joinRaw(text, endings)
      files.write(doc.path, raw)
      return Promise.resolve({ hash: mockHash(raw), size: new TextEncoder().encode(raw).length })
    },
    closeDocument(id) {
      open.delete(id)
      return Promise.resolve()
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
