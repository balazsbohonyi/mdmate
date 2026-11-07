import {
  StateEffect,
  StateField,
  type ChangeSet,
  type EditorState,
  type Extension,
} from '@codemirror/state'
import { uniformEndings, type EndingCode, type Endings } from '@/lib/endings'

/**
 * Line endings that survive editing. CodeMirror text uses `\n` only; this field keeps the ending
 * each line break had on disk and follows every edit, so saving can put the original endings
 * back. Only breaks that differ from the dominant ending are stored.
 *
 * An edit touches only the breaks inside the range it replaces. Breaks it adds take the ending of
 * the line they came from, and breaks after it keep theirs, shifted to their new index.
 */

/** Replaces all the endings, for when a file is opened or reloaded. */
export const setEndings = StateEffect.define<Endings>()

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

interface Edit {
  /** The index of the first break the edit replaces. */
  readonly first: number
  readonly removed: number
  readonly added: number
}

/** Follows one transaction's changes. Returns `value` itself when no break was touched or moved. */
function follow(value: Endings, startState: EditorState, changes: ChangeSet): Endings {
  const before = startState.doc
  const breaks = before.lines - 1
  const edits: Edit[] = []
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const startLine = before.lineAt(fromA).number
    edits.push({
      first: startLine - 1,
      removed: before.lineAt(toA).number - startLine,
      added: inserted.lines - 1,
    })
  })
  if (edits.every((edit) => edit.removed === 0 && edit.added === 0)) return value

  const at = value.at.slice()
  const codes = value.codes.slice()
  // From the last edit to the first, so the indices of earlier edits stay valid.
  for (const edit of edits.reverse()) {
    const from = lowerBound(at, edit.first)
    const to = lowerBound(at, edit.first + edit.removed)
    const shift = edit.added - edit.removed
    if (shift !== 0) for (let i = to; i < at.length; i++) at[i] = (at[i] ?? 0) + shift

    if (edit.added > 0) {
      // New breaks take the ending of the line they came from: the break that ends the edited
      // line, or the one before it when the edit is on the last line.
      const inherited =
        endingOf(value, edit.first, breaks) ??
        endingOf(value, edit.first - 1, breaks) ??
        value.dominant
      if (inherited !== value.dominant) {
        const fresh = Array.from({ length: edit.added }, (_, i) => edit.first + i)
        codes.splice(from, to - from, ...fresh.map(() => inherited))
        at.splice(from, to - from, ...fresh)
        continue
      }
    }
    codes.splice(from, to - from)
    at.splice(from, to - from)
  }
  return { dominant: value.dominant, at, codes }
}

/** Holds the ending of every line break. */
export const lineEndings = StateField.define<Endings>({
  create: () => uniformEndings(),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEndings)) return effect.value
    }
    return tr.docChanged ? follow(value, tr.startState, tr.changes) : value
  },
})

/** A state that already knows its file's endings. */
export function lineEndingsFor(endings: Endings): Extension {
  return lineEndings.init(() => endings)
}

/** The ending of every line break in this state. */
export function endingsOf(state: EditorState): Endings {
  return state.field(lineEndings)
}
