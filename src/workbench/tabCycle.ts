import { readonly, shallowRef, watch } from 'vue'
import { focusActiveEditor } from './focus'
import { findPane, type PaneId, type TabId } from './splitTree'
import { selectTab, workbenchLayout } from './store'

/**
 * Ctrl+Tab steps through the tabs of the focused pane the way VS Code does: the tab-list menu of
 * the strip opens with a row marked, every further press moves the mark, and releasing the
 * modifier switches to the marked tab (P9.1-T12). The state here is only the list and the mark;
 * the strip draws it and `keyboard.ts` feeds it the key presses.
 */
export type CycleDirection = 'next' | 'previous'

export interface CycleState {
  readonly paneId: PaneId
  /** The pane's tabs in strip order (pinned first), frozen when the cycle started. */
  readonly ids: readonly TabId[]
  /** Index in `ids` of the marked row. */
  readonly index: number
}

const wrap = (at: number, length: number): number => ((at % length) + length) % length
const stepOf = (direction: CycleDirection): number => (direction === 'next' ? 1 : -1)

/**
 * The state of a cycle that has just begun: the row after (or before) the active tab is marked.
 * Null when the pane has fewer than two tabs, since there is nothing to switch to.
 */
export function startCycle(
  paneId: PaneId,
  ids: readonly TabId[],
  activeId: TabId | null,
  direction: CycleDirection,
): CycleState | null {
  if (ids.length < 2) return null
  const from = Math.max(0, activeId === null ? 0 : ids.indexOf(activeId))
  return { paneId, ids, index: wrap(from + stepOf(direction), ids.length) }
}

/** The state with the mark moved one row on, wrapping at the ends. */
export function stepCycle(state: CycleState, direction: CycleDirection): CycleState {
  return { ...state, index: wrap(state.index + stepOf(direction), state.ids.length) }
}

/** The tab the mark is on. */
export function markedTab(state: CycleState): TabId {
  const id = state.ids[state.index]
  if (id === undefined) throw new Error('the cycle mark is outside its tab list')
  return id
}

/** The tab after (or before) `activeId` in strip order, wrapping, or null when there is no other. */
export function neighbourTab(
  ids: readonly TabId[],
  activeId: TabId | null,
  direction: CycleDirection,
): TabId | null {
  const state = startCycle('', ids, activeId, direction)
  return state === null ? null : markedTab(state)
}

const state = shallowRef<CycleState | null>(null)

/** The cycle under way, or null. Reactive: the strip of the pane it names draws the menu from it. */
export const tabCycle = readonly(state)

/**
 * The keys whose release ends the cycle: the modifiers held by the chord that started it. None
 * for a cycle that was started with no key press (the palette), which has no release to wait for.
 */
let releaseKeys: ReadonlySet<string> = new Set()
let chord: ReadonlySet<string> = new Set()

/** The modifiers (not Shift) a key press holds, as `KeyboardEvent.key` names them on release. */
export function heldModifiers(event: {
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}): ReadonlySet<string> {
  const held = new Set<string>()
  if (event.ctrlKey) held.add('Control')
  if (event.altKey) held.add('Alt')
  if (event.metaKey) held.add('Meta')
  return held
}

/**
 * Says which key press runs the next cycle command, or null when the next one has no key (it
 * comes from the palette). The key handler sets it just before the command and clears it after.
 */
export function noteChord(modifiers: ReadonlySet<string> | null): void {
  chord = modifiers ?? new Set()
}

const paneTabs = (): { paneId: PaneId; ids: readonly TabId[]; active: TabId | null } | null => {
  const layout = workbenchLayout.value
  const pane = findPane(layout, layout.activePane)
  return pane === undefined ? null : { paneId: pane.id, ids: pane.tabs, active: pane.activeTab }
}

/** True when the focused pane has a second tab to go to. */
export function canCycleTabs(): boolean {
  return (paneTabs()?.ids.length ?? 0) > 1
}

/** True while a cycle is open. */
export function isCycling(): boolean {
  return state.value !== null
}

/**
 * Ctrl+Tab (or Ctrl+Shift+Tab). With no cycle open it opens one on the focused pane; with one open
 * it moves the mark. With no key to wait for the release of, it switches at once.
 */
export function cycleTabs(direction: CycleDirection): void {
  if (state.value !== null) {
    state.value = stepCycle(state.value, direction)
    return
  }
  const pane = paneTabs()
  if (pane === null) return
  const next = startCycle(pane.paneId, pane.ids, pane.active, direction)
  if (next === null) return
  if (chord.size === 0) {
    selectTab(markedTab(next))
    focusActiveEditor()
    return
  }
  releaseKeys = chord
  state.value = next
}

/** Ctrl+PageDown and Ctrl+PageUp: the next or previous tab, with no menu. */
export function stepTabs(direction: CycleDirection): void {
  const pane = paneTabs()
  if (pane === null) return
  const id = neighbourTab(pane.ids, pane.active, direction)
  if (id === null) return
  selectTab(id)
  focusActiveEditor()
}

/** Ends the cycle by switching to the marked tab. */
export function commitCycle(): void {
  const open = state.value
  if (open === null) return
  state.value = null
  selectTab(markedTab(open))
  focusActiveEditor()
}

// Another pane taking the focus (a click, a split) ends the cycle with no switch.
watch(
  () => workbenchLayout.value.activePane,
  (paneId) => {
    if (state.value !== null && state.value.paneId !== paneId) state.value = null
  },
  { flush: 'sync' },
)

/** Ends the cycle with no switch. */
export function cancelCycle(): void {
  state.value = null
}

/** A key went up: when it is one the chord was holding, the cycle ends with a switch. */
export function releaseKey(key: string): boolean {
  if (state.value === null || !releaseKeys.has(key)) return false
  commitCycle()
  return true
}

/**
 * Keys that mean something only while a cycle is open: Tab and Down move the mark on, Shift+Tab and
 * Up move it back, Escape cancels and Enter switches. Returns true when the key was one of them.
 */
export function cycleKey(event: { readonly key: string; readonly shiftKey: boolean }): boolean {
  if (state.value === null) return false
  switch (event.key) {
    case 'Tab':
      cycleTabs(event.shiftKey ? 'previous' : 'next')
      return true
    case 'ArrowDown':
      cycleTabs('next')
      return true
    case 'ArrowUp':
      cycleTabs('previous')
      return true
    case 'Escape':
      cancelCycle()
      return true
    case 'Enter':
      commitCycle()
      return true
    default:
      return false
  }
}

/** Forgets the cycle and the chord. Tests use it. */
export function resetTabCycle(): void {
  state.value = null
  releaseKeys = new Set()
  chord = new Set()
}
