import { shallowRef } from 'vue'
import { holdQuit } from '@/documents/session'
import { allDocuments, describe, documentMoved } from '@/documents/store'
import { moveWithLinks, type RewriteBatch } from '@/features/links/rewrite'
import type { TabId } from '@/workbench/splitTree'
import { holdingEditorFocus } from '@/workbench/focus'
import { closeTabById, imageTabs, setImagePath, tabsOfDocument } from '@/workbench/store'
import { nameProblem } from '@/lib/fileNames'
import {
  getHost,
  type ClashAnswer,
  type ClashChoice,
  type DeleteProgress,
  type DeleteReport,
  type Moved,
} from '@/platform'
import { requestGitRefresh } from './gitStore'
import { baseName, outermost, parentPath, type Place } from './model'
import {
  cancelNaming,
  forgetPath,
  isUnder,
  loadFolder,
  naming,
  openFolderRow,
  pathKey,
  remapPaths,
  requestScroll,
  restoreTreeFocus,
  revealPath,
  rootOf,
  samePath,
  selectedPath,
  selectedPlaces,
  selectedRoot,
  setSelection,
  startNaming,
  treeRows,
  workspaceRoots,
} from './store'
import { reportError, reportWarning } from '@/shell/toasts'

/**
 * What the sidebar does to files: create, rename, move, delete, reveal, and copy what a drop
 * brought in. Rust does every one of them and checks every path; this decides what to ask for,
 * keeps the tree and the open tabs in step with the answer, and says what went wrong.
 */

// ---- naming ----

/**
 * Starts typing the name of a new file in a folder of the workspace. `root` names the copy of the
 * folder that gets the box when it is shown under two roots.
 */
export function newFileIn(parent: string, root?: string | null): Promise<void> {
  return startNaming({ kind: 'new-file', parent, root: root ?? undefined, error: null })
}

/** Starts typing the name of a new folder in a folder of the workspace. */
export function newFolderIn(parent: string, root?: string | null): Promise<void> {
  return startNaming({ kind: 'new-folder', parent, root: root ?? undefined, error: null })
}

/** Starts renaming a file or folder in place. A workspace root is not renamed here. */
export function renameRow(path: string, root?: string | null): Promise<void> {
  if (workspaceRoots.value.some((candidate) => samePath(candidate, path))) return Promise.resolve()
  return startNaming({ kind: 'rename', path, root: root ?? undefined, error: null })
}

/** Keeps the box open and says why the name was refused. */
function refuse(message: string): void {
  const typing = naming.value
  if (typing !== null) naming.value = { ...typing, error: message }
}

/**
 * Points the open tabs at the files a rename or move took along: the documents Rust moved, and
 * the image tabs, which Rust does not hold, by the same rewrite of the path.
 */
function followDocuments(from: string, moved: Moved): void {
  for (const document of moved.documents) documentMoved(document.id, document.path)
  for (const [id, tab] of imageTabs()) {
    if (isUnder(tab.path, from)) setImagePath(id, moved.path + tab.path.slice(from.length))
  }
}

/**
 * Makes what the box was naming. A name Rust refuses (taken, or not allowed) keeps the box open
 * with the reason; success closes it, lists the folder, and selects the new row.
 */
export async function commitNaming(name: string): Promise<void> {
  const typing = naming.value
  if (typing === null) return
  const trimmed = name
  const complaint = nameProblem(trimmed)
  if (complaint !== null) return refuse(complaint)
  try {
    const host = await getHost()
    if (typing.kind === 'rename') {
      if (trimmed === baseName(typing.path)) return cancelNaming()
      // The box stays open until the move is known to be possible, so a name that is taken or
      // not allowed is explained where it was typed.
      const moved = await moveWithLinks(
        typing.path,
        { kind: 'rename', name: trimmed },
        { onChecked: cancelNaming },
      )
      cancelNaming()
      if (moved !== null) afterMove(typing.path, moved)
      // The question banner took focus while it was up; the keyboard goes back to the tree.
      restoreTreeFocus()
      return
    }
    const made =
      typing.kind === 'new-file'
        ? await host.createFile(typing.parent, trimmed)
        : await host.createFolder(typing.parent, trimmed)
    cancelNaming()
    requestGitRefresh()
    await loadFolder(typing.parent)
    await revealPath(made)
  } catch (error) {
    refuse(describe(error))
  }
}

