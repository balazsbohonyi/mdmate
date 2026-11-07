import { invertedEffects } from '@codemirror/commands'
import {
  StateEffect,
  StateField,
  type ChangeSet,
  type EditorState,
  type Extension,
  type Text,
} from '@codemirror/state'
import { uniformEndings, type EndingCode, type Endings } from '@/lib/endings'

/**
 * Line endings that survive editing. CodeMirror text uses `\n` only; this field keeps the ending
 * each line break had on disk and follows every edit, so saving can put the original endings
 * back. Only breaks that differ from the dominant ending are stored.
 *
 * - An edit touches only the breaks inside the range it replaces. Breaks it adds take the ending of
 *   the line they came from, and breaks after it keep theirs, shifted to their new index.
 * - Undo puts back the endings of the breaks an edit removed (`restoreBreaks`, through
 *   `invertedEffects`), and redo does the same for what undo removed.
 * - Moving text (one deletion and one insertion of the same text, which is what a drag makes)
 *   carries the endings of the breaks inside the text with it. The undo of a move is the same
 *   shape, so it needs no stored endings.
 */

/** Replaces all the endings, for when a file is opened or reloaded. */
export const setEndings = StateEffect.define<Endings>()

/**
 * The endings of `codes.length` breaks starting at break `first`, to be put back by an undo or a
 * redo. Indices, not positions, in the document the effect lands in, so nothing has to map them.
 */
interface BreakRun {
  readonly first: number
  readonly codes: readonly EndingCode[]
}
const restoreBreaks = StateEffect.define<BreakRun>()

/** The index of the first entry of `at` that is at least `value`. */
function lowerBound(at: readonly number[], value: number): number {
  let low = 0
  let high = at.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((at[middle] ?? 0) < value) low = middle + 1
    else high = middle
  }
  return low
}

/** The ending of break `index`, or undefined when the document has no such break. */
function endingOf(value: Endings, index: number, breaks: number): EndingCode | undefined {
  if (index < 0 || index >= breaks) return undefined
  const found = lowerBound(value.at, index)
  return value.at[found] === index ? (value.codes[found] ?? value.dominant) : value.dominant
}

/** The endings of `count` breaks starting at break `first`. */
function endingsFrom(value: Endings, first: number, count: number): EndingCode[] {
  const out: EndingCode[] = Array.from({ length: count }, () => value.dominant)
  for (let i = lowerBound(value.at, first); i < value.at.length; i++) {
    const at = value.at[i] ?? 0
    if (at >= first + count) break
    out[at - first] = value.codes[i] ?? value.dominant
  }
  return out
}

/** Replaces the `removed` breaks from `first` with `codes`, moving the breaks after them. */
function splice(
  value: Endings,
  first: number,
  removed: number,
  codes: readonly EndingCode[],
): Endings {
  if (removed === 0 && codes.length === 0) return value
  const from = lowerBound(value.at, first)
  const to = lowerBound(value.at, first + removed)
  const shift = codes.length - removed
  const at = value.at.slice(0, from)
  const kept = value.codes.slice(0, from)
  codes.forEach((code, i) => {
    if (code === value.dominant) return
    at.push(first + i)
    kept.push(code)
  })
  for (let i = to; i < value.at.length; i++) {
    at.push((value.at[i] ?? 0) + shift)
    kept.push(value.codes[i] ?? value.dominant)
  }
  return { dominant: value.dominant, at, codes: kept }
}

/** Where a change starts and how many line breaks it replaces, in the document it applies to. */
function breaksOf(doc: Text, from: number, to: number): { first: number; count: number } {
  const startLine = doc.lineAt(from).number
  return { first: startLine - 1, count: doc.lineAt(to).number - startLine }
}

interface Move {
  /** The text that leaves, `from` to `to`. */
  readonly from: number
  readonly to: number
  /** Where it lands, in the document before the move. Never inside `from` to `to`. */
  readonly at: number
}

