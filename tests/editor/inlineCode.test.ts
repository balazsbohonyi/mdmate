/** ISC-52: inline code renders with its backticks hidden away from the caret. */
import { describe, expect, it } from 'vitest'
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
