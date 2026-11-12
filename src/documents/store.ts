import { computed, shallowRef, watch } from 'vue'
import { uniformEndings, type Endings } from '@/lib/endings'
import { getHost, type OpenedFile, type SaveAsHint } from '@/platform'
import { isMarkdownName } from '@/features/tree/model'
import { focusActiveEditor } from '@/workbench/focus'
import { allTabs, findPane } from '@/workbench/splitTree'
import {
  closeTabById,
  imageTabs,
  onTabClosed,
  openTabFor,
  selectTab,
  tabRecord,
  tabsOfDocument,
  workbenchLayout,
} from '@/workbench/store'
import type { PaneId, TabId } from '@/workbench/splitTree'
import { docIdOf } from '@/workbench/tabs'
import { Document } from './document'
import type { Follower } from './follower'
import { clearDocMeta, docMeta, patchDocMeta, removeDocMeta, setDocMeta } from './meta'
import { suggestedFileName } from './suggest'

/**
 * The open documents. Several tabs can show one document; the document lives until its last tab
 * closes. Editor states stay in this plain map, and the chrome reads `DocMeta` instead.
 */
const documents = new Map<number, Document>()

/** Tells the chrome what changed about a document. */
function publish(doc: Document): void {
  setDocMeta({
    id: doc.id,
    name: doc.name,
    path: doc.path,
    dirty: doc.dirty,
    readOnly: doc.readOnly,
    kind: doc.kind,
    plainSource: doc.plainSource,
    untitled: doc.untitled,
    missing: docMeta(doc.id)?.missing ?? false,
    saveError: docMeta(doc.id)?.saveError ?? null,
    conflict: docMeta(doc.id)?.conflict ?? null,
  })
}

export function documentById(id: number): Document | undefined {
  return documents.get(id)
}

/**
 * Points an open document at its file's new path after a rename or move, so its tab shows the new
 * name and the images next to it are found at the new place. Rust has already moved its own record
 * of the document (saves go by id), so nothing else needs telling.
 */
export function documentMoved(id: number, path: string): void {
  const doc = documents.get(id)
  if (doc === undefined) return
  doc.path = path
  doc.name = path.split(/[\\/]/).pop() ?? path
  publish(doc)
  touched()
}

/** Every open document. */
export function allDocuments(): Document[] {
  return [...documents.values()]
}

let touchListener: (() => void) | undefined

/** Calls `listener` whenever a document's text, caret or saved state may have changed. One listener. */
export function onDocumentsTouched(listener: (() => void) | undefined): void {
  touchListener = listener
}

const watchers = new Set<() => void>()

/**
 * Calls `listener` at the same moments as `onDocumentsTouched`, for any number of listeners.
 * Returns the function that stops it. A listener should be cheap: it runs on every key.
 */
export function watchDocuments(listener: () => void): () => void {
  watchers.add(listener)
  return () => {
    watchers.delete(listener)
  }
}

function touched(): void {
  touchListener?.()
  for (const watcher of watchers) watcher()
}

/** The follower a tab shows, made on first use. */
export function followerOfTab(tabId: TabId): Follower | undefined {
  return documentOfTab(tabId)?.followerFor(tabId)
}

/** The document shown by a tab, if any. */
export function documentOfTab(tabId: TabId): Document | undefined {
  const docId = docIdOf(tabRecord(tabId))
  return docId === undefined ? undefined : documents.get(docId)
}

/** The document in the focused tab of the focused pane, or undefined when that pane is empty. */
export function activeDocument(): Document | undefined {
  const layout = workbenchLayout.value
  const tab = findPane(layout, layout.activePane)?.activeTab
  return tab === null || tab === undefined ? undefined : documentOfTab(tab)
}

/** A message about the last thing the user tried that did not work, for the status bar. */
export const problem = shallowRef<string | null>(null)

let linkFollower: ((tabId: TabId, href: string) => void) | undefined

/**
 * Who handles a Ctrl+click on a link. `links.ts` registers itself, which keeps this module free of
 * an import cycle; with no handler, a Ctrl+click does nothing.
 */
