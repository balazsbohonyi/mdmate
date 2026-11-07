import { watch } from 'vue'
import type { Text } from '@codemirror/state'
import { endingsOf } from '@/editor/lineEndings'
import { endingsEqual, joinWithEndings, readEndings, type Endings } from '@/lib/endings'
import { getHost, type OpenedFile } from '@/platform'
import {
  allTabs,
  closeTab,
  createLayout,
  deserialize,
  serialize,
  type Layout,
  type TabId,
} from '@/workbench/splitTree'
import { openTabFor, restoreWorkbench, tabRecord, workbenchLayout } from '@/workbench/store'
import type { TabRecord } from '@/workbench/tabs'
import type { Caret, Document } from './document'
import { patchDocMeta } from './meta'
import { allDocuments, documentById, onDocumentsTouched, openDocument, problem } from './store'

/**
 * Hot exit, page side. The session is one JSON snapshot: the layout, each tab's file and caret, and
 * every unsaved buffer. It is written to the data folder a short while after anything changes, and
 * once more when the window is asked to close, and read back before the first paint of the next
 * run. Rust writes the file atomically; this module decides what goes in it and when.
 */

/** How long after a change the session is written. Measured in P2-T6; see the Phase 2 decisions. */
export const JOURNAL_INTERVAL_MS = 1000

const VERSION = 1

interface SnapshotTab {
  readonly id: TabId
  readonly path: string
  readonly caret: Caret
}

/** Unsaved text, with the disk hash it was typed on top of. */
interface SnapshotBuffer {
  readonly path: string
  readonly base: string
  readonly text: string
  readonly endings: Endings
}

// ---- writing -----------------------------------------------------------------------------------

/**
 * The JSON of one document's buffer, kept while its text, endings and base stay as they are. Text
 * is immutable, so the cache key is the text itself: a caret move or a layout change rebuilds the
 * small parts and reuses the large one.
 */
const bufferJson = new WeakMap<
  Text,
  { doc: Document; endings: Endings; base: string; json: string }
>()

function bufferOf(doc: Document): string {
  const master = doc.master
  const endings = endingsOf(master)
  const cached = bufferJson.get(master.doc)
  if (
    cached?.doc === doc &&
    cached.base === doc.diskHash &&
    endingsEqual(cached.endings, endings)
  ) {
    return cached.json
  }
  const buffer: SnapshotBuffer = {
    path: doc.path,
    base: doc.diskHash,
    text: master.doc.toString(),
    endings,
  }
  const json = JSON.stringify(buffer)
  bufferJson.set(master.doc, { doc, endings, base: doc.diskHash, json })
  return json
}

/** The snapshot of the workbench as it is now, as JSON text. */
export function buildSnapshot(): string {
  const layout = workbenchLayout.value
  const tabs: SnapshotTab[] = []
  for (const id of allTabs(layout)) {
    const record = tabRecord(id)
    const doc = record === undefined ? undefined : documentById(record.docId)
    if (doc !== undefined) tabs.push({ id, path: doc.path, caret: doc.caretOf(id) })
  }
  const buffers = allDocuments()
    .filter((doc) => doc.dirty && doc.readOnly === null)
    .map(bufferOf)
  return `{"version":${String(VERSION)},"layout":${JSON.stringify(serialize(layout))},"tabs":${JSON.stringify(tabs)},"buffers":[${buffers.join(',')}]}`
}

/** What the journal has done, for the perf scenarios and the tests. */
export const journalStats = {
  writes: 0,
  skipped: 0,
  errors: 0,
  lastError: null as string | null,
  /** Main-thread time to build the last snapshot, in ms. */
  lastBuildMs: 0,
  /** Time from handing the snapshot to the host to its confirmation, in ms. */
  lastWriteMs: 0,
  lastBytes: 0,
}

let started = false
let intervalMs = JOURNAL_INTERVAL_MS
let timer: ReturnType<typeof setTimeout> | undefined
let inFlight: Promise<void> | null = null
let wanted = false
let lastWritten: string | null = null
let stopLayoutWatch: (() => void) | undefined

async function writeOnce(): Promise<void> {
  const began = performance.now()
  const json = buildSnapshot()
  journalStats.lastBuildMs = performance.now() - began
  if (json === lastWritten) {
    journalStats.skipped++
    return
  }
  try {
    const host = await getHost()
    const handedOver = performance.now()
    await host.writeSession(json)
    journalStats.lastWriteMs = performance.now() - handedOver
    journalStats.lastBytes = json.length
    journalStats.writes++
    journalStats.lastError = null
    lastWritten = json
  } catch (error) {
    // Typing must never fail because the journal could not be written. Try again later.
    journalStats.errors++
    journalStats.lastError = error instanceof Error ? error.message : JSON.stringify(error)
    console.error('Could not write the session', error)
    touch()
  }
}

/**
 * Writes the session now, after any write already under way. Resolves once the newest state is on
 * disk (or could not be written). One write runs at a time: two in flight could land out of order
 * and leave the older snapshot as the file.
 */
