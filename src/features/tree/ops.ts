import { shallowRef } from 'vue'
import { allDocuments, describe, documentMoved, problem } from '@/documents/store'
import { moveWithLinks } from '@/features/links/rewrite'
import type { TabId } from '@/workbench/splitTree'
import { closeTabById, imageTabs, setImagePath, tabsOfDocument } from '@/workbench/store'
import { nameProblem } from '@/lib/fileNames'
import { getHost, type ClashAnswer, type ClashChoice, type Moved } from '@/platform'
import { baseName, parentPath } from './model'
import {
  cancelNaming,
  forgetPath,
  isUnder,
  loadFolder,
  naming,
  openFolderRow,
  remapPaths,
  revealPath,
  samePath,
  selectedPath,
  startNaming,
  treeRows,
  workspaceRoots,
} from './store'

/**
 * What the sidebar does to files: create, rename, move, delete, reveal, and copy what a drop
 * brought in. Rust does every one of them and checks every path; this decides what to ask for,
 * keeps the tree and the open tabs in step with the answer, and says what went wrong.
 */

// ---- naming ----

/** Starts typing the name of a new file in a folder of the workspace. */
export function newFileIn(parent: string): Promise<void> {
  return startNaming({ kind: 'new-file', parent, error: null })
}

/** Starts typing the name of a new folder in a folder of the workspace. */
export function newFolderIn(parent: string): Promise<void> {
  return startNaming({ kind: 'new-folder', parent, error: null })
}

/** Starts renaming a file or folder in place. A workspace root is not renamed here. */
export function renameRow(path: string): Promise<void> {
  if (workspaceRoots.value.some((root) => samePath(root, path))) return Promise.resolve()
  return startNaming({ kind: 'rename', path, error: null })
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
      return
    }
    const made =
      typing.kind === 'new-file'
        ? await host.createFile(typing.parent, trimmed)
        : await host.createFolder(typing.parent, trimmed)
    cancelNaming()
    await loadFolder(typing.parent)
    await revealPath(made)
  } catch (error) {
    refuse(describe(error))
  }
}

/** Updates tabs, open folders and listings after `from` moved to where `moved` says. */
function afterMove(from: string, moved: Moved): void {
  followDocuments(from, moved)
  remapPaths(from, moved.path)
  const [was, now] = [parentPath(from), parentPath(moved.path)]
  if (was !== null) void loadFolder(was)
  if (now !== null && (was === null || !samePath(was, now))) void loadFolder(now)
  void revealPath(moved.path)
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
  problem.value = null
  const refusal = moveProblem(path, folder)
  if (refusal !== null) {
    problem.value = refusal
    return
  }
  try {
    const moved = await moveWithLinks(path, { kind: 'move', into: folder })
    if (moved === null) return
    await openFolderRow(folder)
    afterMove(path, moved)
  } catch (error) {
    problem.value = `Could not move ${baseName(path)}: ${describe(error)}`
  }
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
  readonly path: string
  readonly name: string
  readonly folder: boolean
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
export function requestDelete(path: string): Promise<void> {
  if (workspaceRoots.value.some((root) => samePath(root, path))) return deleteRow(path)
  const row = treeRows.value.find(
    (r) => (r.kind === 'file' || r.kind === 'folder') && samePath(r.path, path),
  )
  const { tabs, unsaved } = tabsUnder(path)
  deletePrompt.value = {
    path,
    name: baseName(path),
    folder: row?.kind === 'folder',
    tabs: tabs.length,
    unsaved,
  }
  return Promise.resolve()
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
  if (asked !== null) await deleteRow(asked.path)
}

/**
 * Sends a file or folder to the Recycle Bin, then closes every tab of it, with or without unsaved
 * edits: the question was answered before this runs (ISC-228).
 */
export async function deleteRow(path: string): Promise<void> {
  problem.value = null
  const { tabs } = tabsUnder(path)
  try {
    const host = await getHost()
    await host.deleteEntry(path)
  } catch (error) {
    problem.value = `Could not delete ${baseName(path)}: ${describe(error)}`
    return
  }
  for (const id of tabs) closeTabById(id)
  forgetPath(path)
  const holder = parentPath(path)
  if (holder !== null) void loadFolder(holder)
}

/** Shows a file or folder in the system's file manager. */
export async function revealInFileManager(path: string): Promise<void> {
  try {
    const host = await getHost()
    await host.revealEntry(path)
  } catch (error) {
    problem.value = `Could not show ${baseName(path)}: ${describe(error)}`
  }
}

/** Opens a folder itself in the system's file manager. */
export async function openFolderInFileManager(path: string): Promise<void> {
  try {
    const host = await getHost()
    await host.showFolder(path)
  } catch (error) {
    problem.value = `Could not open ${baseName(path)}: ${describe(error)}`
  }
}

/** The key that deletes the selected row. The tree handles it itself, so it is not a command. */
export const TREE_DELETE_KEY = 'Delete'

/** Asks to delete the selected row, for the Delete key. */
export function deleteSelected(): Promise<void> {
  const path = selectedPath.value
  return path === null ? Promise.resolve() : requestDelete(path)
}

/** Renames the selected row, for F2. */
export function renameSelected(): Promise<void> {
  const path = selectedPath.value
  return path === null ? Promise.resolve() : renameRow(path)
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
    await openFolderRow(into)
    await loadFolder(into)
    const first = report.copied[0]
    if (first !== undefined) await revealPath(first)
    const notes: string[] = []
    if (report.failed.length > 0) {
      const first = report.failed[0]
      const more = report.failed.length > 1 ? ` and ${String(report.failed.length - 1)} more` : ''
      notes.push(
        `Could not copy ${first?.name ?? 'an item'}${more}: ${first?.message ?? 'unknown error'}`,
      )
    }
    if (report.linksLeft > 0) {
      notes.push(
        `${String(report.linksLeft)} link${report.linksLeft === 1 ? ' was' : 's were'} left out`,
      )
    }
    problem.value = notes.length > 0 ? notes.join('. ') : null
  } catch (error) {
    problem.value = `Could not copy the dropped files: ${describe(error)}`
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
    problem.value = 'Answer the question about the earlier drop first.'
    return
  }
  problem.value = null
  try {
    const host = await getHost()
    const clashes = await host.copyClashes(into, paths)
    if (clashes.length === 0) return await runCopy(into, paths, [])
    copyPrompt.value = { into, paths, clashes, answers: [] }
  } catch (error) {
    problem.value = `Could not copy the dropped files: ${describe(error)}`
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
