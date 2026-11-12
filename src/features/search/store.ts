import { shallowRef } from 'vue'
import { describe, followerOfTab, openInActivePane, problem } from '@/documents/store'
import { dirtyBuffers } from '@/features/links/rewrite'
import { workspaceRoots } from '@/features/tree/store'
import {
  getHost,
  type SearchBatch,
  type SearchHit,
  type SearchRequest,
  type SearchSummary,
} from '@/platform'
import { focusActiveEditor, holdingEditorFocus } from '@/workbench/focus'
import { seedQueryFromEditor } from '@/workbench/find'
import { showSidebar } from '@/workbench/sidebar'

/**
 * Search in folders (Ctrl+Shift+F). The search is Rust's: it reads every text file in the open
 * folders and the text of open documents with unsaved edits, and streams hits back. This keeps the
 * query, the options and the list for the panel, and opens a hit at its match.
 */

/** The query and what to match; they stay when the panel is hidden. */
export interface SearchOptions {
  readonly query: string
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
  readonly regexp: boolean
}

export const searchOptions = shallowRef<SearchOptions>({
  query: '',
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
})

/** A row of the list: a file's name, or one match in it. */
export type SearchRow =
  | { readonly kind: 'file'; readonly path: string; count: number }
  | { readonly kind: 'hit'; readonly hit: SearchHit; readonly index: number }

/** Where a search is. */
export type SearchPhase = 'idle' | 'searching' | 'done' | 'failed'

export interface SearchState {
  readonly phase: SearchPhase
  /** Text files read so far, or in the end. */
  readonly scanned: number
  /** How a finished search ended; null while it runs or when it failed to start. */
  readonly summary: SearchSummary | null
  /** The words for why a search could not run. */
  readonly message: string | null
}

const IDLE: SearchState = { phase: 'idle', scanned: 0, summary: null, message: null }

export const searchState = shallowRef<SearchState>(IDLE)

/**
 * The list, file rows and hit rows in the order Rust found them. One array grows in place, so ten
 * thousand hits are never copied once per batch. `rowsVersion` changes whenever it does; a
 * computed that reads the list through the functions below must read `rowsVersion` too, because
 * the array itself is the same object every time and Vue cannot see it change.
 */
const rowList: SearchRow[] = []
/** The row each hit is on, by the hit's number. */
const hitRows: number[] = []
export const rowsVersion = shallowRef(0)

/** How many rows the list has. */
export function rowCount(): number {
  return rowList.length
}

/** The rows from `start` up to `end`. */
export function rowSlice(start: number, end: number): SearchRow[] {
  return rowList.slice(start, end)
}

/** The row hit `index` is on, or -1. */
export function rowOfHit(index: number): number {
  return hitRows[index] ?? -1
}

/** The hits alone, in list order, for the arrow keys. */
const hitList: SearchHit[] = []
let currentFile: (SearchRow & { kind: 'file' }) | null = null

/** The number of the selected hit, from 0, or -1. */
export const selectedHit = shallowRef(-1)

/** Numbers the searches, so a slow one that was replaced cannot overwrite the newer answer. */
let latest = 0

function clearRows(): void {
  rowList.length = 0
  hitList.length = 0
  hitRows.length = 0
  currentFile = null
  selectedHit.value = -1
  rowsVersion.value += 1
}

function addHits(batch: SearchBatch): void {
  for (const hit of batch.hits) {
    if (currentFile?.path !== hit.path) {
      currentFile = { kind: 'file', path: hit.path, count: 0 }
      rowList.push(currentFile)
    }
    currentFile.count += 1
    hitRows.push(rowList.length)
    rowList.push({ kind: 'hit', hit, index: hitList.length })
    hitList.push(hit)
  }
  if (batch.hits.length > 0) rowsVersion.value += 1
}

/** Changes the query or an option. A change of option runs the search again when one was made. */
export function setSearchOptions(patch: Partial<SearchOptions>): void {
  searchOptions.value = { ...searchOptions.value, ...patch }
  const optionChanged =
    patch.caseSensitive !== undefined || patch.wholeWord !== undefined || patch.regexp !== undefined
  if (optionChanged && searchState.value.phase !== 'idle') void runSearch()
}

/**
 * Searches the open folders for the query. Starting a search stops the one running; an empty
 * query clears the list instead.
 */