export function setLinkFollower(follow: ((tabId: TabId, href: string) => void) | undefined): void {
  linkFollower = follow
}

/**
 * Drops the "(os error N)" the operating system's own wording ends with. Rust words its errors
 * itself and never sends one; this is for any that comes from somewhere else, a plugin or the
 * browser, so a code never reaches the screen.
 */
function withoutOsCode(text: string): string {
  return text.replace(/ \(os error \d+\)/g, '')
}

/** An error's message, whatever threw it, with no OS error code in it. */
export function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error
    if (typeof message === 'string') return withoutOsCode(message)
  }
  return withoutOsCode(error instanceof Error ? error.message : String(error))
}

/** The stable name Rust gives an error, such as `disk-changed`, when the error has one. */
export function errorKind(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const { kind } = error
    if (typeof kind === 'string') return kind
  }
  return undefined
}

/**
 * The tab to focus for a document that is already open: one in `paneId` (the active pane when
 * none is named) first. With a pane named and no tab of the document in it, there is none, so the
 * caller opens one there, as a drop onto a pane asks.
 */
function tabToFocus(docId: number, paneId?: PaneId): TabId | undefined {
  const layout = workbenchLayout.value
  const here = findPane(layout, paneId ?? layout.activePane)?.tabs ?? []
  const tabs = tabsOfDocument(docId)
  return tabs.find((tab) => here.includes(tab)) ?? (paneId === undefined ? tabs[0] : undefined)
}

/**
 * Opens a file as a document, with no tab. A file that is already open comes back as the document
 * it is; `opened` is then what the file holds now, which the caller can compare with the
 * document's own idea of it. A session restore uses this to build tabs itself.
 */
export async function openDocument(
  path: string,
  remember = false,
): Promise<{ doc: Document; opened: OpenedFile; isNew: boolean }> {
  const host = await getHost()
  const opened = await host.openFile(path, remember)
  const existing = documents.get(opened.id)
  if (existing !== undefined) return { doc: existing, opened, isNew: false }
  const doc = adopt(new Document(opened, publish, documentOptions(opened.id, host)))
  return { doc, opened, isNew: true }
}

/**
 * Says which workspace folder holds a file, for the images a document may climb up to. The tree
 * provides it (it already imports this store, so this store cannot import it). Until then, and
 * for a file in no workspace folder, an image may not leave the document's own folder.
 */
let imageBoundaryOf: (path: string) => string | null = () => null
export function provideImageBoundary(find: (path: string) => string | null): void {
  imageBoundaryOf = find
}

function documentOptions(
  id: number,
  host: Awaited<ReturnType<typeof getHost>>,
  untitledNumber?: number,
): ConstructorParameters<typeof Document>[2] {
  return {
    touched,
    assetUrl: (path) => host.assetUrl(path),
    imageBoundary: (path) => imageBoundaryOf(path),
    followLink: (tabId, href) => linkFollower?.(tabId, href),
    checkLinks: (hrefs) => host.checkLinks(id, hrefs),
    ...(untitledNumber === undefined ? {} : { untitledNumber }),
  }
}

function adopt(doc: Document): Document {
  documents.set(doc.id, doc)
  publish(doc)
  return doc
}

/** The folder of the last file opened or saved, which the save dialog starts in as a last resort. */
let lastFolder: string | null = null

function folderOf(path: string): string | null {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut <= 0 ? null : path.slice(0, cut)
}

/** The folder of the last file opened or saved in this session, or null before the first. */
export function lastFileFolder(): string | null {
  return lastFolder
}

/**
 * Makes a document for a new tab that has no file. Rust gives it an id and nothing else; the first
 * save gives it a file. `buffer` is text a restored session had in it: the document then counts as
 * edited, since an empty file is what it is measured against.
 */
export async function createUntitled(
  number: number,
  buffer?: { text: string; endings: Endings },
): Promise<Document> {
  const host = await getHost()
  const id = await host.newUntitled()
  const empty: OpenedFile = {
    id,
    path: '',
    name: `Untitled-${String(number)}`,
    encoding: 'utf-8',
    bom: false,
    readOnly: null,
    size: 0,
    hash: '',
    text: '',
    endings: uniformEndings(),
    kind: 'markdown',
  }
  const doc = adopt(new Document(empty, publish, documentOptions(id, host, number)))
  if (buffer !== undefined) doc.restoreBuffer(empty, buffer)
  return doc
}

