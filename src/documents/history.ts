import { tabRecord, selectTab, workbenchLayout } from '@/workbench/store'
import { findPane, type TabId } from '@/workbench/splitTree'
import { documentById, documentOfTab, followerOfTab, openPath } from './store'

/**
 * Where the caret was, for Alt+Left and Alt+Right. A location names its tab, and its document's
 * path in case that tab has closed since.
 */
export interface Location {
  readonly tabId: TabId
  readonly docId: number
  readonly path: string
  readonly pos: number
}

/** Older first. `index` is the entry the caret is at now. */
let entries: Location[] = []
let index = -1

/** The most a session remembers; older entries go first. */
const LIMIT = 100

function same(a: Location | undefined, b: Location): boolean {
  return a?.tabId === b.tabId && a.pos === b.pos
}

/** Where the caret of a tab is now, or null for a tab with no document. */
export function locationOf(tabId: TabId): Location | null {
  const doc = documentOfTab(tabId)
  const follower = followerOfTab(tabId)
  if (doc === undefined || follower === undefined) return null
  return { tabId, docId: doc.id, path: doc.path, pos: follower.state.selection.main.head }
}

/** The caret in the active tab of the active pane. */
export function activeLocation(): Location | null {
  const layout = workbenchLayout.value
  const tab = findPane(layout, layout.activePane)?.activeTab ?? null
  return tab === null ? null : locationOf(tab)
}

/**
 * Records a jump, such as following a link, from one place to another. Anything ahead of the
 * current entry (places reached by going back) is dropped, as in a browser.
 */
export function recordJump(from: Location, to: Location): void {
  entries = entries.slice(0, index + 1)
  if (!same(entries.at(-1), from)) entries.push(from)
  if (!same(entries.at(-1), to)) entries.push(to)
  if (entries.length > LIMIT) entries = entries.slice(entries.length - LIMIT)
  index = entries.length - 1
}

/** Puts the caret back at a location: its tab if it is still open, its file otherwise. */
async function visit(location: Location): Promise<boolean> {
  let tabId: TabId = location.tabId
  if (tabRecord(tabId) === undefined) {
    // The tab closed. The file comes back in a new tab, if it can still be opened.
    const open = documentById(location.docId)
    try {
      tabId = await openPath(open?.path ?? location.path)
    } catch {
      return false
    }
  } else {
    selectTab(tabId)
  }
  followerOfTab(tabId)?.reveal(location.pos)
  return true
}

/** Moves one step through the history: -1 is back, +1 is forward. False when there is none. */
async function step(direction: -1 | 1): Promise<boolean> {
  const target = index + direction
  const location = entries[target]
  if (location === undefined) return false
  // Where the caret is now replaces the entry being left, so coming back lands there.
  const here = activeLocation()
  const leaving = entries[index]
  if (here !== null && here.tabId === leaving?.tabId) entries[index] = here
  index = target
  if (await visit(location)) return true
  // A place that cannot be reached any more is dropped; the next press goes on past it.
  entries.splice(target, 1)
  // The entry being left moved down by one when going back, and stayed when going forward.
  index = direction === -1 ? target : target - 1
  return false
}

/** Alt+Left: back to the previous location. */
export function goBack(): Promise<boolean> {
  return step(-1)
}

/** Alt+Right: forward again after going back. */
export function goForward(): Promise<boolean> {
  return step(1)
}

export function canGoBack(): boolean {
  return index > 0
}

export function canGoForward(): boolean {
  return index < entries.length - 1
}

/** For tests and a fresh session. */
export function resetHistory(): void {
  entries = []
  index = -1
}

/** For tests: the entries and the current index. */
export function historySnapshot(): { entries: readonly Location[]; index: number } {
  return { entries: [...entries], index }
}
