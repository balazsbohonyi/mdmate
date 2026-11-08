// @vitest-environment jsdom
/**
 * Drag-to-move (P5-T7). The pure part first: where the pointer lands, and Where the pointer lands, and
 * what a drop does to the text, the selection and the undo history. The pointer plumbing needs real
 * layout and real input, so `pnpm perf drag-auto` and `pnpm perf lab-drag` cover it in WebView2.
 */
import { history, undo } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Document } from '@/documents/document'
import { createState } from '@/editor/create'
import { blocksOf } from '@/editor/livePreview/blocks'
import { uniformEndings } from '@/lib/endings'
import { moveSelectedText, onDrawnBlock, pointerOnRange } from '@/editor/textDrag'

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

describe('drag-to-move in the app (P5-T7)', () => {
  const views: EditorView[] = []
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy()
    vi.restoreAllMocks()
  })

  /**
   * jsdom has no layout, so the view's geometry is stubbed: positions map to x pixels on one line,
   * 10 px a character, inside a 1000 x 500 box.
   */
  function stubGeometry(view: EditorView): void {
    const box = { left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, x: 0, y: 0 }
    view.scrollDOM.getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect
    view.posAtCoords = ((coords: { x: number }) =>
      Math.max(0, Math.min(view.state.doc.length, Math.round(coords.x / 10)))) as never
    view.posAndSideAtCoords = ((coords: { x: number }) => ({
      pos: Math.floor(coords.x / 10),
      assoc: 1,
    })) as never
    view.coordsAtPos = (() => null) as never
  }

  function drag(view: EditorView, fromX: number, toX: number): void {
    view.contentDOM.dispatchEvent(
      new MouseEvent('mousedown', {
        button: 0,
        detail: 1,
        clientX: fromX,
        clientY: 5,
        bubbles: true,
        cancelable: true,
      }),
    )
    for (const x of [fromX + 20, toX]) {
      window.dispatchEvent(
        Object.assign(
          new MouseEvent('pointermove', { clientX: x, clientY: 5, buttons: 1, bubbles: true }),
          {},
        ),
      )
    }
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: toX, clientY: 5, bubbles: true }))
  }

  function mounted(doc: Document, tab: string): EditorView {
    const parent = document.createElement('div')
    document.body.append(parent)
    const follower = doc.followerFor(tab)
    const view = new EditorView({ state: follower.state, parent })
    follower.show(view)
    stubGeometry(view)
    views.push(view)
    return view
  }

  function opened(text: string): Document {
    return new Document(
      {
        id: 7,
        path: 'C:/n/a.md',
        name: 'a.md',
        encoding: 'utf-8',
        bom: false,
        readOnly: null,
        size: text.length,
        hash: '0'.repeat(32),
        text,
        endings: uniformEndings(),
      },
      () => undefined,
    )
  }

  it('a pointer drag in a tab of a document moves the selected text, selection following (ISC-177)', () => {
    const doc = opened('abc DEF ghi jkl')
    const view = mounted(doc, 'tab-1')
    view.dispatch({ selection: EditorSelection.single(4, 7) })
    // Press on "E" (x 50), drop after "ghi " (position 12, x 120).
    drag(view, 50, 120)
    expect(doc.master.doc.toString()).toBe('abc  ghi DEFjkl')
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      'DEF',
    )
  })

  it('one undo through the document puts the text back (ISC-178)', () => {
    const doc = opened('abc DEF ghi jkl')
    const view = mounted(doc, 'tab-1')
    view.dispatch({ selection: EditorSelection.single(4, 7) })
    drag(view, 50, 120)
    const follower = doc.followerFor('tab-1')
    expect(doc.undo(follower)).toBe(true)
    expect(doc.master.doc.toString()).toBe('abc DEF ghi jkl')
  })

  it('is in every follower and standalone state the app makes', () => {
    const doc = opened('abc DEF ghi')
    const view = mounted(doc, 'tab-1')
    view.dispatch({ selection: EditorSelection.single(4, 7) })
    drag(view, 50, 110)
    expect(view.state.doc.toString()).not.toBe('abc DEF ghi')
    const parent = document.createElement('div')
    document.body.append(parent)
    const plain = new EditorView({
      state: createState('abc DEF ghi', [], { parser: false }),
      parent,
    })
    views.push(plain)
    stubGeometry(plain)
    plain.dispatch({ selection: EditorSelection.single(4, 7) })
    drag(plain, 50, 110)
    expect(plain.state.doc.toString()).toBe('abc  ghiDEF')
  })

  it('a drag released on a drawn table moves nothing', () => {
    const text = 'Move me.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nEnd.'
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({ state: createState(text, [], { preview: true }), parent })
    views.push(view)
    stubGeometry(view)
    view.dispatch({ selection: EditorSelection.single(0, 4) })
    expect(blocksOf(view.state).map((block) => block.kind)).toContain('table')
    // Release on the table's first position (x = 10 px a character).
    drag(view, 20, text.indexOf('| a') * 10)
    expect(view.state.doc.toString()).toBe(text)
    // The same drag released on plain text after the table does move it.
    drag(view, 20, text.indexOf('End.') * 10)
    expect(view.state.doc.toString()).not.toBe(text)
  })

  it('a drawn table is never a drop target', () => {
    const text = 'Move me.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nEnd.'
    const state = createState(text, [], { preview: true }).update({
      selection: EditorSelection.single(0, 4),
    }).state
    const tableFrom = text.indexOf('| a')
    expect(blocksOf(state).map((block) => block.kind)).toContain('table')
    expect(onDrawnBlock(state, tableFrom)).toBe(true)
    expect(onDrawnBlock(state, text.indexOf('End.'))).toBe(false)
    expect(onDrawnBlock(state, 2)).toBe(false)
  })
})