let saveHint: ((doc: Document) => SaveAsHint) | undefined

/**
 * Who says what the save dialog suggests for an untitled document: its file name from the first
 * heading, and the folder to start in. Registered by `untitled.ts`, which knows the workspace; with
 * no provider, the name comes from the text and the system picks the folder.
 */
export function setSaveHint(provider: ((doc: Document) => SaveAsHint) | undefined): void {
  saveHint = provider
}

function hintFor(doc: Document): SaveAsHint {
  if (!doc.untitled) return { name: doc.name, folder: folderOf(doc.path) }
  return (
    saveHint?.(doc) ?? { name: suggestedFileName(doc.master.doc.toString()), folder: lastFolder }
  )
}

/**
 * Opens an image in a tab. Rust checks the path, serves that one file to the image protocol and
 * says how big it is. An image that is already open is not opened twice: its tab is focused.
 */
export async function openImage(path: string, paneId?: PaneId): Promise<TabId> {
  const host = await getHost()
  const info = await host.imageInfo(path)
  const layout = workbenchLayout.value
  const here = findPane(layout, paneId ?? layout.activePane)?.tabs ?? []
  const shown = imageTabs().filter(([, tab]) => tab.path === info.path)
  const existing =
    shown.find(([id]) => here.includes(id))?.[0] ??
    (paneId === undefined ? shown[0]?.[0] : undefined)
  if (existing !== undefined) {
    selectTab(existing)
    return existing
  }
  return openTabFor({ kind: 'image', path: info.path, size: info.size }, paneId)
}

/**
 * Opens a file in a tab: Markdown in the live editor, an image in an image tab, anything else as
 * plain source. A file that is already open is not opened twice: its tab is focused instead (in
 * `paneId` when one is named, else in the active pane). Works with or without a workspace folder,
 * since a file the user chose needs neither.
 */
export async function openPath(path: string, paneId?: PaneId): Promise<TabId> {
  // Markdown is decided by its name here, with no extra round trip; Rust decides everything else.
  if (!isMarkdownName(path) && (await (await getHost()).fileKind(path)) === 'image') {
    return openImage(path, paneId)
  }
  const { doc, opened, isNew } = await openDocument(path, true)
  lastFolder = folderOf(doc.path) ?? lastFolder
  if (!isNew) {
    // The file may have changed since this document last read it, with no event to say so (the
    // watcher missed it, or it is not running). The host keeps what it recorded; the page decides.
    const present = doc
    await noticeDiskChange(present, opened.hash).catch((error: unknown) => {
      reportSyncFailure(present, error)
    })
    const existing = tabToFocus(doc.id, paneId)
    if (existing !== undefined) {
      selectTab(existing)
      return existing
    }
  }
  return openTabFor({ kind: doc.kind, docId: doc.id }, paneId)
}

/**
 * Opens a file the user picked by hand (a tree click, Quick Open, the open dialog) in the active
 * pane: its tab there when it has one, else a new tab there, even when another pane already shows
 * the file. That is how the same file gets a tab in each pane, with its own caret and scroll over
 * one shared text. A link, a history step, a reference or a recent file goes through `openPath`
 * with no pane, which jumps to the tab that already shows the file wherever it is.
 */
export function openInActivePane(path: string): Promise<TabId> {
  return openPath(path, workbenchLayout.value.activePane)
}

/** Shows the open dialog and opens what the user chose. Failures go to `problem`. */
export async function openFromDialog(): Promise<void> {
  problem.value = null
  try {
    const host = await getHost()
    for (const path of await host.pickFiles()) {
      try {
        await openInActivePane(path)
        focusActiveEditor()
      } catch (error) {
        problem.value = `Could not open ${path}: ${describe(error)}`
      }
    }
  } catch (error) {
    problem.value = `Could not show the open dialog: ${describe(error)}`
  }
}

