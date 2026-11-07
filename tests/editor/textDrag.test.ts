/**
 * P5-T7 spike: the part of drag-to-move that does not need a screen. Where the pointer lands, and
 * what a drop does to the text, the selection and the undo history. The pointer plumbing needs real
 * layout and real input, so `pnpm perf drag-auto` and `pnpm perf lab-drag` cover it in WebView2.
 */
import { history, undo } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { moveSelectedText, pointerOnRange } from '@/editor/textDrag'

function stateWith(doc: string, from: number, to: number, readOnly = false): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: from, head: to },
    extensions: [history(), EditorState.readOnly.of(readOnly)],
  })
}

/** Applies the move and returns the new state, or null when the drop does nothing. */
function drop(state: EditorState, at: number): EditorState | null {
  const spec = moveSelectedText(state, at)
  return spec ? state.update(spec).state : null
}

describe('pointerOnRange', () => {
  // Selection is the characters at positions 4, 5 and 6: "DEF" in "abc DEF ghi".
  it('counts the left half of a selected character, not the one before it', () => {
    expect(pointerOnRange(4, 7, 4, 1)).toBe(true)
    expect(pointerOnRange(4, 7, 4, -1)).toBe(false)
  })

  it('counts the right half of the last selected character, not the one after it', () => {
    expect(pointerOnRange(4, 7, 7, -1)).toBe(true)
    expect(pointerOnRange(4, 7, 7, 1)).toBe(false)
  })

  it('counts everything between the edges, from either side', () => {
    for (const pos of [5, 6]) {
      expect(pointerOnRange(4, 7, pos, 1)).toBe(true)
      expect(pointerOnRange(4, 7, pos, -1)).toBe(true)
    }
  })

  it('ignores positions outside the selection', () => {
    for (const assoc of [-1, 1] as const) {
      expect(pointerOnRange(4, 7, 0, assoc)).toBe(false)
      expect(pointerOnRange(4, 7, 11, assoc)).toBe(false)
    }
  })
})

describe('moveSelectedText', () => {
  const DOC = 'abc DEF ghi'

  it('moves the text forward and selects it where it lands', () => {
    const next = drop(stateWith(DOC, 4, 7), 11)
    expect(next?.doc.toString()).toBe('abc  ghiDEF')
    expect(next?.selection.main.from).toBe(8)
    expect(next?.selection.main.to).toBe(11)
  })

  it('moves the text backward and selects it where it lands', () => {
    const next = drop(stateWith(DOC, 4, 7), 0)
    expect(next?.doc.toString()).toBe('DEFabc  ghi')
    expect(next?.selection.main.from).toBe(0)
    expect(next?.selection.main.to).toBe(3)
  })

  it('does nothing for a drop inside the selection or on its edges', () => {
    for (const at of [4, 5, 6, 7]) expect(moveSelectedText(stateWith(DOC, 4, 7), at)).toBeNull()
  })

  it('does nothing without a non-empty single selection', () => {
    expect(moveSelectedText(stateWith(DOC, 4, 4), 9)).toBeNull()
    const two = EditorState.create({
      doc: DOC,
      selection: EditorSelection.create([
        EditorSelection.range(0, 2),
        EditorSelection.range(8, 10),
      ]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    })
    expect(two.selection.ranges.length).toBe(2)
    expect(moveSelectedText(two, 5)).toBeNull()
  })

  it('does nothing in a read-only editor', () => {
    expect(moveSelectedText(stateWith(DOC, 4, 7, true), 11)).toBeNull()
  })

  it('does nothing for a drop outside the document', () => {
    expect(moveSelectedText(stateWith(DOC, 4, 7), -1)).toBeNull()
    expect(moveSelectedText(stateWith(DOC, 4, 7), DOC.length + 1)).toBeNull()
  })

  it('moves a selection that spans line breaks', () => {
    const doc = 'one\ntwo\nthree\nfour'
    const next = drop(stateWith(doc, 2, 9), doc.length) // "e\ntwo\nt" to the end
    expect(next?.doc.toString()).toBe('onhree\nfoure\ntwo\nt')
    expect(next?.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe('e\ntwo\nt')
  })

  it('is one transaction, so one undo restores text and selection', () => {
    let state = stateWith(DOC, 4, 7)
    // An earlier edit in the history must stay put after the undo.
    state = state.update({ changes: { from: 0, insert: 'X' }, userEvent: 'input.type' }).state
    state = state.update({ selection: { anchor: 5, head: 8 } }).state
    const before = state.doc.toString()
    const moved = drop(state, state.doc.length)
    expect(moved).not.toBeNull()
    let current = moved ?? state
    expect(current.doc.toString()).not.toBe(before)
    undo({
      state: current,
      dispatch: (tr) => {
        current = tr.state
      },
    })
    expect(current.doc.toString()).toBe(before)
    expect(current.selection.main.from).toBe(5)
    expect(current.selection.main.to).toBe(8)
  })

  it('is tagged as a move, so history and other extensions can tell it from typing', () => {
    const spec = moveSelectedText(stateWith(DOC, 4, 7), 11)
    expect(spec?.userEvent).toBe('move.drop')
  })

  it('keeps every character: 400 seeded random moves match plain string arithmetic', () => {
    let seed = 20261107
    const random = (n: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return Math.floor((seed / 4294967296) * n)
    }
    const alphabet = 'abcdef \n'
    for (let i = 0; i < 400; i++) {
      const length = 5 + random(40)
      const doc = Array.from({ length }, () => alphabet[random(alphabet.length)]).join('')
      const a = random(length + 1)
      const b = random(length + 1)
      const from = Math.min(a, b)
      const to = Math.max(a, b)
      const at = random(length + 1)
      const next = drop(stateWith(doc, from, to), at)
      if (from === to || (at >= from && at <= to)) {
        expect(next).toBeNull()
        continue
      }
      const moved = doc.slice(from, to)
      const expected =
        at > to
          ? doc.slice(0, from) + doc.slice(to, at) + moved + doc.slice(at)
          : doc.slice(0, at) + moved + doc.slice(at, from) + doc.slice(to)
      expect(next?.doc.toString()).toBe(expected)
      expect(next?.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe(moved)
    }
  })

  it('is a delete plus an insert, which is what a line-ending field would see (known limit)', () => {
    // The P0 line-endings spike keeps each break's ending in a field that follows every change. A
    // move reaches it as a deletion of the old breaks and an insertion of new ones, so a moved CRLF
    // block would take its new neighbours' endings. Phase 2's real field has to carry endings with
    // moved text; this pins the shape of the change it has to handle.
    const spec = moveSelectedText(stateWith('a\nb\nc', 0, 3), 5)
    expect(spec?.changes).toEqual([
      { from: 0, to: 3 },
      { from: 5, insert: 'a\nb' },
    ])
  })
})