export function flushSession(): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  wanted = true
  inFlight ??= (async () => {
    try {
      while (wanted) {
        wanted = false
        await writeOnce()
      }
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/** Notes that the session changed, and schedules a write unless one is already scheduled. */
function touch(): void {
  if (!started || timer !== undefined) return
  timer = setTimeout(() => {
    timer = undefined
    void flushSession()
  }, intervalMs)
}

/** The window was asked to close: write the newest state, then end the app. No prompt. */
async function closeRequested(): Promise<void> {
  await flushSession()
  const host = await getHost()
  await host.quitApp()
}

export interface JournalOptions {
  /** Overrides the write interval, for the perf harness. */
  readonly intervalMs?: number
}

/** Starts writing the session as the workbench changes, and flushes when the window closes. */
export async function startJournal(options: JournalOptions = {}): Promise<void> {
  stopJournal()
  started = true
  intervalMs = options.intervalMs ?? JOURNAL_INTERVAL_MS
  onDocumentsTouched(touch)
  stopLayoutWatch = watch(workbenchLayout, touch)
  try {
    const host = await getHost()
    await host.watchClose(() => {
      closeRequested().catch((error: unknown) => {
        console.error('Could not close cleanly', error)
      })
    })
  } catch (error) {
    // Without it a close still works, but only the last interval's edits are kept.
    problem.value = `Could not watch for the window closing: ${error instanceof Error ? error.message : JSON.stringify(error)}`
  }
}

/** Stops scheduling writes. A write already under way finishes. */
export function stopJournal(): void {
  started = false
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  onDocumentsTouched(undefined)
  stopLayoutWatch?.()
  stopLayoutWatch = undefined
}

/** True when the session on disk is the one the workbench would write right now. */
export function journalIsCurrent(): boolean {
  return lastWritten !== null && lastWritten === buildSnapshot()
}

/** Forgets what was written and zeroes the counters. Tests use it. */
export function resetSession(): void {
  stopJournal()
  wanted = false
  lastWritten = null
  Object.assign(journalStats, {
    writes: 0,
    skipped: 0,
    errors: 0,
    lastError: null,
    lastBuildMs: 0,
    lastWriteMs: 0,
    lastBytes: 0,
  })
}

// ---- reading -----------------------------------------------------------------------------------

interface RawBuffer {
  readonly path: string
  readonly base: string
  readonly text: string
  readonly endings: unknown
}

interface Snapshot {
  readonly layout: string
  readonly tabs: readonly SnapshotTab[]
  readonly buffers: readonly RawBuffer[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readCaret(value: unknown): Caret | null {
  if (!isRecord(value)) return null
  const { anchor, head } = value
  if (typeof anchor !== 'number' || typeof head !== 'number') return null
  if (!Number.isFinite(anchor) || !Number.isFinite(head)) return null
  return { anchor, head }
}

/** Reads a snapshot written by an earlier run. The file is untrusted until it passes. */
function readSnapshot(text: string): Snapshot | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || value.version !== VERSION || typeof value.layout !== 'string') return null
  const tabs: SnapshotTab[] = []
  for (const tab of Array.isArray(value.tabs) ? (value.tabs as unknown[]) : []) {
    if (!isRecord(tab) || typeof tab.id !== 'string' || typeof tab.path !== 'string') continue
    tabs.push({ id: tab.id, path: tab.path, caret: readCaret(tab.caret) ?? { anchor: 0, head: 0 } })
  }
  const buffers: RawBuffer[] = []
  for (const buffer of Array.isArray(value.buffers) ? (value.buffers as unknown[]) : []) {
    if (!isRecord(buffer)) continue
    const { path, base, text: bufferText, endings } = buffer
    if (typeof path !== 'string' || typeof bufferText !== 'string') continue
    buffers.push({ path, base: typeof base === 'string' ? base : '', text: bufferText, endings })
  }
  return { layout: value.layout, tabs, buffers }
}

function countBreaks(text: string): number {
  let count = 0
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count++
  return count
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export interface RestoreReport {
  /** Tabs put back. */
  readonly tabs: number
  /** Unsaved buffers put back in their tabs. */
  readonly buffers: number
  /** One line per thing that could not be put back, saying where its text went. */
  readonly notices: readonly string[]
}

/**
 * Puts the workbench back as the last run left it: tabs, layout, carets and unsaved edits. Text
 * that cannot go back in a tab (its file is gone, or its record is damaged) goes to a file in the
 * data folder instead, and the notice says where. Returns null on a first start.
 */
export async function restoreSession(): Promise<RestoreReport | null> {
  const host = await getHost()
  const text = await host.loadSession()
  if (text === null) return null
  const notices: string[] = []

  const snapshot = readSnapshot(text)
  if (snapshot === null) {
    const kept = await host.recoverBuffer('session', text)
    return {
      tabs: 0,
      buffers: 0,
      notices: [`The saved session could not be read. A copy is in ${kept}.`],
    }
  }

  // Open every file the session names, in parallel.
  const paths = [...new Set([...snapshot.tabs, ...snapshot.buffers].map((entry) => entry.path))]
  const opened = new Map<string, { doc: Document; file: OpenedFile }>()
  await Promise.all(
    paths.map(async (path) => {
      try {
        const { doc, opened: file } = await openDocument(path)
        opened.set(path, { doc, file })
      } catch {
        // Reported below, for tabs and buffers alike.
      }
    }),
  )

  // Unsaved text goes back first, so a tab never shows the disk's version of it for a moment.
  const restored = new Set<number>()
  let buffers = 0
  const recover = async (buffer: RawBuffer, why: string): Promise<void> => {
    const endings = readEndings(buffer.endings, countBreaks(buffer.text))
    const raw = endings === null ? buffer.text : joinWithEndings(buffer.text, endings)
    try {
      const kept = await host.recoverBuffer(fileName(buffer.path), raw)
      notices.push(`${why}: the unsaved text of ${fileName(buffer.path)} is in ${kept}.`)
    } catch (error) {
      notices.push(
        `${why}, and its unsaved text could not be kept: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      )
    }
  }
  for (const buffer of snapshot.buffers) {
    const entry = opened.get(buffer.path)
    if (entry === undefined) {
      await recover(buffer, `${fileName(buffer.path)} could not be opened`)
      continue
    }
    const { doc, file } = entry
    const endings = readEndings(buffer.endings, countBreaks(buffer.text))
    if (endings === null) {
      await recover(buffer, `The saved line endings of ${fileName(buffer.path)} are damaged`)
    } else if (
      doc.readOnly !== null ||
      file.readOnly !== null ||
      doc.dirty ||
      restored.has(doc.id)
    ) {
      await recover(buffer, `${fileName(buffer.path)} can no longer take the saved edits`)
    } else {
      doc.restoreBuffer(file, { text: buffer.text, endings })
      restored.add(doc.id)
      buffers++
      // The file changed since the edits were typed: both versions are the user's to choose from.
      if (doc.dirty && file.hash !== buffer.base) patchDocMeta(doc.id, { conflict: 'disk' })
    }
  }

  const tabs = restoreTabs(snapshot, opened, notices)
  if (notices.length > 0) await flushSession() // what was recovered no longer needs the snapshot
  return { tabs, buffers, notices }
}

/** Rebuilds the layout and the tabs in it. Returns how many tabs came back. */
function restoreTabs(
  snapshot: Snapshot,
  opened: ReadonlyMap<string, { doc: Document }>,
  notices: string[],
): number {
  const byId = new Map(snapshot.tabs.map((tab) => [tab.id, tab]))
  const records = new Map<TabId, TabRecord>()
  for (const tab of snapshot.tabs) {
    const entry = opened.get(tab.path)
    if (entry === undefined) {
      notices.push(`${fileName(tab.path)} could not be opened.`)
      continue
    }
    records.set(tab.id, { kind: 'markdown', docId: entry.doc.id })
  }

  const parsed = deserialize(snapshot.layout)
  let layout: Layout | null = parsed.ok ? parsed.layout : null
  if (layout !== null) {
    // Tabs the layout holds but that cannot come back leave it; tabs it forgot stay out.
    for (const id of allTabs(layout)) {
      if (!records.has(id) || !byId.has(id)) layout = closeTab(layout, id)
    }
    const kept = new Set(allTabs(layout))
    for (const id of [...records.keys()]) if (!kept.has(id)) records.delete(id)
    restoreWorkbench(layout, records)
    for (const [id, record] of records) {
      documentById(record.docId)?.seedCaret(id, byId.get(id)?.caret ?? { anchor: 0, head: 0 })
    }
    return records.size
  }

  // A layout that cannot be read still leaves the tabs: put them side by side in one pane.
  notices.push('The saved window layout could not be read, so the tabs are in one pane.')
  restoreWorkbench(createLayout(), new Map())
  for (const [oldId, record] of records) {
    const id = openTabFor(record)
    documentById(record.docId)?.seedCaret(id, byId.get(oldId)?.caret ?? { anchor: 0, head: 0 })
  }
  return records.size
}

// ---- startup -----------------------------------------------------------------------------------

let markReady: (report: RestoreReport | null) => void = () => undefined

/** Settles once the last session is back and the journal is running. The perf scenarios wait for it. */
export const sessionReady = new Promise<RestoreReport | null>((resolve) => {
  markReady = resolve
})

/** Restores the last session before the first paint. It never fails startup: a problem becomes a notice. */
export async function restoreOnStart(): Promise<RestoreReport | null> {
  performance.mark('restore-start')
  try {
    const report = await restoreSession()
    performance.mark('restore-end')
    if (report !== null && report.notices.length > 0) problem.value = report.notices.join(' ')
    return report
  } catch (error) {
    problem.value = `Could not restore the last session: ${error instanceof Error ? error.message : JSON.stringify(error)}`
    return null
  }
}

/** Starts the journal once the window is up, then announces that the session is ready. */
export async function beginJournal(report: RestoreReport | null): Promise<void> {
  await startJournal()
  markReady(report)
}
