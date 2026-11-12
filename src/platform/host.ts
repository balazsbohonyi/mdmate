import type { Endings } from '@/lib/endings'
import type { FollowedLink, LinkInfo } from './links'
import type { QuickOpenAnswer } from './quickOpen'
import type { ReferencesFound } from './references'
import type { RewriteBuffer, RewriteChange, RewriteDone, RewritePlanned } from './rewrite'
import type { SearchBatch, SearchRequest, SearchSummary } from './search'
import type {
  ClashAnswer,
  CopyReport,
  DroppedItem,
  FileDragEvent,
  FileKind,
  ImageInfo,
  Moved,
  TreeEntry,
} from './workspace'

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
  /** Hands a result to the harness and keeps running, so the harness can kill the app where it stands. */
  ready(json: string): Promise<void>
  /** Lets the page open a file without the native dialog. */
  grantFile(path: string): Promise<void>
  /** Makes a folder a workspace root without the native dialog, so a scan can read it. */
  grantRoot(path: string): Promise<void>
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
  /** How the file opens: Markdown in the live editor, anything else as plain source. */
  readonly kind: FileKind
}

/** What a save wrote. */
export interface SavedFile {
  /** Hash of the bytes now on disk. */
  readonly hash: string
  readonly size: number
}

/** What Save As wrote: the file the document now has. */
export interface SavedAs {
  /** The path as people read it, with symlinks resolved. */
  readonly path: string
  readonly name: string
  /** Hash of the bytes now on disk, 32 hex digits. */
  readonly hash: string
  readonly size: number
  readonly kind: 'markdown' | 'text' | 'image'
  readonly encoding: 'utf-8' | 'utf-16le' | 'utf-16be'
  readonly bom: boolean
}

/** What the page suggests the save dialog shows. */
export interface SaveAsHint {
  /** The file name to suggest. */
  readonly name: string
  /** The folder to start in, or null to leave it to the system. */
  readonly folder: string | null
}

