import {
  closeAllTabs,
  closeTabs,
  describe,
  documentOfTab,
  requestCloseTab,
  saveDocumentAs,
} from '@/documents/store'
import { findFileReferences } from '@/features/references/store'
import { separatorOf } from '@/features/tree/model'
import { renameRow, revealInFileManager } from '@/features/tree/ops'
import { revealPath, rootOf } from '@/features/tree/store'
import { getHost } from '@/platform'
import { showSidebar } from './sidebar'
import { findPane, paneOfTab, pinnedCount, type PaneNode, type TabId } from './splitTree'
import { pinTabById, tabRecord, unpinTabById, workbenchLayout } from './store'
import { reportError, reportWarning } from '@/shell/toasts'

/**
 * What the tab context menu does. Every function takes the tab that was right-clicked, never the
 * active one, so each works on a tab in the background as well. The menu does not activate the tab
 * it was opened on.
 */

/** The file a tab shows, or null for a tab with no file (an untitled document). */
export function tabPath(tabId: TabId): string | null {
  const record = tabRecord(tabId)
  if (record === undefined) return null
  if (record.kind === 'image') return record.path
  const doc = documentOfTab(tabId)
  return doc === undefined || doc.untitled ? null : doc.path
}

/** The tab the active pane is showing, or null when no tab is open. */
export function activeTabId(): TabId | null {
  const layout = workbenchLayout.value
  return findPane(layout, layout.activePane)?.activeTab ?? null
}

/** Why Rename is off for a file outside every open folder. Shown as the item's tooltip. */
export const RENAME_OUTSIDE_FOLDER = 'Only a file in an open folder can be renamed.'

/** The tabs of a pane that are not pinned, in order. The Close commands other than Close leave pinned tabs open. */
function unpinnedTabs(pane: PaneNode): readonly TabId[] {
  return pane.tabs.slice(pinnedCount(pane))
}

/** Which items of the menu apply to a tab. */
export interface TabMenuState {
  /** The tab shows an untitled document, which has no file yet. */
  readonly untitled: boolean
  readonly hasPath: boolean
  /** The tab is pinned, so the menu offers Unpin Tab and not Pin Tab. */
  readonly pinned: boolean
  /** The pane holds other tabs to close that are not pinned. */
  readonly canCloseOthers: boolean
  /** The pane holds tabs to the right of this one that are not pinned. */
  readonly canCloseToTheRight: boolean
  /** The pane holds a tab that is not pinned, which is what Close All would close. */
  readonly canCloseAll: boolean
  /** The file lies in an open folder, so the tree has a row for it. */
  readonly canRevealInSidebar: boolean
  readonly canRename: boolean
  /** Why Rename is off, when it is off for a reason the user can act on; otherwise null. */
  readonly renameWhyNot: string | null
}

/** The tabs after this one in its pane that are not pinned. */
function rightOf(pane: PaneNode, tabId: TabId): readonly TabId[] {
  return pane.tabs.slice(pane.tabs.indexOf(tabId) + 1).filter((tab) => !isPinnedIn(pane, tab))
}

function isPinnedIn(pane: PaneNode, tabId: TabId): boolean {
  return pane.tabs.indexOf(tabId) < pinnedCount(pane)
}

/** Pins the tab, or unpins it when it is pinned. */
export function togglePinTab(tabId: TabId): void {
  const pane = paneOfTab(workbenchLayout.value, tabId)
  if (pane === undefined) return
  if (isPinnedIn(pane, tabId)) unpinTabById(tabId)
  else pinTabById(tabId)
}

export function tabMenuState(tabId: TabId): TabMenuState {
  const path = tabPath(tabId)
  const doc = documentOfTab(tabId)
  const pane = paneOfTab(workbenchLayout.value, tabId)
  const inRoot = path !== null && rootOf(path) !== undefined
  const untitled = doc?.untitled === true
  return {
    untitled,
    hasPath: path !== null,
    pinned: pane !== undefined && pane.tabs.indexOf(tabId) < pinnedCount(pane),
    canCloseOthers: pane !== undefined && unpinnedTabs(pane).some((other) => other !== tabId),
    canCloseToTheRight: pane !== undefined && rightOf(pane, tabId).length > 0,
    canCloseAll: pane !== undefined && unpinnedTabs(pane).length > 0,
    canRevealInSidebar: inRoot,
    // A new file is named by Save As; a file on disk is renamed in its tree row.
    canRename: untitled || inRoot,
    renameWhyNot: path !== null && !inRoot ? RENAME_OUTSIDE_FOLDER : null,
  }
}

/** Closes the tab, asking first when it holds the last view of unsaved edits. */
export function closeTab(tabId: TabId): void {
  requestCloseTab(tabId)
}

