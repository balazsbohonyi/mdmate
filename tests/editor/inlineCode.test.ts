/** ISC-52: inline code renders with its backticks hidden away from the caret. */
import { EditorSelection } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { selectedParts } from '@/editor/livePreview/scan'
import { hidden, markedText, rendered, scanAll, stateOf } from '../helpers/preview'

function away(text: string) {
  const doc = `${text}\n\nend of the document`
  return stateOf(doc, doc.length)
}

describe('inline code', () => {
  it('hides the backticks and styles the span', () => {
    const state = away('use `pnpm dev` now')
    const items = scanAll(state)
    expect(hidden(items)).toEqual([
      [4, 5],
      [13, 14],
    ])
    expect(markedText(state, items)).toEqual(['cm-md-code: `pnpm dev`'])
    expect(rendered(state, items).startsWith('use pnpm dev now')).toBe(true)
  })

  it('shows the backticks with the caret in the span, edges included', () => {
    const doc = 'use `x` now'
    for (const caret of [4, 5, 6, 7]) {
      expect(hidden(scanAll(stateOf(doc, caret))), `caret at ${String(caret)}`).toEqual([])
    }
    expect(hidden(scanAll(stateOf(doc, 3)))).toEqual([
      [4, 5],
      [6, 7],
    ])
  })

  it('hides longer fences and keeps a backtick that belongs to the code', () => {
    const state = away('a ``tick ` inside`` b')
    const items = scanAll(state)
    expect(hidden(items)).toEqual([
      [2, 4],
      [17, 19],
    ])
    expect(rendered(state, items).startsWith('a tick ` inside b')).toBe(true)
  })

  it('reveals only the span the caret is in', () => {
    const doc = '`one` and `two`'
    expect(hidden(scanAll(stateOf(doc, 12)))).toEqual([
      [0, 1],
      [4, 5],
    ])
  })

  it('leaves an unclosed backtick alone', () => {
    expect(scanAll(away('a lone ` tick'))).toEqual([])
  })

  it('does not style a fenced code block as inline code', () => {
    const state = stateOf('```\ncode\n```\n', 0)
    expect(markedText(state, scanAll(state))).toEqual([])
  })
})

/**
 * Selected inline code (ISC-506): the span's background would hide the selection drawn behind the
 * text, so the part a selection covers is cut out of the span and drawn without it.
 */
describe('inline code under a selection', () => {
  // The span is the backticks and what is between them: 4 to 14.
  const DOC = 'use `pnpm dev` now\n\nend of the document'
  const marks = (selection: number | [number, number]): string[] => {
    const state = stateOf(DOC, selection)
    return markedText(state, scanAll(state))
  }
  const PLAIN = ['cm-md-code: `pnpm dev`']

  it('draws the whole span selected when the selection covers it', () => {
    expect(marks([4, 14])).toEqual(['cm-md-code cm-md-code-selected: `pnpm dev`'])
    expect(marks([0, 20])).toEqual(['cm-md-code cm-md-code-selected: `pnpm dev`'])
  })

  it('cuts out only the part a selection covers: inside, or from before into the span', () => {
    expect(marks([6, 10])).toEqual([
      'cm-md-code: `p',
      'cm-md-code cm-md-code-selected: npm ',
      'cm-md-code: dev`',
    ])
    expect(marks([0, 8])).toEqual(['cm-md-code cm-md-code-selected: `pnp', 'cm-md-code: m dev`'])
    expect(marks([10, 20])).toEqual(['cm-md-code: `pnpm ', 'cm-md-code cm-md-code-selected: dev`'])
  })

  it('leaves the span alone for a caret in it, or a selection that does not reach it', () => {
    for (const caret of [4, 8, 14]) expect(marks(caret), `caret at ${String(caret)}`).toEqual(PLAIN)
    expect(marks([0, 4])).toEqual(PLAIN)
    expect(marks([14, 20])).toEqual(PLAIN)
    expect(marks([15, 19])).toEqual(PLAIN)
  })

  it('still shows the backticks of a span the selection touches', () => {
    const state = stateOf(DOC, [4, 14])
    expect(hidden(scanAll(state))).toEqual([])
  })

  it('joins overlapping ranges and clips them to the span', () => {
    const ranges = [
      EditorSelection.range(0, 7),
      EditorSelection.range(6, 9),
      EditorSelection.range(12, 30),
    ]
    expect(selectedParts(ranges, 4, 14)).toEqual([
      [4, 9],
      [12, 14],
    ])
    expect(selectedParts([EditorSelection.cursor(8)], 4, 14)).toEqual([])
    expect(selectedParts([EditorSelection.range(14, 20)], 4, 14)).toEqual([])
  })
})
