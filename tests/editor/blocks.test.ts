// @vitest-environment jsdom
/**
 * The block layer as a whole (ISC-183 and the plan's StateField rules): it maps through edits,
 * rescans only what changed, extends as the parser advances, and never leaves a selection inside
 * something it hides. The per-block checks (tables, images, ...) are in their own files.
 */
import { ensureSyntaxTree, forceParsing, syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { createState, createFollowerState, createView } from '@/editor/create'
import { blockScans, blocksOf } from '@/editor/livePreview/blocks'
import { markdownSupport } from '@/editor/markdownSupport'
import { previewEffect, previewSlot } from '@/editor/previewMode'
import { blockStateOf, drawn } from '../helpers/blocks'

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

const TABLE_A = '| a | b |\n|---|:-:|\n| 1 | 2 |'
const TABLE_B = '| x |\n|---|\n| y |\n| z |'
const DOC = `intro\n\n${TABLE_A}\n\nmiddle text\n\n${TABLE_B}\n${TABLE_A}\n\nend\n`

/** A small deterministic generator, so a failing seed can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('a selection never sits inside what the layer hides (ISC-183)', () => {
  it('holds for a caret at every offset', () => {
    for (let pos = 0; pos <= DOC.length; pos++) {
      const state = blockStateOf(DOC, pos)
      for (const block of blocksOf(state)) {
        expect(pos < block.from || pos > block.to, `caret ${String(pos)} in ${block.kind}`).toBe(
          true,
        )
      }
    }
  })

  it('holds for ranges, whichever way they run and however many there are', () => {
    const next = rng(7)
    for (let i = 0; i < 400; i++) {
      const anchor = Math.floor(next() * (DOC.length + 1))
      const head = Math.floor(next() * (DOC.length + 1))
      const state = blockStateOf(DOC, [anchor, head])
      const from = Math.min(anchor, head)
      const to = Math.max(anchor, head)
      for (const block of blocksOf(state)) {
        expect(block.from > to || block.to < from, `range ${String(anchor)}-${String(head)}`).toBe(
          true,
        )
      }
    }
  })

  it('holds the moment a transaction moves the selection, with no frame in between', () => {
    let state = blockStateOf(DOC, 0)
    const next = rng(11)
    for (let i = 0; i < 300; i++) {
      const pos = Math.floor(next() * (DOC.length + 1))
      state = state.update({ selection: { anchor: pos } }).state
      for (const block of blocksOf(state)) {
        expect(pos < block.from || pos > block.to).toBe(true)
      }
    }
  })
})

describe('the field follows the document', () => {
  it('equals a fresh scan after every one of many random edits', () => {
    const alphabet = ['|', '-', ' ', 'a', '\n', ':', '\n\n', '| a |', '|---|']
    for (const seed of [1, 2, 3, 4, 5]) {
      const next = rng(seed)
      let state = blockStateOf(DOC, 0)
      for (let step = 0; step < 120; step++) {
        const len = state.doc.length
        const from = Math.floor(next() * (len + 1))
        const to = Math.min(len, from + Math.floor(next() * 4))
        const insert = next() < 0.3 ? '' : (alphabet[Math.floor(next() * alphabet.length)] ?? '')
        const caret = Math.floor(next() * (len - (to - from) + insert.length + 1))
        state = state.update({
          changes: { from, to, insert },
          selection: { anchor: Math.min(caret, len - (to - from) + insert.length) },
        }).state
        const fresh = blockStateOf(state.doc.toString(), state.selection.main.head)
        expect(drawn(state), `seed ${String(seed)} step ${String(step)}`).toEqual(drawn(fresh))
      }
    }
  })

  it('shifts a block with an edit before it, without drawing it again', () => {
    const state = blockStateOf(DOC, 0)
    const before = blocksOf(state)
    const next = state.update({ changes: { from: 0, insert: 'XYZ' } }).state
    const after = blocksOf(next)
    expect(after.map((block) => block.from)).toEqual(before.map((block) => block.from + 3))
    expect(after.map((block) => block.widget)).toEqual(before.map((block) => block.widget))
  })

  it('rescans only the lines around an edit, not the document', () => {
    const many = Array.from({ length: 300 }, (_, i) => `para ${String(i)}\n\n${TABLE_A}\n`).join(
      '\n',
    )
    const state = blockStateOf(many, 0)
    const at = many.indexOf('para 150') + 3
    const typed = state.update({
      changes: { from: at, insert: 'q' },
      selection: { anchor: at + 1 },
    })
    const scanned = blockScans(typed.state).reduce((sum, span) => sum + span.to - span.from, 0)
    expect(scanned).toBeLessThan(120)
    expect(blocksOf(typed.state)).toHaveLength(300)
  })

  it('draws a table again, whole, when one of its cells changes', () => {
    const state = blockStateOf(DOC, 0)
    const at = DOC.indexOf('| 1 | 2 |') + 2
    const typed = state.update({ changes: { from: at, insert: 'q' }, selection: { anchor: 0 } })
    const tableFrom = DOC.indexOf(TABLE_A)
    const table = blocksOf(typed.state).find((block) => block.from === tableFrom)
    expect(table?.to).toBe(tableFrom + TABLE_A.length + 1)
    expect((table?.widget as unknown as { source: string }).source).toContain('| q1 | 2 |')
    expect(
      blockScans(typed.state).reduce((sum, span) => sum + span.to - span.from, 0),
    ).toBeLessThan(TABLE_A.length + 40)
  })

  it('rescans only the two blocks the caret leaves and enters', () => {
    const many = Array.from({ length: 300 }, (_, i) => `para ${String(i)}\n\n${TABLE_A}\n`).join(
      '\n',
    )
    const first = many.indexOf(TABLE_A) + 3
    const state = blockStateOf(many, first)
    const last = many.lastIndexOf(TABLE_A) + 3
    const moved = state.update({ selection: { anchor: last } })
    const scanned = blockScans(moved.state).reduce((sum, span) => sum + span.to - span.from, 0)
    expect(scanned).toBeLessThan(TABLE_A.length * 2 + 80)
    expect(blocksOf(moved.state)).toHaveLength(299)
  })

  it('does nothing for a transaction that touches neither text nor selection', () => {
    const state = blockStateOf(DOC, 0)
    const same = state.update({ scrollIntoView: true }).state
    expect(blockScans(same)).toEqual([])
    expect(drawn(same)).toEqual(drawn(state))
  })
})

describe('a vertical step never jumps over a block', () => {
  // CodeMirror moves the caret from the blank line above a block to the line below it, because the
  // widget has no text line to land on. The layer sends that step into the block instead.
  const TABLE_LINE_START = DOC.indexOf(TABLE_A)
  const TABLE_END = TABLE_LINE_START + TABLE_A.length
  const BLANK_ABOVE = TABLE_LINE_START - 1
  const BLANK_BELOW = TABLE_END + 1
  const select = { userEvent: 'select' } as const

  it('sends a step down onto the first line of the block, which shows its source', () => {
    const state = blockStateOf(DOC, BLANK_ABOVE)
    expect(drawn(state)).toContain(`table ${String(TABLE_LINE_START)}-${String(TABLE_END)}`)
    const stepped = state.update({ selection: { anchor: BLANK_BELOW }, ...select }).state
    expect(stepped.selection.main.head).toBe(TABLE_LINE_START)
    expect(drawn(stepped)).not.toContain(`table ${String(TABLE_LINE_START)}-${String(TABLE_END)}`)
  })

  it('sends a step up onto the last line of the block', () => {
    const state = blockStateOf(DOC, BLANK_BELOW)
    const stepped = state.update({ selection: { anchor: BLANK_ABOVE }, ...select }).state
    expect(stepped.selection.main.head).toBe(TABLE_END)
  })

  it('leaves a click, a jump and a search alone', () => {
    const state = blockStateOf(DOC, BLANK_ABOVE)
    for (const userEvent of ['select.pointer', 'select.search', 'input.type']) {
      const next = state.update({ selection: { anchor: BLANK_BELOW }, userEvent }).state
      expect(next.selection.main.head, userEvent).toBe(BLANK_BELOW)
    }
    const jump = state.update({ selection: { anchor: DOC.length }, ...select }).state
    expect(jump.selection.main.head).toBe(DOC.length)
  })

  it('leaves a step alone when no block is drawn between, or while one is shown as source', () => {
    const inside = blockStateOf(DOC, TABLE_LINE_START + 3)
    const down = inside.update({ selection: { anchor: BLANK_BELOW }, ...select }).state
    expect(down.selection.main.head).toBe(BLANK_BELOW)
    const plain = blockStateOf(DOC, 0)
    const next = plain.update({ selection: { anchor: 6 }, ...select }).state
    expect(next.selection.main.head).toBe(6)
  })

  it('does not apply to a selection range or to several carets', () => {
    const state = blockStateOf(DOC, [BLANK_ABOVE, BLANK_ABOVE])
    const ranged = state.update({
      selection: { anchor: BLANK_ABOVE, head: BLANK_BELOW },
      ...select,
    })
    expect(ranged.state.selection.main.head).toBe(BLANK_BELOW)
  })
})

describe('the field extends as the parser advances', () => {
  it('draws the blocks below the first parse once the parser gets there', () => {
    const doc = Array.from({ length: 6000 }, (_, i) => `row ${String(i)}\n\n${TABLE_A}\n`).join(
      '\n',
    )
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = createView(parent, createState(doc, [], { preview: true }))
    views.push(view)
    const parsed = syntaxTree(view.state).length
    expect(parsed, 'the document must be larger than one parse slice').toBeLessThan(doc.length)
    const first = blocksOf(view.state).length
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(6000)
    expect(forceParsing(view, doc.length, 30_000)).toBe(true)
    expect(blocksOf(view.state)).toHaveLength(6000)
  })
})

describe('where the layer lives', () => {
  it('is absent from a state that did not ask for preview', () => {
    const state = EditorState.create({ doc: DOC, extensions: [markdownSupport()] })
    expect(blocksOf(state)).toEqual([])
  })

  it('leaves with the preview when a pane switches to raw Markdown', () => {
    const state = createFollowerState({ doc: EditorState.create({ doc: DOC }).doc, extensions: [] })
    // Followers start in preview; the compartment is what the pane toggles.
    expect(blocksOf(state).length).toBeGreaterThan(0)
    const effect = previewEffect(state, false)
    expect(effect).not.toBeNull()
    const raw = state.update({ effects: effect ?? [] }).state
    expect(blocksOf(raw)).toEqual([])
    expect(previewSlot()).toBeDefined()
  })

  it('draws nothing in plain source', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = createView(parent, createState(DOC, [], { parser: false, preview: true }))
    views.push(view)
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    expect(view.contentDOM.textContent).toContain('| a | b |')
  })
})

describe('what an edit leaves drawn is what a fresh scan draws', () => {
  // Found by the owner after P9-T1: paste a picture, move the caret away, undo. The text was gone
  // and the picture stayed, because the widget's range shrank to a point on the edge of the rescan.
  it('draws no picture once an undo has removed its source and the caret is elsewhere', () => {
    const doc = 'after\n![](assets/a.png)'
    const state = blockStateOf(doc, 0)
    expect(drawn(state)).toEqual([`image 6-${String(doc.length)}`])
    const undone = state.update({ changes: { from: 5, to: doc.length } }).state
    expect(drawn(undone)).toEqual([])
  })

  it('draws no picture when its source is deleted, wherever it sat', () => {
    for (const doc of [
      '![](a.png)',
      '![](a.png)\n\nnext',
      'before\n\n![](a.png)',
      'before\n\n![](a.png)\n\nnext',
      'before\n![](a.png)\n![](b.png)\nnext',
    ]) {
      for (const caret of [0, doc.length]) {
        const state = blockStateOf(doc, caret)
        const at = doc.indexOf('![](a.png)')
        const removed = state.update({ changes: { from: at, to: at + '![](a.png)'.length } }).state
        const fresh = blockStateOf(removed.doc.toString(), Math.min(caret, removed.doc.length))
        expect(drawn(removed), JSON.stringify({ doc, caret })).toEqual(drawn(fresh))
      }
    }
  })

  it('holds for random edits of a document of pictures', () => {
    // Pictures only; the next test adds tables.
    const base = 'top\n![](a.png)\n\n![](b.png)\nmid\n![](c.png)\n\nend\n![](e.png)'
    const next = rng(11)
    for (let round = 0; round < 300; round++) {
      let state = blockStateOf(base, 0)
      for (let step = 0; step < 4; step++) {
        const length = state.doc.length
        const from = Math.floor(next() * (length + 1))
        const to = Math.min(length, from + Math.floor(next() * 30))
        const pieces = ['\n', 'x', '![](d.png)', '\n\n']
        const insert = next() < 0.4 ? (pieces[Math.floor(next() * 4)] ?? '') : ''
        const caret = Math.floor(next() * (length - (to - from) + insert.length + 1))
        state = state.update({
          changes: { from, to, insert },
          selection: { anchor: Math.min(caret, length - (to - from) + insert.length) },
        }).state
        // The parser has caught up with the edit, as it does in the page.
        ensureSyntaxTree(state, state.doc.length, 5000)
        state = state.update({}).state
        const fresh = blockStateOf(state.doc.toString(), state.selection.main.head)
        expect(
          drawn(state),
          JSON.stringify({
            round,
            step,
            head: state.selection.main.head,
            doc: state.doc.toString(),
          }),
        ).toEqual(drawn(fresh))
      }
    }
  })

  it('holds for random edits of a document of tables and pictures, with the caret in a table', () => {
    // A table that a selection touches is not drawn, and one that an edit makes swallow the lines
    // after it, or let them go, must leave those lines drawn the way a fresh scan draws them.
    const base =
      'top\n\n| a | b |\n|---|---|\n| 1 | 2 |\n![](a.png)\n\n![](b.png)\n| x |\n|---|\n| y |\n\nmid\n![](c.png)\n\n| p |\n|---|\n![](e.png)'
    const pieces = ['\n', '\n\n', '|', '| a |', '|---|', '![](d.png)', 'x', '| 1 | 2 |\n']
    for (const seed of [11, 3]) {
      const next = rng(seed)
      for (let round = 0; round < 800; round++) {
        // Start with the caret inside a table, as an edit there is the case this is about.
        const inside = base.indexOf('| 1 | 2 |') + 2 + Math.floor(next() * 3) * 6
        let state = blockStateOf(base, inside)
        for (let step = 0; step < 5; step++) {
          const length = state.doc.length
          const from = Math.floor(next() * (length + 1))
          const to = Math.min(length, from + Math.floor(next() * 12))
          const insert = next() < 0.6 ? (pieces[Math.floor(next() * pieces.length)] ?? '') : ''
          const caretNear = next() < 0.5
          const size = length - (to - from) + insert.length
          const caret = caretNear
            ? Math.min(size, from + insert.length)
            : Math.floor(next() * (size + 1))
          state = state.update({
            changes: { from, to, insert },
            selection: { anchor: Math.min(caret, size) },
          }).state
          ensureSyntaxTree(state, state.doc.length, 5000)
          state = state.update({}).state
          const fresh = blockStateOf(state.doc.toString(), state.selection.main.head)
          expect(
            drawn(state),
            JSON.stringify({
              round,
              step,
              head: state.selection.main.head,
              doc: state.doc.toString(),
            }),
          ).toEqual(drawn(fresh))
        }
      }
    }
    // 1,600 rounds take about 3 s alone; the default 5 s is too close when the suite runs in parallel.
  }, 30_000)
})
