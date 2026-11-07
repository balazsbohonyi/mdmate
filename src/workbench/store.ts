import { computed, shallowReactive, shallowRef } from 'vue'
import { docMeta } from '@/documents/meta'
import {
  activatePane,
  activateTab,
  allTabs,
  closePane,
  closeTab,
  createLayout,
  findPane,
  moveTab,
  moveTabToEdge,
  openTab,
  setSizes,
  splitPane,
  type Direction,
  type Edge,
  type Layout,
  type PaneId,
  type SplitId,
  type TabId,
} from './splitTree'
import type { TabInfo, TabRecord } from './tabs'

/**
 * The live workbench: the current layout and what each tab shows. A module-level store, shared by
 * the panes, the commands and the shell. The layout is replaced whole on each change, so it is
 * held in a shallow ref and the pure functions in `splitTree.ts` do the work.
 */
const layout = shallowRef<Layout>(createLayout())
const records = shallowReactive(new Map<TabId, TabRecord>())
let tabCounter = 0

export const workbenchLayout = computed(() => layout.value)

export function tabRecord(id: TabId): TabRecord | undefined {
  return records.get(id)
}

/** The name on a tab: its document's file name. */
export function tabTitle(id: TabId): string {
  const record = records.get(id)
  return (record && docMeta(record.docId)?.name) ?? id
}

export function tabInfo(id: TabId): TabInfo {
  const record = records.get(id)
  const meta = record && docMeta(record.docId)
  return {
    id,
    kind: record?.kind ?? 'markdown',
    title: meta?.name ?? id,
    dirty: meta?.dirty ?? false,
  }
}

/** Every tab that shows this document. */
export function tabsOfDocument(docId: number): TabId[] {
  return [...records].filter(([, record]) => record.docId === docId).map(([id]) => id)
}

type ClosedListener = (tabId: TabId, record: TabRecord) => void
const closedListeners = new Set<ClosedListener>()

/** Calls `listener` for each tab that leaves the layout, however it left. Returns the stop function. */
export function onTabClosed(listener: ClosedListener): () => void {
  closedListeners.add(listener)
  return () => {
    closedListeners.delete(listener)
  }
}

function change(update: (current: Layout) => Layout): void {
  layout.value = update(layout.value)
  // Records of closed tabs go with them, and the listeners hear about each.
  const open = new Set(allTabs(layout.value))
  for (const [id, record] of [...records]) {
    if (open.has(id)) continue
    records.delete(id)
    for (const listener of closedListeners) listener(id, record)
  }
}

function newTabId(record: TabRecord): TabId {
  const id = `tab-${++tabCounter}`
  records.set(id, record)
  return id
}

/** Opens a new tab showing `record` in a pane (the active one by default). */
export function openTabFor(record: TabRecord, paneId?: PaneId): TabId {
  const id = newTabId(record)
  change((current) => openTab(current, id, paneId))
  return id
}

export function selectTab(tabId: TabId): void {
  change((current) => activateTab(current, tabId))
}

export function focusPane(paneId: PaneId): void {
  change((current) => activatePane(current, paneId))
}

export function closeTabById(tabId: TabId): void {
  change((current) => closeTab(current, tabId))
}

export function closePaneById(paneId: PaneId): void {
  change((current) => closePane(current, paneId))
}

export function moveTabTo(tabId: TabId, paneId: PaneId, index?: number): void {
  change((current) => moveTab(current, tabId, paneId, index))
}

export function dropTabOnEdge(tabId: TabId, paneId: PaneId, edge: Edge): void {
  change((current) => moveTabToEdge(current, tabId, paneId, edge))
}

export function resizeSplit(splitId: SplitId, sizes: readonly number[]): void {
  change((current) => setSizes(current, splitId, sizes))
}

/**
 * Splits the active pane. The new pane opens a tab on `shown`, or by default on the same document
 * as the active tab, so an edit in either pane shows in both. With neither, the new pane is empty.
 */
export function splitActivePane(direction: Direction, shown?: TabRecord): void {
  const current = layout.value
  const active = findPane(current, current.activePane)
  const record = shown ?? (active?.activeTab ? records.get(active.activeTab) : undefined)
  const tabs = record === undefined ? [] : [newTabId(record)]
  change((state) => splitPane(state, state.activePane, direction, 'after', tabs))
}

/**
 * Replaces the whole workbench with a layout read from a saved session and the tabs it names.
 * Every tab in the layout must have a record. New tabs get ids after the highest one restored.
 */
export function restoreWorkbench(restored: Layout, tabs: ReadonlyMap<TabId, TabRecord>): void {
  const open = new Set(allTabs(restored))
  for (const id of open) {
    if (!tabs.has(id)) throw new Error(`restoring a layout: tab ${id} has no record`)
  }
  records.clear()
  for (const id of open) {
    const record = tabs.get(id)
    if (record !== undefined) records.set(id, record)
  }
  tabCounter = Math.max(0, ...[...open].map((id) => Number(/^tab-(\d+)$/.exec(id)?.[1] ?? 0)))
  layout.value = restored
}

/** Starts over with one empty pane. Tests use it. */
export function resetWorkbench(): void {
  layout.value = createLayout()
  records.clear()
  tabCounter = 0
}
