import {
  EditorSelection,
  type ChangeDesc,
  type ChangeSet,
  type EditorState,
  type StateEffect,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syncAnnotation, type FollowerLink } from '@/editor/sync'
import type { Endings } from '@/lib/endings'

/** What a follower needs from the document it follows. */
export interface FollowerHost {
  forward(origin: Follower, transactions: readonly Transaction[]): void
  undo(origin: Follower): boolean
  redo(origin: Follower): boolean
  endings(): Endings
}

/**
 * One tab's editor state, kept in step with its document. While a view shows it, the view owns the
 * state and changes from other tabs are dispatched into it. While no view shows it (a tab behind
 * another in its pane, or no view at all, as in tests), changes from elsewhere are only noted, as
 * one composed change set, and applied when the state is next read. That keeps typing in one pane
 * from doing parse work in every parked tab.
 */
export class Follower implements FollowerLink {
  readonly id: string
  #state: EditorState
  #pending: ChangeSet | null = null
  #view: EditorView | null = null
  readonly #host: FollowerHost
  /**
   * Where this tab was scrolled to when it last left the screen, as the effect CodeMirror gives for
   * it. It names a place in the text, not a number of pixels, so it still means the same place when
   * the text above it changed meanwhile. Null until the tab has been shown and left once.
   */
  #scroll: StateEffect<unknown> | null = null

  constructor(id: string, host: FollowerHost, makeState: (link: FollowerLink) => EditorState) {
    this.id = id
    this.#host = host
    this.#state = makeState(this)
  }

  /** The follower's state as it is now, with any changes made elsewhere applied. */
  get state(): EditorState {
    if (this.#view !== null) return this.#view.state
    if (this.#pending !== null) {
      this.#scroll = this.#scroll?.map(this.#pending) ?? null
      this.#state = this.#state.update({
        changes: this.#pending,
        annotations: syncAnnotation.of(true),
      }).state
      this.#pending = null
    }
    return this.#state
  }

  /** True while a view shows this state. */
  get shown(): boolean {
    return this.#view !== null
  }

  /** Puts this state in `view`, which must not be showing another follower. */
  show(view: EditorView): void {
    const state = this.state
    this.#view = null
    view.setState(state)
    this.#view = view
    if (this.#revealOnShow !== null) {
      const pos = Math.min(this.#revealOnShow, view.state.doc.length)
      this.#revealOnShow = null
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start' }) })
      return
    }
    // The pane's one view keeps its scroll offset across `setState`, so without this a tab opens
    // wherever the tab before it was scrolled to. A tab shown before goes back to where it was; a
    // new one starts at its caret, which is the top for a new file.
    view.dispatch({
      effects:
        this.#scroll ?? EditorView.scrollIntoView(state.selection.main.head, { y: 'center' }),
    })
  }

  /** A position to scroll to the top of the view when this state is next shown. */
  #revealOnShow: number | null = null

  /**
   * Puts the caret at `pos` and scrolls it to the top of the view. A follower no view shows keeps
   * the scroll for when it is shown, so a jump into a tab that is about to open still lands.
   */
  reveal(pos: number): void {
    const at = Math.max(0, Math.min(pos, this.state.doc.length))
    const selection = EditorSelection.cursor(at)
    if (this.#view !== null) {
      this.#view.dispatch({ selection, effects: EditorView.scrollIntoView(at, { y: 'start' }) })
      return
    }
    this.dispatch({ selection })
    this.#revealOnShow = at
  }

  /** Takes the state back from its view, which is about to show something else. */
  park(): void {
    if (this.#view === null) return
    this.#scroll = this.#view.scrollSnapshot()
    this.#state = this.#view.state
    this.#view = null
  }

  /** A change the user (or a test) makes here. Goes through the view when one shows this state. */
  dispatch(spec: TransactionSpec): void {
    if (this.#view !== null) {
      this.#view.dispatch(spec)
      return
    }
    const tr = this.state.update(spec)
    this.#mapScroll(tr.changes)
    this.#state = tr.state
    this.#host.forward(this, [tr])
  }

  /** Applies a change the document made, from another follower or from undo and redo. */
  receive(changes: ChangeSet, selection?: EditorSelection): void {
    if (this.#view !== null) {
      this.#view.dispatch({
        changes,
        selection,
        scrollIntoView: selection !== undefined,
        annotations: syncAnnotation.of(true),
      })
    } else if (selection !== undefined) {
      this.#mapScroll(changes)
      this.#state = this.state.update({
        changes,
        selection,
        annotations: syncAnnotation.of(true),
      }).state
    } else {
      this.#pending = this.#pending === null ? changes : this.#pending.compose(changes)
    }
  }

  /** Keeps the remembered scroll on the same text when a change lands above or inside it. */
  #mapScroll(changes: ChangeDesc): void {
    this.#scroll = this.#scroll?.map(changes) ?? null
  }

  /** Applies a setting change the document made, such as the file turning read-only. */
  reconfigure(effect: StateEffect<unknown>): void {
    const annotations = syncAnnotation.of(true)
    if (this.#view !== null) {
      this.#view.dispatch({ effects: effect, annotations })
    } else {
      this.#state = this.state.update({ effects: effect, annotations }).state
    }
  }

  forward(transactions: readonly Transaction[]): void {
    this.#host.forward(this, transactions)
  }

  undo(): boolean {
    return this.#host.undo(this)
  }

  redo(): boolean {
    return this.#host.redo(this)
  }

  endings(): Endings {
    return this.#host.endings()
  }
}