/**
 * Updates tabs, open folders and listings after `from` moved to where `moved` says, and selects the
 * moved row unless a batch will select all of its rows together.
 */
function afterMove(from: string, moved: Moved, reveal = true): void {
  followDocuments(from, moved)
  remapPaths(from, moved.path)
  requestGitRefresh()
  const [was, now] = [parentPath(from), parentPath(moved.path)]
  if (was !== null) void loadFolder(was)
  if (now !== null && (was === null || !samePath(was, now))) void loadFolder(now)
  if (reveal) void revealPath(moved.path)
}

// ---- move, delete, reveal ----

/** Why a drag of `path` onto `folder` cannot move it, or null when it can. */
export function moveProblem(path: string, folder: string): string | null {
  if (isUnder(folder, path)) return 'A folder cannot be moved into itself.'
  const holder = parentPath(path)
  if (holder !== null && samePath(holder, folder)) return 'It is already in that folder.'
  return null
}

/** Moves a file or folder into another folder of the workspace. Failures go to the status bar. */
export async function moveRow(path: string, folder: string): Promise<void> {
  const refusal = moveProblem(path, folder)
  if (refusal !== null) {
    reportWarning(refusal)
    return
  }
  try {
    const moved = await moveWithLinks(path, { kind: 'move', into: folder })
    if (moved === null) return
    await openFolderRow(folder)
    afterMove(path, moved)
    restoreTreeFocus()
  } catch (error) {
    reportError(`Could not move ${baseName(path)}: ${describe(error)}`)
  }
}

/**
 * Moves several files and folders into one folder. Each goes through `moveProblem` and a move that
 * is not allowed is skipped, and so is one Rust refuses (a name that is taken there); the rest go
 * on, and one line at the end says how it went. With `links.onRename` set to ask, the question is
 * asked once, by the first move that has links to update, and its answer covers the others. Cancel
 * in that question stops the batch, keeping what was already moved. The moved rows end up selected.
 */
export async function moveRows(paths: readonly string[], folder: string): Promise<void> {
  const movable: string[] = []
  const skipped: string[] = []
  for (const path of paths) {
    const refusal = moveProblem(path, folder)
    if (refusal === null) movable.push(path)
    else skipped.push(`${baseName(path)}: ${refusal}`)
  }
  if (movable.length === 0) {
    const [first] = skipped
    if (first !== undefined) reportWarning(first)
    return
  }
  const batch: RewriteBatch = { choice: null }
  const arrived: string[] = []
  for (const [index, path] of movable.entries()) {
    try {
      const moved = await moveWithLinks(
        path,
        { kind: 'move', into: folder },
        { batch, more: movable.length - index - 1 },
      )
      if (moved === null) break
      afterMove(path, moved, false)
      arrived.push(moved.path)
    } catch (error) {
      skipped.push(`${baseName(path)}: ${describe(error)}`)
    }
  }
  if (arrived.length > 0) {
    await openFolderRow(folder)
    setSelection(arrived.map((path) => ({ root: rootOf(path) ?? folder, path })))
    const [first] = arrived
    if (first !== undefined) requestScroll(first, 'row', rootOf(first))
  }
  if (arrived.length < paths.length && batch.choice !== 'cancel') {
    const [first] = skipped
    const more = skipped.length > 1 ? ` and ${String(skipped.length - 1)} more` : ''
    const why = first === undefined ? '' : ` ${first}${more}`
    reportWarning(`Moved ${String(arrived.length)} of ${String(paths.length)}.${why}`)
  }
  restoreTreeFocus()
}

/**
 * What a delete or a move acts on: the selected rows, each path once, without a workspace folder
 * (which is not deleted or moved here) and without a row inside another selected row, which the
 * outer one takes along. `roots` counts the workspace folders that were left out.
 */