/**
 * The move a change set makes, or null when it is anything else: exactly one deletion and one
 * insertion, of the same text. That is the shape `moveSelectedText` makes for a drag, and the shape
 * the undo of it has, and moving text is the same thing whoever does it.
 *
 * The cost of going by shape: two cursors, one deleting `\n\n` while the other types `\n\n`, count
 * as a move too. Only the endings of the breaks typed there differ (they come from the deleted
 * ones instead of the line); no other line's ending is touched.
 */
function moveOf(before: Text, changes: ChangeSet): Move | null {
  const parts: { from: number; to: number; inserted: Text }[] = []
  changes.iterChanges((from, to, _fromB, _toB, inserted) => void parts.push({ from, to, inserted }))
  const [a, b] = parts
  if (parts.length !== 2 || a === undefined || b === undefined) return null
  const deletion = a.inserted.length === 0 ? a : b
  const insertion = deletion === a ? b : a
  if (deletion.to === deletion.from || deletion.inserted.length !== 0) return null
  if (insertion.to !== insertion.from) return null
  if (insertion.inserted.length !== deletion.to - deletion.from) return null
  if (insertion.inserted.toString() !== before.sliceString(deletion.from, deletion.to)) return null
  return { from: deletion.from, to: deletion.to, at: insertion.from }
}

/** The breaks inside the moved text leave with it and arrive where it lands. */
function followMove(value: Endings, before: Text, move: Move): Endings {
  const { first, count } = breaksOf(before, move.from, move.to)
  if (count === 0) return value // no break in the text, so no ending moves
  const block = endingsFrom(value, first, count)
  const rest = splice(value, first, count, [])
  // The line the text lands in, counted in the document without it.
  const landing = before.lineAt(move.at).number - 1 - (move.at > move.to ? count : 0)
  return splice(rest, landing, 0, block)
}

/** Follows one transaction's changes. Returns `value` itself when no break was touched or moved. */
function follow(value: Endings, before: Text, changes: ChangeSet): Endings {
  const move = moveOf(before, changes)
  if (move !== null) return followMove(value, before, move)

  const total = before.lines - 1
  const edits: { first: number; removed: number; added: number }[] = []
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const { first, count } = breaksOf(before, from, to)
    edits.push({ first, removed: count, added: inserted.lines - 1 })
  })

  // From the last edit to the first, so the indices of earlier edits stay valid.
  let next = value
  for (const { first, removed, added } of edits.reverse()) {
    // New breaks take the ending of the line they came from: the break that ends the edited line,
    // or the one before it when the edit is on the last line.
    const inherited =
      endingOf(value, first, total) ?? endingOf(value, first - 1, total) ?? value.dominant
    next = splice(
      next,
      first,
      removed,
      Array.from({ length: added }, () => inherited),
    )
  }
  return next
}

/** Holds the ending of every line break. */
export const lineEndings: StateField<Endings> = StateField.define<Endings>({
  create: () => uniformEndings(),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEndings)) return effect.value
    }
    let next = tr.docChanged ? follow(value, tr.startState.doc, tr.changes) : value
    for (const effect of tr.effects) {
      if (effect.is(restoreBreaks)) {
        next = splice(next, effect.value.first, effect.value.codes.length, effect.value.codes)
      }
    }
    return next
  },
  provide: () =>
    invertedEffects.of((tr) => {
      if (!tr.docChanged) return []
      const before = tr.startState.doc
      // The undo of a move is a move, which follows the text and needs nothing stored.
      if (moveOf(before, tr.changes) !== null) return []
      const value = tr.startState.field(lineEndings)
      const runs: StateEffect<BreakRun>[] = []
      tr.changes.iterChanges((from, to) => {
        const { first, count } = breaksOf(before, from, to)
        if (count > 0)
          runs.push(restoreBreaks.of({ first, codes: endingsFrom(value, first, count) }))
      })
      return runs
    }),
})

/** A state that already knows its file's endings. */
export function lineEndingsFor(endings: Endings): Extension {
  return lineEndings.init(() => endings)
}

/** The ending of every line break in this state. */
export function endingsOf(state: EditorState): Endings {
  return state.field(lineEndings)
}
