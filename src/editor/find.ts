import {
  SearchQuery,
  findNext as cmFindNext,
  findPrevious as cmFindPrevious,
  getSearchQuery,
  replaceAll as cmReplaceAll,
  replaceNext as cmReplaceNext,
  search,
  setSearchQuery,
} from '@codemirror/search'
import {
  RangeSetBuilder,
  type EditorState,
  type Extension,
  type StateEffect,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type Command,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

/**
 * Find and replace in one file (P7-T1). CodeMirror's search does the matching, the stepping and
 * the replacing; the panel is not CodeMirror's. It is a bar the pane draws (`FindBar.vue`), because
 * a panel in the editor's own DOM cannot hold the app's components and would be closed by every
 * `setState`, which is what a tab switch does. So the query is set on the state with an effect,
 * the matches are marked here, and the commands below refuse to run without a usable query,
 * since CodeMirror would answer by opening its own panel.
 */

/** What the bar holds: the query, what to put in its place, and the three switches. */
export interface FindSpec {
  readonly search: string
  readonly replace: string
  readonly caseSensitive: boolean
  readonly regexp: boolean
  readonly wholeWord: boolean
}

export const EMPTY_FIND: FindSpec = {
  search: '',
  replace: '',
  caseSensitive: false,
  regexp: false,
  wholeWord: false,
}

/**
 * The query CodeMirror searches with. Plain text is literal, so a backslash in it is a backslash;
 * a pattern reads `\n` and `\t` in the replacement, and `$1`, as other editors do.
 */
export function queryOf(spec: FindSpec): SearchQuery {
  return new SearchQuery({
    search: spec.search,
    replace: spec.replace,
    caseSensitive: spec.caseSensitive,
    regexp: spec.regexp,
    wholeWord: spec.wholeWord,
    literal: !spec.regexp,
  })
}

/** True when the query can match something: it is not empty and, as a pattern, it compiles. */
export function isValidFind(spec: FindSpec): boolean {
  return queryOf(spec).valid
}

/** Why a pattern cannot be used, or null when it can (or is not a pattern). */
export function regexpProblem(spec: FindSpec): string | null {
  if (!spec.regexp || spec.search === '') return null
  try {
    new RegExp(spec.search)
    return null
  } catch {
    return 'This is not a valid regular expression.'
  }
}

/** Sets the query on a state, or an empty one to clear it. */
export function findEffect(spec: FindSpec): StateEffect<SearchQuery> {
  return setSearchQuery.of(queryOf(spec))
}

/** Runs a search command only when there is a query to run it with. */
function withQuery(command: Command): Command {
  return (view) => getSearchQuery(view.state).valid && command(view)
}

/** Selects the next match after the selection, wrapping round at the end. */
export const findNext: Command = withQuery(cmFindNext)
/** Selects the previous match before the selection, wrapping round at the start. */
export const findPrevious: Command = withQuery(cmFindPrevious)
/** Replaces the match at the selection and selects the next one. Off in a read-only document. */
export const replaceOne: Command = withQuery(cmReplaceNext)
/** Replaces every match, as one change. Off in a read-only document. */
export const replaceEvery: Command = withQuery(cmReplaceAll)

const SEED_MAX = 200
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The spec to open the bar with: a selected piece of one line becomes the query, as in other
 * editors. A caret, a selection over several lines or a very long one keeps the old query.
 */
export function seedFromSelection(state: EditorState, spec: FindSpec): FindSpec {
  const { from, to } = state.selection.main
  if (from === to || to - from > SEED_MAX) return spec
  const picked = state.sliceDoc(from, to)
  if (picked.includes('\n')) return spec
  return { ...spec, search: spec.regexp ? escapeRegExp(picked) : picked }
}

/** How many matches there are, and which one is selected. */
export interface FindCount {
  readonly total: number
  /** Number of the match the selection is exactly on, from 1; 0 when it is on none. */
  readonly current: number
  /** The count stopped early, so `total` is a floor. */
  readonly capped: boolean
}

const COUNT_CAP = 10_000
const COUNT_BUDGET_MS = 20
/** The count looks at the text in pieces this long, so it can stop between them. */
const COUNT_CHUNK = 128 * 1024

/**
 * Counts the matches of the state's query in the whole document. It stops at `cap` matches or when
 * `budgetMs` has run out, so a common letter and a rare word in a 10 MB file both cost a bounded
 * time: the clock is read every 128 matches and after every piece of about 128 KB (a rare
 * word has no matches to count by). A match over the join of two pieces is missed, which can only
 * happen to a pattern that spans lines, and only in a document that is longer than one piece.
 */
export function countMatches(
  state: EditorState,
  options: { readonly cap?: number; readonly budgetMs?: number } = {},
): FindCount {
  const query = getSearchQuery(state)
  if (!query.valid) return { total: 0, current: 0, capped: false }
  const cap = options.cap ?? COUNT_CAP
  const budget = options.budgetMs ?? COUNT_BUDGET_MS
  const { from: selFrom, to: selTo } = state.selection.main
  const started = performance.now()
  let total = 0
  let current = 0
  const doc = state.doc
  for (let pos = 0; pos < doc.length;) {
    const end = doc.lineAt(Math.min(pos + COUNT_CHUNK, doc.length)).to
    const cursor = query.getCursor(state, pos, end)
    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      const { from, to } = step.value
      if (from === to) continue
      total += 1
      if (from === selFrom && to === selTo) current = total
      if (total >= cap) return { total, current, capped: true }
      if ((total & 127) === 0 && performance.now() - started > budget) {
        return { total, current, capped: true }
      }
    }
    pos = end
    if (pos < doc.length && performance.now() - started > budget) {
      return { total, current, capped: true }
    }
  }
  return { total, current, capped: false }
}

