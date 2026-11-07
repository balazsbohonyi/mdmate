import type { Endings } from '@/lib/endings'

/** What the perf harness asked this run to do. Mirrors the Rust `PerfConfig`. */
export interface PerfConfig {
  scenario: string
  fixturesDir: string
  /** JSON text from the harness. */
  params: string
  /** Wall-clock ms when Rust first ran. */
  rustStartedMs: number
}

/** A file drag over the window, as the OS reports it. Positions are what Tauri hands over. */
export interface PerfDragDrop {
  type: 'enter' | 'over' | 'drop' | 'leave'
  position?: { x: number; y: number }
  paths?: string[]
}

/** The bridge to the harness. Only perf builds have one. */
export interface PerfHost {
  config(): Promise<PerfConfig>
  /** Hands the result to the harness, which quits the app. */
  report(json: string): Promise<void>
  /** P0 lab: the URL that serves a local file through the asset protocol. */
  assetUrl(path: string): string
  /** P0 lab: grows the asset protocol scope while the app runs. */
  allowAssetDirectory(path: string): Promise<void>
  /** P0 lab: maximizes or restores the window. */
  toggleMaximize(): Promise<void>
  /** P0 lab: starts an OS window drag from the page's own title bar. */
  startDragging(): Promise<void>
  /** P0 lab: file drag events from the OS. Returns the function that stops listening. */
  onDragDrop(handler: (event: PerfDragDrop) => void): Promise<() => void>
}

/** The caption buttons of the custom title bar. The window has no native frame. */
export interface WindowControls {
  minimize(): Promise<void>
  /** Maximizes the window, or restores it when it is already maximized. */
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  /** Tells the handler each time the window is maximized or restored. Returns the stop function. */
  onMaximizedChange(handler: (maximized: boolean) => void): Promise<() => void>
}

/** Why a document cannot be saved. Mirrors the Rust `ReadOnlyReason`. */
export type ReadOnlyReason = 'unsupported-encoding' | 'not-round-trippable'

/** A file as Rust opened it: decoded text with a plain newline as its only break, and the ending of every break. */
export interface OpenedFile {
  /** Rust's id for the open document. Saves and closes name the document by it. */
  readonly id: number
  /** The path as people read it, with symlinks resolved. */
  readonly path: string
  readonly name: string
  readonly encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'unsupported'
  readonly bom: boolean
  readonly readOnly: ReadOnlyReason | null
  /** The size on disk, in bytes. */
  readonly size: number
  /** Hash of the bytes as read, 32 hex digits. */
  readonly hash: string
  readonly text: string
  readonly endings: Endings
}

/** What a save wrote. */
export interface SavedFile {
  /** Hash of the bytes now on disk. */
  readonly hash: string
  readonly size: number
}

/**
 * A change another program made to the file of an open document. Never raised for the app's own
 * saves: Rust compares the content on disk with what the document last read or wrote.
 */
export interface DiskChange {
  /** Rust's id for the document. */
  readonly id: number
  /** Hash of the content now on disk, 32 hex digits. */
  readonly hash: string
}

/** Everything the UI needs from the machine. Implemented once per runtime. */
export interface Host {
  readonly kind: 'tauri' | 'browser'
  /** The OS name, as reported by the platform layer. */
  platformName(): Promise<string>
  /** Shows the window. It starts hidden so launch never flashes a blank frame. */
  showWindow(): Promise<void>
  readonly windowControls: WindowControls
  /** A file's bytes, untouched. They cross as raw binary, never as JSON. */
  readFile(path: string): Promise<ArrayBuffer>
  /**
   * Shows the open dialog and returns the files chosen, which is also what lets Rust open them.
   * Empty when the user cancels.
   */
  pickFiles(): Promise<string[]>
  /** Opens a file the user chose. Opening the same file again returns the same document id. */
  openFile(path: string): Promise<OpenedFile>
  /** Writes the text and endings into an open document, by its id. */
  saveFile(id: number, text: string, endings: Endings): Promise<SavedFile>
  /** Tells Rust the document has no tab left. */
  closeDocument(id: number): Promise<void>
  /**
   * Reads an open document's file again. Rust then counts the document as in step with what it
   * read, so the page decides what to do with it: show it, or only remember it as the disk's.
   */
  reloadDocument(id: number): Promise<OpenedFile>
  /**
   * Calls `onChange` for each change another program makes to the file of an open document.
   * Returns the function that stops listening. Only one listener is live at a time.
   */
  watchChanges(onChange: (change: DiskChange) => void): Promise<() => void>
  /** Present only where the harness can drive the app. */
  readonly perf?: PerfHost
}