export async function runSearch(): Promise<void> {
  const mine = ++latest
  const options = searchOptions.value
  clearRows()
  if (options.query === '') {
    searchState.value = IDLE
    await cancelRunning()
    return
  }
  if (workspaceRoots.value.length === 0) {
    searchState.value = {
      phase: 'failed',
      scanned: 0,
      summary: null,
      message: 'Open a folder to search its files.',
    }
    return
  }
  searchState.value = { phase: 'searching', scanned: 0, summary: null, message: null }
  const request: SearchRequest = { id: mine, ...options }
  try {
    const host = await getHost()
    const summary = await host.searchFolders(request, dirtyBuffers(), (batch) => {
      if (batch.id !== latest) return
      addHits(batch)
      searchState.value = { ...searchState.value, scanned: batch.scanned }
    })
    if (mine !== latest) return
    searchState.value = {
      phase: summary.error === null ? 'done' : 'failed',
      scanned: summary.scanned,
      summary,
      message: summary.error,
    }
  } catch (error) {
    if (mine === latest) {
      searchState.value = { phase: 'failed', scanned: 0, summary: null, message: describe(error) }
    }
  }
}

async function cancelRunning(): Promise<void> {
  try {
    await (await getHost()).searchCancel()
  } catch {
    // Nothing to stop, or a host that cannot; the next search names itself anyway.
  }
}

/** Stops a running search. What was found so far stays in the list, and the summary says so. */
export async function cancelSearch(): Promise<void> {
  if (searchState.value.phase !== 'searching') return
  await cancelRunning()
}

/** Forgets the query and the list. */
export function clearSearch(): void {
  latest += 1
  clearRows()
  searchState.value = IDLE
  searchOptions.value = { ...searchOptions.value, query: '' }
  void cancelRunning()
}

// ---- focus ----

/** Counts the requests to put the caret in the query box. */
export const searchFocusRequest = shallowRef(0)
let focusTaken = 0

/** True once for each request made since the last call, so a box drawn later hears one made before. */
export function takeSearchFocusRequest(): boolean {
  if (searchFocusRequest.value === focusTaken) return false
  focusTaken = searchFocusRequest.value
  return true
}

/**
 * Shows the Search panel with the caret in the query box. The selected line of the active editor
 * becomes the query, as Find does; the search runs when Enter is pressed.
 */
export function showSearch(): void {
  const options = searchOptions.value
  const seeded = seedQueryFromEditor(options.query, options.regexp)
  if (seeded !== options.query) searchOptions.value = { ...options, query: seeded }
  showSidebar('search')
  searchFocusRequest.value += 1
}

// ---- opening a hit ----

/** Puts the caret on the match in its file. */
async function reveal(hit: SearchHit): Promise<void> {
  const tab = await openInActivePane(hit.path)
  const follower = followerOfTab(tab)
  if (follower === undefined) return
  const doc = follower.state.doc
  const line = doc.line(Math.min(Math.max(hit.line, 1), doc.lines))
  follower.reveal(line.from + Math.min(hit.column, line.length))
}

/** One open at a time, so two quick clicks show their files in order. */
let opening: Promise<void> = Promise.resolve()

/**
 * Shows a hit in the active pane. By default focus stays in the list, as it does in the tree;
 * `focusEditor` is for Enter and a double click, which mean "take me there".
 */
export function openHit(hit: SearchHit, how: { focusEditor?: boolean } = {}): Promise<void> {
  problem.value = null
  opening = opening.then(async () => {
    try {
      if (how.focusEditor === true) {
        await reveal(hit)
        focusActiveEditor()
      } else {
        await holdingEditorFocus(() => reveal(hit))
      }
    } catch (error) {
      problem.value = `Could not open ${hit.path}: ${describe(error)}`
    }
  })
  return opening
}

/** The hit a row stands for, or undefined for a file row. */
export function hitAt(index: number): SearchHit | undefined {
  return hitList[index]
}

/** How many hits the list holds. */
export function hitTotal(): number {
  return hitList.length
}

/** Puts the module back as it starts. For tests. */
export function resetSearch(): void {
  latest += 1
  clearRows()
  searchState.value = IDLE
  searchOptions.value = { query: '', caseSensitive: false, wholeWord: false, regexp: false }
  searchFocusRequest.value = 0
  focusTaken = 0
  opening = Promise.resolve()
}
