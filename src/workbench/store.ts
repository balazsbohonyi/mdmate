import { computed, shallowReactive, shallowRef } from 'vue'
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

/**
 * The live workbench: the current layout and the title of every tab. A module-level store, shared
 * by the panes, the commands and the shell. The layout is replaced whole on each change, so it is
 * held in a shallow ref and the pure functions in `splitTree.ts` do the work.
 */
const layout = shallowRef<Layout>(createLayout())
const titles = shallowReactive(new Map<TabId, string>())
let tabCounter = 0

export const workbenchLayout = computed(() => layout.value)

export function tabTitle(id: TabId): string {
  return titles.get(id) ?? id
}

function change(update: (current: Layout) => Layout): void {
  layout.value = update(layout.value)
  // Titles of closed tabs go with them.
  const open = new Set(allTabs(layout.value))
  for (const id of [...titles.keys()]) if (!open.has(id)) titles.delete(id)
}

function newTabId(title: string): TabId {
  const id = `tab-${++tabCounter}`
  titles.set(id, title)
  return id
}

/** Opens a new tab in a pane (the active one by default). */
export function openNewTab(title: string, paneId?: PaneId): TabId {
  const id = newTabId(title)
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
 * Splits the active pane. The new pane opens a second tab with the active tab's title, standing in
 * for a second view of the same document until Phase 2 has documents. `title` names the new tab
 * instead. An active pane with no tab gets an empty neighbour.
 */
export function splitActivePane(direction: Direction, title?: string): void {
  const current = layout.value
  const active = findPane(current, current.activePane)
  const copied = active?.activeTab ? tabTitle(active.activeTab) : null
  const name = title ?? copied
  const tabs = name === null ? [] : [newTabId(name)]
  change((state) => splitPane(state, state.activePane, direction, 'after', tabs))
}

/** Starts over with one empty pane. Tests and the dev seed use it. */
export function resetWorkbench(): void {
  layout.value = createLayout()
  titles.clear()
  tabCounter = 0
}