export function selectedTargets(): { paths: string[]; roots: number } {
  const places = selectedPlaces.value
  const isRoot = (place: Place): boolean =>
    workspaceRoots.value.some((root) => samePath(root, place.path))
  const rest = outermost(
    places.filter((place) => !isRoot(place)),
    pathKey,
  )
  return { paths: rest.map((place) => place.path), roots: places.filter(isRoot).length }
}

/** The tabs that show a file, or any file under a folder, and how many hold unsaved edits (ISC-228). */
function tabsUnder(path: string): { tabs: TabId[]; unsaved: number } {
  const tabs: TabId[] = []
  let unsaved = 0
  for (const [id, tab] of imageTabs()) if (isUnder(tab.path, path)) tabs.push(id)
  for (const doc of allDocuments()) {
    if (doc.untitled || !isUnder(doc.path, path)) continue
    tabs.push(...tabsOfDocument(doc.id))
    if (doc.dirty) unsaved++
  }
  return { tabs, unsaved }
}

/** The question on screen before a delete, or null (ISC-227). */
export interface DeletePrompt {
  /** The row asked about; with several, the first of them. */
  readonly path: string
  /** The name shown in the question: the row's, or "3 items". */
  readonly name: string
  readonly folder: boolean
  /** Every path that goes when the question is answered yes. */
  readonly paths: readonly string[]
  /** True when yes removes them for good, without the Recycle Bin. */
  readonly permanent: boolean
  /** How many of them are files, and how many are folders (which take what is in them). */
  readonly files: number
  readonly folders: number
  /** Open tabs that close with it. */
  readonly tabs: number
  /** Of the files behind those tabs, how many hold edits that were never saved. */
  readonly unsaved: number
}
export const deletePrompt = shallowRef<DeletePrompt | null>(null)

/**
 * Asks before deleting a file or folder. Nothing is deleted until `confirmDelete`. A workspace
 * root skips the question: it is refused, and the refusal says to use Remove Folder.
 */
export function requestDelete(path: string, permanent = false): Promise<void> {
  if (workspaceRoots.value.some((root) => samePath(root, path))) {
    return deletePaths([path], permanent)
  }
  const row = treeRows.value.find(
    (r) => (r.kind === 'file' || r.kind === 'folder') && samePath(r.path, path),
  )
  const { tabs, unsaved } = tabsUnder(path)
  const folder = row?.kind === 'folder'
  deletePrompt.value = {
    path,
    name: baseName(path),
    folder,
    paths: [path],
    permanent,
    files: folder ? 0 : 1,
    folders: folder ? 1 : 0,
    tabs: tabs.length,
    unsaved,
  }
  return Promise.resolve()
}

/**
 * Asks once before deleting several files and folders: how many of each, and what happens to the
 * tabs of all of them. `paths` must not hold one inside another (see `selectedTargets`).
 */
export function requestDeleteMany(paths: readonly string[], permanent = false): void {
  const first = paths[0]
  if (first === undefined) return
  const tabIds = new Set<TabId>()
  let unsaved = 0
  let folders = 0
  for (const path of paths) {
    const found = tabsUnder(path)
    for (const id of found.tabs) tabIds.add(id)
    unsaved += found.unsaved
    const row = treeRows.value.find(
      (r) => (r.kind === 'file' || r.kind === 'folder') && samePath(r.path, path),
    )
    if (row?.kind === 'folder') folders++
  }
  deletePrompt.value = {
    path: first,
    name: `${String(paths.length)} items`,
    folder: false,
    paths: [...paths],
    permanent,
    files: paths.length - folders,
    folders,
    tabs: tabIds.size,
    unsaved,
  }
}

/** The owner said no. */
export function cancelDelete(): void {
  deletePrompt.value = null
}

/** The owner said yes. `asked` is the question they answered, for a caller whose own click already closed it. */
export async function confirmDelete(
  asked: DeletePrompt | null = deletePrompt.value,
): Promise<void> {
  deletePrompt.value = null
  if (asked === null) return
  await deletePaths(asked.paths, asked.permanent)
}

