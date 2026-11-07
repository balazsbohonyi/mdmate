import { isolateHistory } from '@codemirror/commands'
import { Annotation, Prec, Transaction, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

/**
 * What a view needs to stay in step with its document. One document has a headless master state
 * (text, undo history, line endings) and one follower state per tab. A follower sends what its
 * user does to the master, and undo and redo run against the master, so history belongs to the
 * document and not to any pane.
 */
export interface FollowerLink {
  /** The transactions the user made in this follower, in order. Never the ones the sync made. */
  forward(transactions: readonly Transaction[]): void
  /** Undo the document's last edit. False when there is nothing to undo. */
  undo(): boolean
  /** Redo the document's last undone edit. False when there is nothing to redo. */
  redo(): boolean
}

/** Marks a transaction that applies a change another view already made, so it is not sent back. */
export const syncAnnotation = Annotation.define<true>()

/** Keys for undo and redo, the same ones CodeMirror's own history keymap uses. */
const historyKeys = (link: FollowerLink) =>
  keymap.of([
    { key: 'Mod-z', run: () => link.undo(), preventDefault: true },
    { key: 'Mod-y', mac: 'Mod-Shift-z', run: () => link.redo(), preventDefault: true },
    { linux: 'Ctrl-Shift-z', run: () => link.redo(), preventDefault: true },
  ])

/** Makes a follower state send its user's edits to the document and route undo and redo to it. */
export function followerSync(link: FollowerLink): Extension {
  return [
    EditorView.updateListener.of((update) => {
      const own = update.transactions.filter((tr) => !tr.annotation(syncAnnotation))
      if (own.length > 0) link.forward(own)
    }),
    Prec.high(historyKeys(link)),
  ]
}

/**
 * The annotations of a follower's transaction that the master's history reads: what kind of edit
 * it was (history groups typing by it), when, whether it counts for undo, and whether it ends a
 * group. Carried over so the master groups edits the way a view with its own history would.
 */
export function carriedAnnotations(tr: Transaction): Annotation<unknown>[] {
  const carried: Annotation<unknown>[] = [Transaction.time.of(tr.annotation(Transaction.time) ?? 0)]
  const userEvent = tr.annotation(Transaction.userEvent)
  if (userEvent !== undefined) carried.push(Transaction.userEvent.of(userEvent))
  const addToHistory = tr.annotation(Transaction.addToHistory)
  if (addToHistory !== undefined) carried.push(Transaction.addToHistory.of(addToHistory))
  const isolate = tr.annotation(isolateHistory)
  if (isolate !== undefined) carried.push(isolateHistory.of(isolate))
  return carried
}