const saving = new Map<number, Promise<boolean>>()

/**
 * Saves a document if it has unsaved edits. Resolves to true when the file on disk now matches,
 * and to false when the save failed, which leaves the reason in the document's `saveError`.
 * Saves of one document run one at a time.
 */
export function saveDocument(docId: number): Promise<boolean> {
  const previous = saving.get(docId) ?? Promise.resolve(true)
  const next = previous.then(() => runSave(docId))
  const tracked = next.finally(() => {
    if (saving.get(docId) === tracked) saving.delete(docId)
  })
  saving.set(docId, tracked)
  return tracked
}

async function runSave(docId: number): Promise<boolean> {
  const doc = documents.get(docId)
  if (doc?.readOnly !== null) return false
  // A document with no file has nothing to write to yet, edited or not: the first save asks where.
  if (doc.untitled) return runSaveAs(docId)
  if (!doc.dirty) return true
  if (conflictOf(doc.id) !== null) {
    // The user has not said yet which version of the file to keep, so nothing is written.
    patchDocMeta(doc.id, {
      saveError: 'The file changed on disk. Choose Keep mine or Load theirs.',
    })
    return false
  }
  const snapshot = doc.snapshot()
  try {
    const host = await getHost()
    const saved = await host.saveFile(doc.id, snapshot.text, snapshot.endings)
    doc.markSaved(snapshot, saved)
    patchDocMeta(doc.id, { saveError: null })
    return true
  } catch (error) {
    if (errorKind(error) === 'disk-changed') {
      // Another program changed the file and no event told us: ask instead of overwriting it.
      patchDocMeta(doc.id, { conflict: 'save', saveError: null })
    } else {
      patchDocMeta(doc.id, { saveError: describe(error) })
    }
    return false
  }
}

/**
 * Saves a document to a file the user picks, with the system's dialog. An untitled document gets
 * its first file; any other follows the new file and leaves the old one as it was. Resolves to true
 * when a file was written, and to false when the user cancelled or the save failed (the reason is
 * on the document's `saveError`). Runs in turn with the document's other saves.
 */
export function saveDocumentAs(docId: number): Promise<boolean> {
  const previous = saving.get(docId) ?? Promise.resolve(true)
  const next = previous.then(() => runSaveAs(docId))
  const tracked = next.finally(() => {
    if (saving.get(docId) === tracked) saving.delete(docId)
  })
  saving.set(docId, tracked)
  return tracked
}

async function runSaveAs(docId: number): Promise<boolean> {
  const doc = documents.get(docId)
  if (doc === undefined) return false
  const snapshot = doc.snapshot()
  try {
    const host = await getHost()
    const saved = await host.saveAs(doc.id, snapshot.text, snapshot.endings, hintFor(doc))
    // The user closed the dialog without choosing: nothing was written and nothing is an error.
    if (saved === null) return false
    if (documents.get(docId) !== doc) return true
    doc.relocate(snapshot, saved)
    lastFolder = folderOf(saved.path) ?? lastFolder
    // A change made to the old file no longer concerns this document.
    patchDocMeta(doc.id, { saveError: null, conflict: null, missing: false })
    return true
  } catch (error) {
    if (errorKind(error) === 'disk-changed') {
      patchDocMeta(doc.id, { conflict: 'save', saveError: null })
    } else {
      patchDocMeta(doc.id, { saveError: describe(error) })
    }
    return false
  }
}

/** Shows the save dialog for the document in the focused tab. */
export async function saveActiveDocumentAs(): Promise<void> {
  const doc = activeDocument()
  if (doc !== undefined) await saveDocumentAs(doc.id)
}

/** Per document: set while its file is being compared with the disk, and true when another change arrived meanwhile. */
const syncing = new Map<number, boolean>()

/**
 * Handles a document's file having different content on disk than the document last read or wrote.
 * A document with no unsaved edits takes the new content. One with edits asks first, because the
 * choice is between two versions of the user's writing. Runs one at a time per document, so two
 * reads of the file can never be applied out of order.
 */