/** Deletes one row, as `deletePaths` does. */
export function deleteRow(path: string): Promise<void> {
  return deletePaths([path])
}

/** How long a delete runs before its dialog shows (ISC-787). */
export const DELETE_DIALOG_AFTER_MS = 2000

/** A delete that has run long enough to be shown. */
export interface DeleteRun {
  /** The name of the item, or "3 items". */
  readonly name: string
  readonly permanent: boolean
  readonly progress: DeleteProgress
  /** Cancel was asked for and the delete has not ended yet. */
  readonly cancelling: boolean
}
export const deleteRun = shallowRef<DeleteRun | null>(null)

/** Cancels the delete under way, shown or not; null while none runs. */
let stopRunning: (() => void) | null = null

/** Asks the delete that is running to stop. Once it moves to the bin, nothing is left to stop. */
export function cancelRunningDelete(): void {
  stopRunning?.()
}

/**
 * Deletes files and folders as one operation (ISC-786), to the Recycle Bin, or for good when
 * `permanent`. Then closes every tab of what is gone, with or without unsaved edits: the question
 * was answered before this runs (ISC-228). A delete that takes long is shown in a dialog that
 * holds the app back.
 */
export async function deletePaths(paths: readonly string[], permanent = false): Promise<void> {
  const [first] = paths
  if (first === undefined) return
  if (stopRunning !== null) {
    reportWarning('Another delete is still running.')
    return
  }
  const name = paths.length > 1 ? `${String(paths.length)} items` : baseName(first)
  let progress: DeleteProgress = { phase: 'counting', percent: null }
  let cancelling = false
  let shown = false
  const redraw = (): void => {
    if (shown) deleteRun.value = { name, permanent, progress, cancelling }
  }
  stopRunning = () => {
    if (cancelling || progress.phase === 'moving') return
    cancelling = true
    redraw()
    getHost()
      .then((host) => host.deleteCancel())
      .catch((error: unknown) => {
        reportError(`Could not cancel the delete: ${describe(error)}`)
      })
  }
  let finish: () => void = () => undefined
  const over = new Promise<void>((resolve) => {
    finish = resolve
  })
  // A window close stops what it still can, and waits for the rest (ISC-791).
  const releaseQuit = holdQuit(() => {
    cancelRunningDelete()
    return over
  })
  const timer = setTimeout(() => {
    shown = true
    redraw()
  }, DELETE_DIALOG_AFTER_MS)
  try {
    let report: DeleteReport | null = null
    try {
      const host = await getHost()
      const told = (step: DeleteProgress): void => {
        progress = step
        redraw()
      }
      report = await (permanent
        ? host.deletePermanently(paths, told)
        : host.deleteEntries(paths, told))
    } catch (error) {
      reportError(`Could not delete ${name}: ${describe(error)}`)
    } finally {
      clearTimeout(timer)
      shown = false
      deleteRun.value = null
    }
    await settleDelete(paths, permanent, report)
  } finally {
    stopRunning = null
    releaseQuit()
    finish()
  }
}

/**
 * Brings the page in step with what a delete did: closes the tabs of what is gone and no others
 * (ISC-790), reads the folders again, and says what stayed. With no report nothing is known to be
 * gone.
 */
async function settleDelete(
  asked: readonly string[],
  permanent: boolean,
  report: DeleteReport | null,
): Promise<void> {
  const gone = report === null ? [] : [...report.deleted, ...report.destroyed]
  const tabs = new Set(gone.flatMap((path) => tabsUnder(path).tabs))
  // A permanent delete that stopped part way leaves a folder without some of its files. The bin
  // takes an item whole or not at all.
  if (permanent && report !== null) {
    for (const id of await tabsWithoutFile(report.kept.map((item) => item.path))) tabs.add(id)
  }
  // Closing the tabs shows a neighbour, whose editor would take focus; it stays in the tree.
  await holdingEditorFocus(() => {
    for (const id of tabs) closeTabById(id)
  })
  for (const path of gone) forgetPath(path)
  requestGitRefresh()
  const holders = new Set([...asked, ...gone].map((path) => parentPath(path)))
  for (const holder of holders) {
    // A folder that went too has nothing left to list.
    if (holder !== null && !gone.some((path) => isUnder(holder, path))) void loadFolder(holder)
  }
  restoreTreeFocus()
  if (report !== null) reportDelete(report)
}

