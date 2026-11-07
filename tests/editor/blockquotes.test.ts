/** ISC-55: blockquotes render styled, with the `>` hidden away from the caret. */
import { describe, expect, it } from 'vitest'
import { hidden, lineClasses, rendered, scanAll, stateOf } from '../helpers/preview'

const doc = '> quote\n> > nested\n> more\n\nafter'

describe('blockquotes', () => {
  it('styles every line of the quote exactly once, nested lines included', () => {
    const state = stateOf(doc)
    expect(lineClasses(state, scanAll(state))).toEqual([
      '1: cm-md-quote',
      '2: cm-md-quote',
      '3: cm-md-quote',
    ])
  })

  it('styles a lazy continuation line, which has no marker', () => {
    const state = stateOf('> quote\ncontinued\n\nafter')
    expect(lineClasses(state, scanAll(state))).toEqual(['1: cm-md-quote', '2: cm-md-quote'])
  })

  it('hides the markers and the blank after each away from the caret', () => {
    const state = stateOf(doc)
    expect(rendered(state, scanAll(state))).toBe('quote\nnested\nmore\n\nafter')
  })

  it('shows the markers of the caret line only', () => {
    const state = stateOf(doc, doc.indexOf('nested') + 2)
    expect(rendered(state, scanAll(state))).toBe('quote\n> > nested\nmore\n\nafter')
  })

  it('shows the markers with the caret at either end of the line', () => {
    const start = stateOf(doc, 8)
    const end = stateOf(doc, 18)
    for (const state of [start, end]) {
      expect(rendered(state, scanAll(state))).toBe('quote\n> > nested\nmore\n\nafter')
    }
  })

  it('leaves a marker with nothing after it, so the line keeps something to land on', () => {
    const state = stateOf('> a\n>\n> b\n\nafter')
    expect(rendered(state, scanAll(state))).toBe('a\n>\nb\n\nafter')
  })

  it('does not style a `>` in the middle of a paragraph', () => {
    const state = stateOf('a > b\n\nend')
    expect(lineClasses(state, scanAll(state))).toEqual([])
    expect(hidden(scanAll(state))).toEqual([])
  })

  it('never hides across a line break', () => {
    const state = stateOf(doc)
    for (const [from, to] of hidden(scanAll(state))) {
      expect(state.doc.sliceString(from, to)).not.toContain('\n')
    }
  })
})
