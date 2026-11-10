import { computed, shallowRef } from 'vue'
import { getHost, type OpenedFile } from '@/platform'
import { isMarkdownName } from '@/features/tree/model'
import { findPane } from '@/workbench/splitTree'
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

function touched(): void {
  touchListener?.()
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

/** An error's message, whatever threw it. */
export function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error
    if (typeof message === 'string') return message
  }
  return error instanceof Error ? error.message : String(error)
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
): Promise<{ doc: Document; opened: OpenedFile; isNew: boolean }> {
  const host = await getHost()
  const opened = await host.openFile(path)
  const existing = documents.get(opened.id)
  if (existing !== undefined) return { doc: existing, opened, isNew: false }
  const doc = new Document(opened, publish, {
    touched,
    assetUrl: (path) => host.assetUrl(path),
    followLink: (tabId, href) => linkFollower?.(tabId, href),
    checkLinks: (hrefs) => host.checkLinks(opened.id, hrefs),
  })
  documents.set(doc.id, doc)
  publish(doc)
  return { doc, opened, isNew: true }
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
  const { doc, opened, isNew } = await openDocument(path)
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

/** Shows the open dialog and opens what the user chose. Failures go to `problem`. */
export async function openFromDialog(): Promise<void> {
  problem.value = null
  try {
    const host = await getHost()
    for (const path of await host.pickFiles()) {
      try {
        await openPath(path)
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
  } catch (error) {
    // Saving still refuses to overwrite a changed file, so this costs the live reload, not data.
    problem.value = `Could not watch open files for changes: ${describe(error)}`
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
  return doc?.readOnly === null && docMeta(doc.id)?.dirty === true
}

/** A tab waiting for the user to say what happens to its unsaved edits. */
export const pendingClose = shallowRef<{ tabId: TabId; docId: number } | null>(null)

/**
 * Closes a tab. Closing the last tab of a document with unsaved edits would lose them, so it
 * waits for a choice instead (see `resolvePendingClose`). A document that another tab still
 * shows closes freely, since its edits stay visible there.
 */
export function requestCloseTab(tabId: TabId): void {
  const docId = docIdOf(tabRecord(tabId))
  const doc = docId === undefined ? undefined : documents.get(docId)
  if (docId !== undefined && doc?.dirty === true && tabsOfDocument(docId).length === 1) {
    selectTab(tabId)
    pendingClose.value = { tabId, docId }
    return
  }
  closeTabById(tabId)
}

/** Settles a pending close: save and close, close and discard, or keep the tab open. */
export async function resolvePendingClose(choice: 'save' | 'discard' | 'cancel'): Promise<void> {
  const pending = pendingClose.value
  if (pending === null) return
  if (choice === 'save' && !(await saveDocument(pending.docId))) return // the error is shown on the tab
  pendingClose.value = null
  if (choice !== 'cancel') closeTabById(pending.tabId)
}

/** Drops a document once no tab shows it. */
function release(docId: number): void {
  if (tabsOfDocument(docId).length > 0 || !documents.delete(docId)) return
  removeDocMeta(docId)
  if (pendingClose.value?.docId === docId) pendingClose.value = null
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
  documents.clear()
  saving.clear()
  syncing.clear()
  clearDocMeta()
  pendingClose.value = null
  problem.value = null
}