/** The tabs under these paths whose file is no longer on disk. */
async function tabsWithoutFile(under: readonly string[]): Promise<TabId[]> {
  const held = (path: string): boolean => under.some((folder) => isUnder(path, folder))
  const found: TabId[] = []
  const host = await getHost()
  for (const doc of allDocuments()) {
    if (doc.untitled || !held(doc.path)) continue
    // A document the host cannot answer for keeps its tab.
    const exists = await host.documentExists(doc.id).catch(() => true)
    if (!exists) found.push(...tabsOfDocument(doc.id))
  }
  for (const [id, tab] of imageTabs()) {
    if (!held(tab.path)) continue
    try {
      await host.imageInfo(tab.path)
    } catch {
      found.push(id)
    }
  }
  return found
}

/** What is gone for good, and what stayed and why. What a Cancel kept is not a failure. */
function reportDelete(report: DeleteReport): void {
  const andMore = (count: number): string => (count > 1 ? ` and ${String(count - 1)} more` : '')
  const [lost] = report.destroyed
  if (lost !== undefined) {
    reportError(
      `Removed for good, not moved to the Recycle Bin: ${baseName(lost)}${andMore(report.destroyed.length)}`,
    )
  }
  const failed = report.kept.filter((item) => !item.cancelled)
  const [first] = failed
  if (first !== undefined) {
    reportError(
      `Could not delete ${baseName(first.path)}: ${first.reason}${andMore(failed.length)}`,
    )
  }
}

/**
 * True while a drag that left the window is under way, and a moment after, so the drop events it
 * may cause on this window are not taken for files dragged in from Explorer. Rust refuses to
 * record such a drop as well; this keeps the page from asking.
 */
export const draggingOut = shallowRef(false)

/** How long after a drag out ends the window still ignores drops, for an event that lags it. */
const DRAG_OUT_SETTLE_MS = 500

/**
 * Hands a drag of these rows to the OS, which copies them wherever they are dropped. Returns when
 * the drag ends. The rows in the tree stay where they are.
 */
export async function dragOutOfWindow(paths: readonly string[]): Promise<void> {
  if (draggingOut.value || paths.length === 0) return
  draggingOut.value = true
  try {
    const host = await getHost()
    await host.dragOut(paths)
  } catch (error) {
    reportError(`Could not drag out: ${describe(error)}`)
  } finally {
    setTimeout(() => {
      draggingOut.value = false
    }, DRAG_OUT_SETTLE_MS)
  }
}

/** Shows a file or folder in the system's file manager. */
export async function revealInFileManager(path: string): Promise<void> {
  try {
    const host = await getHost()
    await host.revealEntry(path)
  } catch (error) {
    reportError(`Could not show ${baseName(path)}: ${describe(error)}`)
  }
}

/** Opens a folder itself in the system's file manager. */
export async function openFolderInFileManager(path: string): Promise<void> {
  try {
    const host = await getHost()
    await host.showFolder(path)
  } catch (error) {
    reportError(`Could not open ${baseName(path)}: ${describe(error)}`)
  }
}

/** The key that deletes the selected row. The tree handles it itself, so it is not a command. */
export const TREE_DELETE_KEY = 'Delete'
/** As the menu shows it: Shift with the delete key removes for good. */
export const TREE_DELETE_PERMANENTLY_KEYS = `Shift+${TREE_DELETE_KEY}`

/**
 * Asks to delete the selected rows, for the Delete key and the menu: one row as it always did, and
 * several with a single question. A workspace folder among them is left out with a note.
 */