async function noticeDiskChange(doc: Document, hash: string): Promise<void> {
  if (hash === doc.diskHash) return
  if (syncing.has(doc.id)) {
    syncing.set(doc.id, true)
    return
  }
  try {
    do {
      syncing.set(doc.id, false)
      await syncFromDisk(doc)
    } while (syncing.get(doc.id) === true && documents.get(doc.id) === doc)
  } finally {
    syncing.delete(doc.id)
  }
}

/**
 * Brings an open document up to date with its file after the app itself rewrote the file. A
 * document with no unsaved edits takes the new content; one with edits asks, as for any change
 * from outside. Does nothing for a document that is not open.
 */
export function refreshFromDisk(id: number): Promise<void> {
  const doc = documents.get(id)
  // An empty hash never equals a real one, so the file is always read.
  return doc === undefined ? Promise.resolve() : noticeDiskChange(doc, '')
}

function conflictOf(docId: number): 'disk' | 'save' | null {
  return docMeta(docId)?.conflict ?? null
}

/** Marks a document as needing the user's choice, keeping a `'save'` conflict as it is. */
function raiseConflict(doc: Document): void {
  if (conflictOf(doc.id) === null) patchDocMeta(doc.id, { conflict: 'disk' })
}

function reportSyncFailure(doc: Document, error: unknown): void {
  problem.value = `Could not read ${doc.name} after it changed on disk: ${describe(error)}`
}

async function syncFromDisk(doc: Document): Promise<void> {
  if (doc.dirty || conflictOf(doc.id) !== null) {
    raiseConflict(doc)
    return
  }
  const before = doc.master.doc
  const host = await getHost()
  const opened = await host.reloadDocument(doc.id)
  // The tab may have closed, or an earlier read may already have brought this content in.
  if (documents.get(doc.id) !== doc || opened.hash === doc.diskHash) return
  // Typing while the file was read makes this a choice after all.
  if (doc.dirty || !doc.master.doc.eq(before)) {
    raiseConflict(doc)
    return
  }
  doc.reload(opened)
}

/**
 * Settles a conflict. `'theirs'` shows what is on disk and drops the document's edits. `'mine'`
 * keeps the edits and counts the disk's content as what they are measured against, so the
 * document stays edited and the next save replaces the file. When the conflict came from a save,
 * keeping the edits goes on to save them.
 */
export async function resolveConflict(docId: number, choice: 'mine' | 'theirs'): Promise<void> {
  const doc = documents.get(docId)
  const conflict = conflictOf(docId)
  if (doc === undefined || conflict === null) return
  try {
    const host = await getHost()
    const opened = await host.reloadDocument(docId)
    if (documents.get(docId) !== doc) return
    if (choice === 'theirs') doc.reload(opened)
    else doc.adoptDisk(opened)
    patchDocMeta(docId, { conflict: null, saveError: null })
  } catch (error) {
    patchDocMeta(docId, { saveError: `Could not read the file: ${describe(error)}` })
    return
  }
  if (choice === 'mine' && conflict === 'save') await saveDocument(docId)
}

let stopWatching: (() => void) | undefined
let stopMissingCheck: (() => void) | undefined

/**
 * Starts listening for changes other programs make to open files. Once at startup. A document
 * that is open when a change arrives is brought up to date or marked as in conflict.
 */
export async function watchDisk(): Promise<void> {
  try {
    const host = await getHost()
    stopWatching?.()
    stopWatching = await host.watchChanges((change) => {
      const doc = documents.get(change.id)
      if (doc === undefined) return
      noticeDiskChange(doc, change.hash).catch((error: unknown) => {
        reportSyncFailure(doc, error)
      })
    })
    watchMissing()
  } catch (error) {
    // Saving still refuses to overwrite a changed file, so this costs the live reload, not data.
    problem.value = `Could not watch open files for changes: ${describe(error)}`
  }
}

/**
 * Keeps `missing` in step for the focused document: each time another tab comes to the front and
 * each time the window gets the focus back, since a file is usually deleted while the user is
 * elsewhere. The watcher says nothing about a file that vanished, so this asks.
 */
