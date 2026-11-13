import type { Text } from '@codemirror/state'
import { shallowRef, watch } from 'vue'
import { describe, followerOfTab, activeDocument, watchDocuments } from '@/documents/store'
import { getHost, type OutlineHeading, type OutlineRequest } from '@/platform'
import { focusActiveEditor, holdingEditorFocus } from '@/workbench/focus'
import { showSidebar } from '@/workbench/sidebar'
import { workbenchLayout } from '@/workbench/store'
import { findPane } from '@/workbench/splitTree'

/**
 * The outline of the document in the active tab. The headings are Rust's scan of the whole file
 * (`src-tauri/src/outline`), so a 10 MB file is covered however far the editor's parser has got.
 * Nothing is scanned unless the panel is on screen: `startOutline` begins when it mounts and
 * `stopOutline` ends when it goes, and a document with unsaved edits reaches Rust as text after
 * the typing has paused.
 */

/** How long typing must pause before the unsaved text is scanned. */
export const OUTLINE_DEBOUNCE_MS = 400

export type OutlinePhase = 'idle' | 'loading' | 'ready' | 'failed' | 'unsupported'

export interface OutlineState {
  readonly phase: OutlinePhase
  /** The headings of the last scan, in order. Kept while the next one runs, so the list does not blink. */
  readonly headings: readonly OutlineHeading[]
  /** There were more headings than Rust lists. */
  readonly truncated: boolean
  /** The words for why a scan could not run. */
  readonly message: string | null
}

const IDLE: OutlineState = { phase: 'idle', headings: [], truncated: false, message: null }

export const outlineState = shallowRef<OutlineState>(IDLE)

/** The number of the selected heading, from 0, or -1. */
export const selectedHeading = shallowRef(-1)

/** Numbers the scans, so a slow one that was replaced cannot overwrite the newer answer. */
let latest = 0
/** The document and the text the last scan was asked for, to see what changed since. */
let scanned: { readonly id: number; readonly text: Text } | null = null
/** The text at the last notification, so only a change of text restarts the wait. */
let seenText: Text | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let stops: (() => void)[] = []

/** What the active tab shows, or nothing. */
function current() {
  return activeDocument()
}

async function scan(): Promise<void> {
  const doc = current()
  const mine = ++latest
  if (doc === undefined) {
    scanned = null
    selectedHeading.value = -1
    outlineState.value = IDLE
    return
  }
  scanned = { id: doc.id, text: doc.master.doc }
  seenText = doc.master.doc
  if (doc.kind !== 'markdown') {
    selectedHeading.value = -1
    outlineState.value = { ...IDLE, phase: 'unsupported' }
    return
  }
  // Text for a document the disk does not have; the path for one it does.
  const request: OutlineRequest =
    doc.dirty || doc.untitled
      ? { id: mine, text: doc.snapshot().text }
      : { id: mine, path: doc.path }
  outlineState.value = { ...outlineState.value, phase: 'loading', message: null }
  try {
    const answer = await (await getHost()).outlineScan(request)
    if (mine !== latest) return
    // A new list may be shorter than the old one; a selection past its end would point at nothing.
    if (selectedHeading.value >= answer.headings.length) selectedHeading.value = -1
    outlineState.value = {
      phase: 'ready',
      headings: answer.headings,
      truncated: answer.truncated,
      message: null,
    }
  } catch (error) {
    if (mine !== latest) return
    outlineState.value = { ...IDLE, phase: 'failed', message: describe(error) }
  }
}

function scanSoon(): void {
  clearTimeout(timer)
  timer = setTimeout(() => void scan(), OUTLINE_DEBOUNCE_MS)
}

function scanNow(): void {
  clearTimeout(timer)
  void scan()
}

/** Begins following the active document. Called when the panel is shown. */
export function startOutline(): void {
  stopOutline()
  // A change of text, as every edit, undo and reload makes one: wait for the typing to pause.
  // A caret move or a save leaves the same text object, which costs one comparison.
  stops.push(
    watchDocuments(() => {
      const doc = current()
      if (doc === undefined) {
        seenText = null
        if (scanned !== null) scanNow()
      } else if (doc.id !== scanned?.id) {
        seenText = doc.master.doc
        scanNow()
      } else if (doc.master.doc !== seenText) {
        // The text changed since the last notification. Other notifications follow an edit (the
        // session's journal, a changed caret) and must not push the scan later.
        seenText = doc.master.doc
        if (doc.master.doc !== scanned.text) scanSoon()
      }
    }),
  )
  // A different tab, or none.
  stops.push(
    watch(() => {
      const layout = workbenchLayout.value
      return findPane(layout, layout.activePane)?.activeTab ?? null
    }, scanNow),
  )
  scanNow()
}

/** Stops following. Called when the panel goes; nothing is scanned after this. */
export function stopOutline(): void {
  clearTimeout(timer)
  timer = undefined
  for (const stop of stops) stop()
  stops = []
  // An answer on its way has nobody to show it to.
  latest += 1
}

/** Puts the caret on the start of the line a heading is on, in the active tab. */
function reveal(heading: OutlineHeading): void {
  const layout = workbenchLayout.value
  const tab = findPane(layout, layout.activePane)?.activeTab
  const follower = tab === null || tab === undefined ? undefined : followerOfTab(tab)
  if (follower === undefined) return
  const doc = follower.state.doc
  follower.reveal(doc.line(Math.min(Math.max(heading.line, 1), doc.lines)).from)
}

/**
 * Shows a heading in the active tab. By default focus stays in the list, as it does in the tree;
 * `focusEditor` is for Enter and a double click, which mean "take me there".
 */
export async function openHeading(
  index: number,
  how: { focusEditor?: boolean } = {},
): Promise<void> {
  const heading = outlineState.value.headings[index]
  if (heading === undefined) return
  if (how.focusEditor === true) {
    reveal(heading)
    focusActiveEditor()
  } else {
    await holdingEditorFocus(() => {
      reveal(heading)
    })
  }
}

// ---- focus ----

/** Counts the requests to put the caret in the list. */
export const outlineFocusRequest = shallowRef(0)
let focusTaken = 0

/** True once for each request made since the last call, so a list drawn later hears one made before. */
export function takeOutlineFocusRequest(): boolean {
  if (outlineFocusRequest.value === focusTaken) return false
  focusTaken = outlineFocusRequest.value
  return true
}

/** Shows the Outline panel with the caret in its list. */
export function showOutline(): void {
  showSidebar('outline')
  outlineFocusRequest.value += 1
}

/** Puts the module back as it starts. For tests. */
export function resetOutline(): void {
  stopOutline()
  scanned = null
  seenText = null
  selectedHeading.value = -1
  outlineState.value = IDLE
  outlineFocusRequest.value = 0
  focusTaken = 0
}