export function deleteSelected(permanent = false): Promise<void> {
  const path = selectedPath.value
  if (path === null) return Promise.resolve()
  if (selectedPlaces.value.length <= 1) return requestDelete(path, permanent)
  const { paths, roots } = selectedTargets()
  if (paths.length === 0) return requestDelete(path, permanent)
  if (roots > 0) {
    reportWarning(
      `${String(roots)} workspace folder${roots === 1 ? ' was' : 's were'} left out: use Remove Folder from Workspace.`,
    )
  }
  const [only] = paths
  if (paths.length === 1 && only !== undefined) return requestDelete(only, permanent)
  requestDeleteMany(paths, permanent)
  return Promise.resolve()
}

/** Renames the selected row, for F2. With several rows selected there is nothing to rename. */
export function renameSelected(): Promise<void> {
  const path = selectedPath.value
  if (path === null || selectedPlaces.value.length > 1) return Promise.resolve()
  return renameRow(path, selectedRoot.value)
}

// ---- copy on drop ----

/**
 * A copy waiting for the user's word on names that are already taken. `answers` holds what was
 * decided so far, in the order of `clashes`.
 */
export interface CopyPrompt {
  readonly into: string
  readonly paths: readonly string[]
  readonly clashes: readonly string[]
  readonly answers: readonly ClashAnswer[]
}

/** The question on screen, or null. */
export const copyPrompt = shallowRef<CopyPrompt | null>(null)

/** The name the banner is asking about now. */
export function currentClash(prompt: CopyPrompt): string | undefined {
  return prompt.clashes[prompt.answers.length]
}

async function runCopy(
  into: string,
  paths: readonly string[],
  answers: readonly ClashAnswer[],
): Promise<void> {
  try {
    const host = await getHost()
    const report = await host.copyDropped(into, paths, answers)
    requestGitRefresh()
    await openFolderRow(into)
    await loadFolder(into)
    const first = report.copied[0]
    if (first !== undefined) await revealPath(first)
    if (report.failed.length > 0) {
      const first = report.failed[0]
      const more = report.failed.length > 1 ? ` and ${String(report.failed.length - 1)} more` : ''
      reportError(
        `Could not copy ${first?.name ?? 'an item'}${more}: ${first?.message ?? 'unknown error'}`,
      )
    }
    if (report.linksLeft > 0) {
      reportWarning(
        `${String(report.linksLeft)} link${report.linksLeft === 1 ? ' was' : 's were'} left out`,
      )
    }
  } catch (error) {
    reportError(`Could not copy the dropped files: ${describe(error)}`)
  }
}

/**
 * Copies what a native drop brought into a folder of the workspace. Names that are taken are asked
 * about one by one first; nothing is copied until every question has an answer. A second drop
 * while a question is open is ignored: Rust keeps only the last few drops, and answering the
 * first must not depend on it.
 */
export async function copyDropInto(into: string, paths: readonly string[]): Promise<void> {
  if (copyPrompt.value !== null) {
    reportWarning('Answer the question about the earlier drop first.')
    return
  }
  try {
    const host = await getHost()
    const clashes = await host.copyClashes(into, paths)
    if (clashes.length === 0) return await runCopy(into, paths, [])
    copyPrompt.value = { into, paths, clashes, answers: [] }
  } catch (error) {
    reportError(`Could not copy the dropped files: ${describe(error)}`)
  }
}

/** Answers the name the banner is asking about; `all` applies the answer to the names left too. */
export async function answerClash(choice: ClashChoice, all = false): Promise<void> {
  const prompt = copyPrompt.value
  if (prompt === null) return
  const asked = prompt.clashes.slice(prompt.answers.length)
  const given: ClashAnswer[] = (all ? asked : asked.slice(0, 1)).map((name) => ({
    name,
    answer: choice,
  }))
  const answers = [...prompt.answers, ...given]
  if (answers.length < prompt.clashes.length) {
    copyPrompt.value = { ...prompt, answers }
    return
  }
  copyPrompt.value = null
  await runCopy(prompt.into, prompt.paths, answers)
}

/** Drops the question and copies nothing. */
export function cancelCopy(): void {
  copyPrompt.value = null
}
