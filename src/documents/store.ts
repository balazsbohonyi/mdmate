import { computed, shallowRef } from 'vue'
import { getHost } from '@/platform'
import { findPane } from '@/workbench/splitTree'
import {
  closeTabById,
  onTabClosed,
  openTabFor,
  selectTab,
  tabRecord,
  tabsOfDocument,
  workbenchLayout,
} from '@/workbench/store'
import type { TabId } from '@/workbench/splitTree'
import { Document } from './document'
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
    saveError: docMeta(doc.id)?.saveError ?? null,
  })
}

export function documentById(id: number): Document | undefined {
  return documents.get(id)
}

/** The document shown by a tab, if any. */
export function documentOfTab(tabId: TabId): Document | undefined {
  const record = tabRecord(tabId)
  return record === undefined ? undefined : documents.get(record.docId)
}

/** The document in the focused tab of the focused pane, or undefined when that pane is empty. */
export function activeDocument(): Document | undefined {
  const layout = workbenchLayout.value
  const tab = findPane(layout, layout.activePane)?.activeTab
  return tab === null || tab === undefined ? undefined : documentOfTab(tab)
}

/** A message about the last thing the user tried that did not work, for the status bar. */
export const problem = shallowRef<string | null>(null)

function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error
    if (typeof message === 'string') return message
  }
  return error instanceof Error ? error.message : String(error)
}

/** The tab to focus for a document that is already open: one in the active pane first. */
function tabToFocus(docId: number): TabId | undefined {
  const layout = workbenchLayout.value
  const here = findPane(layout, layout.activePane)?.tabs ?? []
  const tabs = tabsOfDocument(docId)
  return tabs.find((tab) => here.includes(tab)) ?? tabs[0]
}

/**
 * Opens a file in a tab. A file that is already open is not opened twice: its tab is focused
 * instead. Works with or without a workspace folder, since a file the user chose needs neither.
 */
export async function openPath(path: string): Promise<TabId> {
  const host = await getHost()
  const opened = await host.openFile(path)
  let doc = documents.get(opened.id)
  if (doc === undefined) {
    doc = new Document(opened, publish)
    documents.set(doc.id, doc)
    publish(doc)
  } else {
    const existing = tabToFocus(doc.id)
    if (existing !== undefined) {
      selectTab(existing)
      return existing
    }
  }
  return openTabFor({ kind: 'markdown', docId: doc.id })
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
  const snapshot = doc.snapshot()
  try {
    const host = await getHost()
    const saved = await host.saveFile(doc.id, snapshot.text, snapshot.endings)
    doc.markSaved(snapshot, saved)
    patchDocMeta(doc.id, { saveError: null })
    return true
  } catch (error) {
    patchDocMeta(doc.id, { saveError: describe(error) })
    return false
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
  const record = tabRecord(tabId)
  const doc = record === undefined ? undefined : documents.get(record.docId)
  if (record !== undefined && doc?.dirty === true && tabsOfDocument(record.docId).length === 1) {
    selectTab(tabId)
    pendingClose.value = { tabId, docId: record.docId }
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

onTabClosed((_tabId, record) => {
  release(record.docId)
})

/** True while a document's close is waiting on the user. */
export const hasPendingClose = computed(() => pendingClose.value !== null)

/** Forgets every document. Tests use it. */
export function resetDocuments(): void {
  documents.clear()
  saving.clear()
  clearDocMeta()
  pendingClose.value = null
  problem.value = null
}
