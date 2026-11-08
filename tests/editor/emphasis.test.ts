/**
 * ISC-51.1, ISC-51.2, ISC-51.3: bold, italic and strikethrough render with their markers hidden
 * away from the caret. Read as data from `scanPreview` on plain states.
 */
import { describe, expect, it } from 'vitest'
import { hidden, markedText, rendered, scanAll, stateOf } from '../helpers/preview'

/** A document with `text` at the start and a long tail, caret in the tail. */
function away(text: string, tail = '\n\nend of the document') {
  const doc = text + tail
  return stateOf(doc, doc.length)
}

describe('bold', () => {
  it('hides the markers of ** and __ when the caret is elsewhere', () => {
    for (const marks of ['**', '__']) {
      const state = away(`a ${marks}bold${marks} b`)
      const items = scanAll(state)
      expect(hidden(items), marks).toEqual([
        [2, 4],
        [8, 10],
      ])
      expect(rendered(state, items).startsWith('a bold b')).toBe(true)
      expect(markedText(state, items), marks).toEqual([`cm-md-strong: ${marks}bold${marks}`])
    }
  })

  it('shows the markers with the caret anywhere in the span, edges included', () => {
    const doc = 'a **bold** b'
    for (const caret of [2, 3, 4, 6, 8, 9, 10]) {
      expect(hidden(scanAll(stateOf(doc, caret))), `caret at ${String(caret)}`).toEqual([])
    }
    expect(hidden(scanAll(stateOf(doc, 1)))).toEqual([
      [2, 4],
      [8, 10],
    ])
    expect(hidden(scanAll(stateOf(doc, 11)))).toEqual([
      [2, 4],
      [8, 10],
    ])
  })

  it('reveals only the span the caret is in', () => {
    const doc = '**one** and **two**'
    const state = stateOf(doc, 15)
    expect(hidden(scanAll(state))).toEqual([
      [0, 2],
      [5, 7],
    ])
  })

  it('reveals every span a selection reaches', () => {
    const doc = '**one** and **two**'
    expect(hidden(scanAll(stateOf(doc, [3, 15])))).toEqual([])
  })

  it('leaves unclosed and escaped markers alone', () => {
    expect(scanAll(away('**not closed'))).toEqual([])
    expect(scanAll(away('\\*\\*escaped\\*\\*'))).toEqual([])
    expect(scanAll(away('2 * 3 * 4'))).toEqual([])
  })

  it('does not style markers inside inline code', () => {
    const state = away('`**x**`')
    expect(markedText(state, scanAll(state))).toEqual(['cm-md-code: `**x**`'])
  })

  it('never hides across a line break, even when the span runs over two lines', () => {
    const state = away('**one\ntwo**')
    const items = scanAll(state)
    expect(hidden(items)).toEqual([
      [0, 2],
      [9, 11],
    ])
    for (const [from, to] of hidden(items)) {
      expect(state.doc.sliceString(from, to)).not.toContain('\n')
    }
  })
})

describe('italic', () => {
  it('hides the markers of * and _', () => {
    for (const mark of ['*', '_']) {
      const state = away(`a ${mark}slanted${mark} b`)
      const items = scanAll(state)
      expect(hidden(items), mark).toEqual([
        [2, 3],
        [10, 11],
      ])
      expect(markedText(state, items), mark).toEqual([`cm-md-em: ${mark}slanted${mark}`])
    }
  })

  it('shows the markers with the caret in the span', () => {
    expect(hidden(scanAll(stateOf('a *it* b', 5)))).toEqual([])
  })

  it('does not treat a snake_case_word as italic', () => {
    expect(scanAll(away('a snake_case_word here'))).toEqual([])
  })
})

describe('bold and italic together', () => {
  it('hides all six markers of ***both***', () => {
    const state = away('***both***')
    const items = scanAll(state)
    expect(hidden(items)).toHaveLength(4)
    expect(rendered(state, items).startsWith('both\n')).toBe(true)
    expect(markedText(state, items).sort()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^cm-md-(strong|em): /)]),
    )
  })

  it('reveals the outer span while the caret is in a nested one', () => {
    const doc = '**bold *nested* bold** end'
    const state = stateOf(doc, 11)
    expect(hidden(scanAll(state))).toEqual([])
  })

  it('hides a nested span the caret is not in, inside a revealed outer one', () => {
    const doc = '**bold *nested* bold** end'
    const state = stateOf(doc, 3)
    expect(hidden(scanAll(state))).toEqual([
      [7, 8],
      [14, 15],
    ])
  })
})

describe('strikethrough', () => {
  it('hides the tildes', () => {
    const state = away('a ~~gone~~ b')
    const items = scanAll(state)
    expect(hidden(items)).toEqual([
      [2, 4],
      [8, 10],
    ])
    expect(markedText(state, items)).toEqual(['cm-md-strike: ~~gone~~'])
  })

  it('shows the tildes with the caret in the span', () => {
    expect(hidden(scanAll(stateOf('a ~~gone~~ b', 6)))).toEqual([])
  })

  it('leaves a single tilde alone', () => {
    expect(scanAll(away('about ~5 minutes'))).toEqual([])
  })
})

describe('emphasis inside a heading', () => {
  it('keeps the hashes shown and hides the markers while the caret is elsewhere on the line', () => {
    const doc = '# plain and **bold**'
    const state = stateOf(doc, 4)
    expect(hidden(scanAll(state))).toEqual([
      [12, 14],
      [18, 20],
    ])
  })

  it('hides both when the caret is on another line', () => {
    const doc = '# plain and **bold**\ntext'
    const state = stateOf(doc, doc.length)
    expect(hidden(scanAll(state))).toEqual([
      [0, 2],
      [12, 14],
      [18, 20],
    ])
  })
})