/**
 * Closes every other tab of the pane the tab is in, asking about each document with unsaved
 * edits. Pinned tabs stay open. When the tab that was kept is not pinned and no pinned tab is left
 * either, it is the only one in the pane. False when the user cancelled a question.
 */
export async function closeOtherTabs(tabId: TabId): Promise<boolean> {
  const pane = paneOfTab(workbenchLayout.value, tabId)
  if (pane === undefined) return true
  return closeTabs(unpinnedTabs(pane).filter((other) => other !== tabId))
}

/**
 * Closes the tabs to the right of this one in its pane, left to right, asking about each document
 * with unsaved edits. Pinned tabs stay open, and the other panes are never touched. False when the
 * user cancelled a question.
 */
export async function closeTabsToTheRight(tabId: TabId): Promise<boolean> {
  const pane = paneOfTab(workbenchLayout.value, tabId)
  if (pane === undefined) return true
  return closeTabs(rightOf(pane, tabId))
}

/** Closes every tab of the pane this tab is in that is not pinned, and no tab of another pane. */
export function closeEveryTab(tabId: TabId): Promise<boolean> {
  return closeAllTabs(paneOfTab(workbenchLayout.value, tabId)?.id)
}

/**
 * The path from the folder that holds it, written with the separator the full path uses (backslashes
 * for a Windows path), or the full path for a file outside every folder.
 */
export function relativePathOf(path: string): string {
  const root = rootOf(path)
  if (root === undefined) return path
  const separator = separatorOf(path)
  return path
    .slice(root.length)
    .replace(/^[\\/]+/, '')
    .replace(/[\\/]+/g, separator)
}

async function copy(text: string): Promise<void> {
  try {
    const host = await getHost()
    await host.writeClipboard(text)
  } catch (error) {
    reportError(`Could not copy to the clipboard: ${describe(error)}`)
  }
}

/** Copies a full path. The tab menu and the tree menu both use it. */
export function copyPath(path: string): Promise<void> {
  return copy(path)
}

/** Copies a path from the folder that holds it, or the full path outside every folder. */
export function copyRelativePath(path: string): Promise<void> {
  return copy(relativePathOf(path))
}

/** Copies the file's full path. */
export async function copyTabPath(tabId: TabId): Promise<void> {
  const path = tabPath(tabId)
  if (path !== null) await copyPath(path)
}

/** Copies the file's path from its folder, or the full path outside every folder. */
export async function copyTabRelativePath(tabId: TabId): Promise<void> {
  const path = tabPath(tabId)
  if (path !== null) await copyRelativePath(path)
}

/** Shows the file in the system's file manager. */
export async function revealTabInExplorer(tabId: TabId): Promise<void> {
  const path = tabPath(tabId)
  if (path !== null) await revealInFileManager(path)
}

/** Selects the file in the tree, opening the folders above it. Shows the sidebar if it was hidden. */
export async function revealTabInSidebar(tabId: TabId): Promise<void> {
  const path = tabPath(tabId)
  if (path === null || rootOf(path) === undefined) return
  showSidebar('folders')
  await revealPath(path)
}

/**
 * Renames the file through the tree's name box, which moves it with the links that point at it
 * (the question and the report are the rename's own). An untitled document has no name to change,
 * so naming it is Save As.
 */
export async function renameTab(tabId: TabId): Promise<void> {
  const doc = documentOfTab(tabId)
  if (doc?.untitled === true) {
    await saveDocumentAs(doc.id)
    return
  }
  const path = tabPath(tabId)
  if (path === null || rootOf(path) === undefined) {
    reportWarning(RENAME_OUTSIDE_FOLDER)
    return
  }
  showSidebar('folders')
  await revealPath(path)
  await renameRow(path)
}

/** Lists the links that lead to the file, in the sidebar. */
export async function findTabReferences(tabId: TabId): Promise<void> {
  const path = tabPath(tabId)
  if (path !== null) await findFileReferences(path)
}

/** The menu item that shows a file in its folder, the same on every system (ISC-230). */
export const OPEN_CONTAINING_FOLDER = 'Open Containing Folder'

/** The menu item that opens a folder itself in the file manager (ISC-230). */
export const OPEN_FOLDER = 'Open Folder'

/**
 * Called when the menu closes. A menu gives focus back to what opened it, which would take it from
 * the tree's name box (opened by Rename) and cancel the rename; the box keeps it instead.
 */
export function keepNameBoxFocus(event: Event): void {
  const box = document.querySelector<HTMLElement>('[data-name-input]')
  if (box === null) return
  event.preventDefault()
  box.focus()
}