/** The Open Recent lists, newest first. */
export interface RecentLists {
  readonly files: readonly string[]
  readonly folders: readonly string[]
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
  /**
   * Opens a file the user chose. Opening the same file again returns the same document id.
   * `remember` puts the file on the Open Recent list, for a file the user chose to open; a
   * restored session does not pass it.
   */
  openFile(path: string, remember?: boolean): Promise<OpenedFile>
  /** Gives a new untitled tab its document id. The document has no file until `saveAs`. */
  newUntitled(): Promise<number>
  /**
   * Shows the save dialog and writes the document into the file the user chooses: the first save of
   * an untitled document, or Save As. Granting the chosen file happens in the host, never on the
   * page's say-so. The document then has that file; the original of a Save As is not touched, and a
   * file in an encoding mdmate cannot write is written as UTF-8. Resolves to null when the user
   * cancels. Rejects with `invalid` for a file open in another tab, `exists` for a name the dialog
   * could not have asked about, and `read-only` when asked to replace an unwritable original.
   */
  saveAs(id: number, text: string, endings: Endings, hint: SaveAsHint): Promise<SavedAs | null>
  /** Whether the file of an open document is still on disk. */
  documentExists(id: number): Promise<boolean>
  /** The Open Recent lists: files and folders the user opened, with those that are gone dropped. */
  recentList(): Promise<RecentLists>
  /** Empties the Open Recent lists. */
  recentClear(): Promise<void>
  /** Lets the page open a file on the Open Recent list. Rejects with `not-allowed` for any other path. */
  recentOpenFile(path: string): Promise<string>
  /** Makes a folder on the Open Recent list a workspace root again. Rejects with `not-allowed` for any other path. */
  recentOpenFolder(path: string): Promise<string>
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
  /** The last run's session snapshot as the JSON text the page wrote, or null on a first start. Grants the files that run had open. */
  loadSession(): Promise<string | null>
  /** Replaces the session snapshot on disk. Resolves once it is safely written. */
  writeSession(json: string): Promise<void>
  /** Keeps text that could not be put back in a tab, in a file of its own. Resolves to where it went. */
  recoverBuffer(name: string, text: string): Promise<string>
  /**
   * Calls `onClose` when the user closes the window, instead of the window closing. The page then
   * writes the session and calls `quitApp`. Only one listener is live at a time.
   */
  watchClose(onClose: () => void): Promise<void>
  /** Ends the app. */
  quitApp(): Promise<void>
  /**
   * The address the webview loads a file on disk from, for an image next to a document. Rust must
   * have allowed the file's folder first, which it does when it opens the document.
   */
  assetUrl(path: string): string
  /**
   * Where a link written in a document leads, from Rust's link guard. Opens and grants nothing.
   * `href` is the target exactly as written; the folder comes from Rust's record of the document.
   */
  describeLink(id: number, href: string): Promise<LinkInfo>
  /**
   * Follows a link written in a document. Web and mail links and images open at once; a Markdown
   * file becomes openable and its path comes back; any other file opens in its default app only
   * with `confirmed`, and rejects with kind `needs-confirmation` without it. A refused target
   * rejects with kind `link-refused`, a missing one with `not-found`.
   */
  followLink(id: number, href: string, confirmed: boolean): Promise<FollowedLink>
  /**
   * For each target written in a document, whether it is a relative path to a file that is not
   * there. At most 500 targets per call. Opens and grants nothing.
   */
  checkLinks(id: number, hrefs: readonly string[]): Promise<boolean[]>
  /**
   * Shows the system's folder dialog and makes the chosen folder a workspace root, which is also
   * what lets Rust list and open files inside it. Resolves to the folder, or null when cancelled.
   */
  openFolder(): Promise<string | null>
  /**
   * The workspace roots the last run left, in order, granted again. Rust keeps this list itself,
   * so a session snapshot cannot add a root. Called once at startup.
   */
  loadWorkspace(): Promise<string[]>
  /** Takes a folder out of the workspace and revokes the page's access to it. */
  removeRoot(path: string): Promise<void>
  /** Lists one folder inside a workspace root: folders first, then files, each in name order. */
  listDir(path: string): Promise<TreeEntry[]>
  /**
   * Calls `onChange` with a folder each time its listing went out of date. Rust watches only the
   * folders `watchFolders` last named. Returns the function that stops listening; one listener is
   * live at a time.
   */
  watchTree(onChange: (folder: string) => void): Promise<() => void>
  /** Says which folders the sidebar has open, so only those are watched. Replaces the last set. */
  watchFolders(paths: readonly string[]): Promise<void>
  /**
   * Calls `handler` for each step of a file drag from the OS over the window, with positions in
   * page pixels. Returns the function that stops listening.
   */
  onFileDrag(handler: (event: FileDragEvent) => void): Promise<() => void>
  /** Says what each dropped path is. Rejects with `not-allowed` unless a native drop delivered every path. */
  describeDrop(paths: readonly string[]): Promise<DroppedItem[]>
  /**
   * Lets the page open the files of a native drop, and says what each is. Rejects with
   * `not-allowed`, granting nothing, unless a native drop delivered every path.
   */
  openDropped(paths: readonly string[]): Promise<DroppedItem[]>
  /** What a file the page may read opens as. Rejects with `not-allowed` for any other path. */
  fileKind(path: string): Promise<FileKind>
  /**
   * Checks that an image may be shown, lets the image protocol serve that one file, and says how
   * big it is. Rejects with `not-allowed` for a path the page was never given, and `invalid` for
   * a file that is not an image.
   */
  imageInfo(path: string): Promise<ImageInfo>
  /** Says that no tab shows this image any more, so the next session does not grant it again. */
  imageClosed(path: string): Promise<void>
  /** Makes a dropped folder a workspace root. Rejects with `not-allowed` for a path no drop delivered. */
  addDroppedRoot(path: string): Promise<string>
  /**
   * Makes an empty file in a folder of the workspace and resolves to its path. Rejects with kind
   * `exists` when the name is taken and `invalid` when it cannot be a name.
   */
  createFile(parent: string, name: string): Promise<string>
  /** Like `createFile`, for a folder. */
  createFolder(parent: string, name: string): Promise<string>
  /**
   * Renames a file or folder of the workspace. Open documents under it follow the file: the answer
   * lists them, and a later save by id writes the new path. Never touches a workspace root.
   */
  renameEntry(path: string, newName: string): Promise<Moved>
  /** Moves a file or folder into another folder of the workspace; a folder never into itself. */
  moveEntry(path: string, into: string): Promise<Moved>
  /**
   * Checks a rename or move and reads the workspace for the links it would change, without
   * changing anything. `onProgress` hears how many files were read so far. `buffers` are the open
   * documents with unsaved edits: their text is read instead of the file's. Rejects for the
   * reasons `renameEntry` and `moveEntry` do, before reading anything.
   */
  rewritePlan(
    path: string,
    change: RewriteChange,
    buffers: readonly RewriteBuffer[],
    onProgress: (scanned: number) => void,
  ): Promise<RewritePlanned>
  /**
   * Does the rename or move a plan was made for and rewrites the links. Open documents are not
   * written: `buffers` carries the text of every one the page holds edits in now, and the answer
   * says what to change in each and which to reload. Rejects with `invalid` for a plan that is
   * out of date.
   */
  rewriteMove(token: number, buffers: readonly RewriteBuffer[]): Promise<RewriteDone>
  /** Stops a scan that `rewritePlan` is running; it then answers `cancelled`. */
  rewriteCancel(): Promise<void>
  /** Forgets a plan the user said no to. */
  rewriteDiscard(token: number): Promise<void>
  /**
   * The best `limit` files of the open folders for what was typed in Ctrl+P. The first call reads
   * the folders; later calls use that index until `quickOpenRefresh` replaces it.
   */
  quickOpenQuery(query: string, limit: number): Promise<QuickOpenAnswer>
  /** Reads the folders again so a file made a moment ago is found. False when a read is already going. */
  quickOpenRefresh(): Promise<boolean>
  /** Sends a file or folder of the workspace to the Recycle Bin. */
  deleteEntry(path: string): Promise<void>
  /** Shows a file or folder in the system's file manager, selected. */
  revealEntry(path: string): Promise<void>
  /** Opens a folder itself in the system's file manager. A file is refused. */
  showFolder(path: string): Promise<void>
  /**
   * Every link in the open folders that leads to `path`, by file and line, read with the rule a
   * rename uses. `buffers` are the open documents with unsaved edits: their text is read instead of
   * the file's.
   */
  findReferences(path: string, buffers: readonly RewriteBuffer[]): Promise<ReferencesFound>
  /**
   * Searches the text of every file in the open folders. Hits arrive through `onBatch`, at most
   * every 50 ms, and the answer says how the search ended. A search with a higher id stops the one
   * running; so does `searchCancel`. `buffers` are the open documents with unsaved edits: their
   * text is read instead of the file's.
   */
  searchFolders(
    request: SearchRequest,
    buffers: readonly RewriteBuffer[],
    onBatch: (batch: SearchBatch) => void,
  ): Promise<SearchSummary>
  /** Stops the folder search that is running, if any; it still answers, with `stopped`. */
  searchCancel(): Promise<void>
  /** Puts text on the system clipboard. */
  writeClipboard(text: string): Promise<void>
  /**
   * Which names of a drop already exist in a folder, so the page can ask what to do about them.
   * Changes nothing. Rejects with `not-allowed` unless a native drop delivered every path.
   */
  copyClashes(into: string, paths: readonly string[]): Promise<string[]>
  /**
   * Copies the paths of a native drop into a folder of the workspace. A name that is taken is
   * handled by its answer, and skipped when there is none: nothing is replaced unasked.
   */
  copyDropped(
    into: string,
    paths: readonly string[],
    answers: readonly ClashAnswer[],
  ): Promise<CopyReport>
  /** Present only where the harness can drive the app. */
  readonly perf?: PerfHost
}