const matchMark = Decoration.mark({ class: 'cm-md-find' })
const currentMark = Decoration.mark({ class: 'cm-md-find cm-md-find-active' })

/** Most marks drawn at once, so a one-letter query in a long file stays cheap. */
const MAX_MARKS = 1500

function markMatches(view: EditorView): DecorationSet {
  const query = getSearchQuery(view.state)
  if (!query.valid) return Decoration.none
  const { from: selFrom, to: selTo } = view.state.selection.main
  const builder = new RangeSetBuilder<Decoration>()
  let drawn = 0
  let end = -1
  for (const range of view.visibleRanges) {
    const cursor = query.getCursor(view.state, range.from, range.to)
    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      const { from, to } = step.value
      if (from === to || from < end) continue
      builder.add(from, to, from === selFrom && to === selTo ? currentMark : matchMark)
      end = to
      drawn += 1
      if (drawn >= MAX_MARKS) return builder.finish()
    }
  }
  return builder.finish()
}

function queryChanged(update: ViewUpdate): boolean {
  return !getSearchQuery(update.startState).eq(getSearchQuery(update.state))
}

/** Marks the matches in the viewport, and the one the selection is on. */
const matchMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = markMatches(view)
    }
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        queryChanged(update)
      ) {
        this.decorations = markMatches(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** The event a view sends up the page with its match count; the pane's bar listens for it. */
export const FIND_COUNT_EVENT = 'mdmate:find-count'

/**
 * Counts in the background and tells the page. A change of query or selection is counted at once
 * (on the next turn of the event loop, never inside the dispatch); an edit waits for typing to
 * pause. A view with no query does nothing, so the count costs a document without a search
 * nothing.
 */
const countReporter = ViewPlugin.fromClass(
  class {
    #timer: ReturnType<typeof setTimeout> | undefined
    readonly #view: EditorView
    constructor(view: EditorView) {
      this.#view = view
      if (getSearchQuery(view.state).valid) this.#schedule(0)
    }
    update(update: ViewUpdate): void {
      if (!getSearchQuery(update.state).valid && !getSearchQuery(update.startState).valid) return
      if (update.docChanged) this.#schedule(250)
      else if (update.selectionSet || queryChanged(update)) this.#schedule(0)
    }
    destroy(): void {
      clearTimeout(this.#timer)
    }
    #schedule(delay: number): void {
      clearTimeout(this.#timer)
      this.#timer = setTimeout(() => {
        const view = this.#view
        if (!view.dom.isConnected) return
        view.dom.dispatchEvent(
          new CustomEvent<FindCount>(FIND_COUNT_EVENT, {
            bubbles: true,
            detail: countMatches(view.state),
          }),
        )
      }, delay)
    }
  },
)

const findTheme = EditorView.baseTheme({
  '.cm-md-find': { backgroundColor: 'var(--find-match)', borderRadius: '2px' },
  '.cm-md-find-active': { backgroundColor: 'var(--find-match-active)' },
})

/** What every editor state gets to be searchable: the search state, the marks and the count. */
export function findSupport(): Extension {
  return [search(), matchMarks, countReporter, findTheme]
}