function watchMissing(): void {
  stopMissingCheck?.()
  const check = (): void => {
    const doc = activeDocument()
    if (doc !== undefined) void refreshMissing(doc.id)
  }
  const stopWatch = watch(() => activeDocument()?.id, check, { immediate: true })
  const target = typeof window === 'undefined' ? undefined : window
  target?.addEventListener('focus', check)
  stopMissingCheck = () => {
    stopWatch()
    target?.removeEventListener('focus', check)
  }
}

/** Saves the document in the focused tab. */
export async function saveActiveDocument(): Promise<void> {
  const doc = activeDocument()
  if (doc !== undefined) await saveDocument(doc.id)
}

/** True when Save would write something: the focused document is edited and can be saved. */
export function canSaveActive(): boolean {
  const doc = activeDocument()
  const meta = doc === undefined ? undefined : docMeta(doc.id)
  // A new document can always be saved: that is how it gets its file.
  return doc?.readOnly === null && (meta?.dirty === true || meta?.untitled === true)
}

/** True when Save As has something to write: any open document, even a read-only one. */
export function canSaveActiveAs(): boolean {
  return activeDocument() !== undefined
}

/** A tab waiting for the user to say what happens to its unsaved edits. */
export const pendingClose = shallowRef<{ tabId: TabId; docId: number } | null>(null)

/** Who is waiting for the pending close to be settled: Close All and Close Others. */
let closeWaiter: ((choice: 'save' | 'discard' | 'cancel' | 'gone') => void) | undefined

/** Sets what the close banner asks about, and frees whoever waited on the one it replaces. */
function setPendingClose(next: { tabId: TabId; docId: number } | null): void {
  pendingClose.value = next
}

function settleWaiter(choice: 'save' | 'discard' | 'cancel' | 'gone'): void {
  const waiter = closeWaiter
  closeWaiter = undefined
  waiter?.(choice)
}

/**
 * Closes a tab. Closing the last tab of a document with unsaved edits would lose them, so it
 * waits for a choice instead (see `resolvePendingClose`). A document that another tab still
 * shows closes freely, since its edits stay visible there.
 */
export function requestCloseTab(tabId: TabId): void {
  const docId = docIdOf(tabRecord(tabId))
  const doc = docId === undefined ? undefined : documents.get(docId)
  if (docId !== undefined && doc?.dirty === true && tabsOfDocument(docId).length === 1) {
    // A close that was waiting for an answer is dropped: the user moved on to this one.
    settleWaiter('cancel')
    selectTab(tabId)
    setPendingClose({ tabId, docId })
    return
  }
  closeTabById(tabId)
}

/**
 * Closes these tabs one after another, in order. A tab whose document has unsaved edits asks with
 * the pane banner and waits for the answer, once per document, since only its last tab asks.
 * Resolves to false when the user chose Cancel, which leaves that tab and the ones after it open.
 */
export async function closeTabs(tabs: readonly TabId[]): Promise<boolean> {
  for (const tab of tabs) {
    if (tabRecord(tab) === undefined) continue
    requestCloseTab(tab)
    if (pendingClose.value?.tabId !== tab) continue
    const answer = await new Promise<'save' | 'discard' | 'cancel' | 'gone'>((resolve) => {
      closeWaiter = resolve
    })
    if (answer === 'cancel') return false
  }
  return true
}

/** Closes every tab, asking about each document with unsaved edits. False when the user cancelled. */
export function closeAllTabs(): Promise<boolean> {
  return closeTabs(allTabs(workbenchLayout.value))
}

/** True when at least one tab is open. */
export function hasOpenTabs(): boolean {
  return allTabs(workbenchLayout.value).length > 0
}

/** Settles a pending close: save and close, close and discard, or keep the tab open. */
export async function resolvePendingClose(choice: 'save' | 'discard' | 'cancel'): Promise<void> {
  const pending = pendingClose.value
  if (pending === null) return
  if (choice === 'save' && !(await saveDocument(pending.docId))) return // the error is shown on the tab
  setPendingClose(null)
  if (choice !== 'cancel') closeTabById(pending.tabId)
  settleWaiter(choice)
}

