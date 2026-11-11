import { reactive, ref } from 'vue'
import { followerOfTab } from '@/documents/store'
import type { Follower } from '@/documents/follower'
import {
  EMPTY_FIND,
  findEffect,
  findNext,
  findPrevious,
  replaceEvery,
  replaceOne,
  seedFromSelection,
  type FindSpec,
} from '@/editor/find'
import { focusActiveEditor } from './focus'
import { findPane } from './splitTree'
import { workbenchLayout } from './store'

/**
 * Find and replace in the active file (P7-T1). There is one query for the whole window, as in
 * other editors: what you typed in one pane is what the next pane's bar shows. The bar itself
 * belongs to a pane (`FindBar.vue`), so it stays when a tab in that pane changes, and each pane's
 * open or closed state is kept here. The query reaches the editor as an effect on the shown tab's
 * state; the bar does that, and clears it again when it closes or the tab changes.
 */

/** What one pane's bar is showing. */
export interface FindBarState {
  /** The replace row is open. */
  readonly replace: boolean
  /** Counts the requests to move focus into the bar's search box; 0 means none was made. */
  readonly focus: number
}

/** The query, what to replace it with and the switches. */
export const findSpec = ref<FindSpec>({ ...EMPTY_FIND })

/** The panes that have a bar open, by pane id. */
export const findBars = reactive(new Map<string, FindBarState>())

interface Target {
  readonly paneId: string
  readonly tabId: string
  readonly follower: Follower
}

/** The active pane and its tab, when that tab shows a document the bar can search. */
function target(): Target | null {
  const layout = workbenchLayout.value
  const tabId = findPane(layout, layout.activePane)?.activeTab ?? null
  const follower = tabId === null ? undefined : followerOfTab(tabId)
  return tabId === null || follower === undefined
    ? null
    : { paneId: layout.activePane, tabId, follower }
}

/** True when the active tab is a file Find can search. */
export function canFind(): boolean {
  return target() !== null
}

/** Changes part of the query. */
export function setFind(patch: Partial<FindSpec>): void {
  findSpec.value = { ...findSpec.value, ...patch }
}

/**
 * Opens the bar in the active pane and puts the caret in its search box, with the selected piece of
 * one line as the query when there is one. `replace` also opens the replace row. `takeFocus` false
 * opens it without moving focus, for F3, which steps through matches while you keep writing.
 */
export function openFind(replace = false, takeFocus = true): void {
  const t = target()
  if (t === null) return
  findSpec.value = seedFromSelection(t.follower.state, findSpec.value)
  const open = findBars.get(t.paneId)
  findBars.set(t.paneId, {
    replace: replace || (open?.replace ?? false),
    focus: (open?.focus ?? 0) + (takeFocus ? 1 : 0),
  })
}

/** Shows or hides the replace row of a pane's bar. */
export function toggleReplaceRow(paneId: string): void {
  const open = findBars.get(paneId)
  if (open !== undefined) findBars.set(paneId, { ...open, replace: !open.replace })
}

/**
 * Closes a pane's bar. With `returnFocus` the caret goes back to the editor, which is what Escape
 * and the close button want: the user was searching in order to write.
 */
export function closeFind(paneId: string, returnFocus = true): void {
  findBars.delete(paneId)
  if (returnFocus) focusActiveEditor()
}

/** Puts the query on a tab's state, or an empty one to take its marks away. */
export function applyFind(tabId: string, spec: FindSpec): void {
  followerOfTab(tabId)?.reconfigure(findEffect(spec))
}

/** What the bar and the commands can do to the current match. */
export type FindAction = 'next' | 'previous' | 'replace' | 'replaceAll'

const RUN = {
  next: findNext,
  previous: findPrevious,
  replace: replaceOne,
  replaceAll: replaceEvery,
} as const

/**
 * Runs one of the actions on a tab's view, with the query as it is now. False when there is no
 * match, no view, or (for a replace) the document is read-only.
 */
export function runFind(tabId: string, action: FindAction): boolean {
  const follower = followerOfTab(tabId)
  const view = follower?.view ?? null
  if (follower === undefined || view === null) return false
  // The bar sets the query as it changes; setting it again here covers a key pressed with no bar.
  follower.reconfigure(findEffect(findSpec.value))
  return RUN[action](view)
}

/**
 * Find Next and Find Previous from the keyboard. With no bar open they open one first, so the
 * marks and the count are on screen for the match they select.
 */
export function stepFind(direction: 'next' | 'previous'): void {
  const t = target()
  if (t === null) return
  if (!findBars.has(t.paneId)) openFind(false, false)
  runFind(t.tabId, direction)
}

/** Puts the module back as it starts. For tests. */
export function resetFind(): void {
  findSpec.value = { ...EMPTY_FIND }
  findBars.clear()
}