/** A tab waiting for the user to confirm that its unsaved edits are thrown away for the file's. */
export const pendingRevert = shallowRef<{ tabId: TabId; docId: number } | null>(null)

/** Looks whether a document's file is still on disk, and tells the chrome. */
export async function refreshMissing(docId: number): Promise<void> {
  const doc = documents.get(docId)
  if (doc === undefined || doc.untitled) return
  try {
    const exists = await (await getHost()).documentExists(docId)
    if (documents.get(docId) === doc) patchDocMeta(docId, { missing: !exists })
  } catch {
    // A document the host no longer knows is not one to revert either way.
  }
}

/** True when Revert File has a file to go back to: a document with a file that is on disk. */
export function canRevertActive(): boolean {
  const doc = activeDocument()
  const meta = doc === undefined ? undefined : docMeta(doc.id)
  return meta !== undefined && !meta.untitled && !meta.missing
}

/** Asks, in the banner of the focused tab, whether to throw away edits and reload the file. */
export async function requestRevert(): Promise<void> {
  const layout = workbenchLayout.value
  const tabId = findPane(layout, layout.activePane)?.activeTab
  const doc = activeDocument()
  if (tabId === null || tabId === undefined || doc === undefined || doc.untitled) return
  // The file may have gone since the last look; Revert has nothing to reload then.
  await refreshMissing(doc.id)
  if (docMeta(doc.id)?.missing === true) {
    problem.value = `${doc.name} is no longer on disk, so there is nothing to revert to.`
    return
  }
  pendingRevert.value = { tabId, docId: doc.id }
}

/** Settles a pending revert: reload the file and drop the edits, or leave everything as it is. */
export async function resolvePendingRevert(choice: 'revert' | 'cancel'): Promise<void> {
  const pending = pendingRevert.value
  if (pending === null) return
  pendingRevert.value = null
  if (choice === 'cancel') return
  const doc = documents.get(pending.docId)
  if (doc === undefined) return
  try {
    const host = await getHost()
    const opened = await host.reloadDocument(doc.id)
    if (documents.get(doc.id) !== doc) return
    doc.reload(opened)
    patchDocMeta(doc.id, { conflict: null, saveError: null, missing: false })
  } catch (error) {
    if (errorKind(error) === 'not-found') patchDocMeta(doc.id, { missing: true })
    problem.value = `Could not revert ${doc.name}: ${describe(error)}`
  }
}

/** Drops a document that no tab shows, such as one a restore made and could not give a tab. */
export function discardUnused(docId: number): void {
  release(docId)
}

/** Drops a document once no tab shows it. */
function release(docId: number): void {
  if (tabsOfDocument(docId).length > 0 || !documents.delete(docId)) return
  removeDocMeta(docId)
  if (pendingClose.value?.docId === docId) {
    setPendingClose(null)
    settleWaiter('gone')
  }
  getHost()
    .then((host) => host.closeDocument(docId))
    .catch((error: unknown) => {
      console.error('Could not tell the host a document closed', error)
    })
}

onTabClosed((tabId, record) => {
  if (record.kind === 'image') {
    // Rust forgets the image once no tab shows it, so the next session does not grant it again.
    if (imageTabs().some(([, tab]) => tab.path === record.path)) return
    getHost()
      .then((host) => host.imageClosed(record.path))
      .catch((error: unknown) => {
        console.error('Could not tell the host an image closed', error)
      })
    return
  }
  documents.get(record.docId)?.closeFollower(tabId)
  release(record.docId)
})

/** True while a document's close is waiting on the user. */
export const hasPendingClose = computed(() => pendingClose.value !== null)

/** Forgets every document. Tests use it. */
export function resetDocuments(): void {
  stopWatching?.()
  stopWatching = undefined
  watchers.clear()
  stopMissingCheck?.()
  stopMissingCheck = undefined
  documents.clear()
  saving.clear()
  syncing.clear()
  clearDocMeta()
  pendingClose.value = null
  closeWaiter = undefined
  pendingRevert.value = null
  lastFolder = null
  problem.value = null
}
