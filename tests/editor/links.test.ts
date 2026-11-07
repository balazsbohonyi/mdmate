/** ISC-53: links render as their text, with the brackets and the target hidden. */
import { describe, expect, it } from 'vitest'
import { hidden, markedText, rendered, scanAll, stateOf } from '../helpers/preview'

function away(text: string) {
  const doc = `${text}\n\nend of the document`
  return stateOf(doc, doc.length)
}

describe('inline links', () => {
  it('hides the bracket and the whole target, and styles the span', () => {
    const state = away('a [text](http://x.com "t") b')
    const items = scanAll(state)
    expect(hidden(items)).toEqual([
      [2, 3],
      [7, 26],
    ])
    expect(markedText(state, items)).toEqual(['cm-md-link: [text](http://x.com "t")'])
    expect(rendered(state, items).startsWith('a text b')).toBe(true)
  })

  it('shows all of it with the caret in the link, edges included', () => {
    const doc = 'a [text](http://x.com) b'
    for (const caret of [2, 3, 8, 15, 22]) {
      expect(hidden(scanAll(stateOf(doc, caret))), `caret at ${String(caret)}`).toEqual([])
    }
    for (const caret of [0, 1, 23, 24]) {
      expect(hidden(scanAll(stateOf(doc, caret))), `caret at ${String(caret)}`).not.toEqual([])
    }
  })

  it('reveals only the link the caret is in', () => {
    const doc = 'one [a](http://a.com) two [b](http://b.com) end'
    const state = stateOf(doc, doc.indexOf('[b]') + 1)
    expect(rendered(state, scanAll(state))).toBe('one a two [b](http://b.com) end')
  })

  it('leaves a link with no text alone, since hiding it would leave nothing to see', () => {
    const state = away('a [](http://x.com) b')
    expect(hidden(scanAll(state))).toEqual([])
  })

  it('styles emphasis inside the link text', () => {
    const state = away('see [**bold** text](http://x.com) now')
    const items = scanAll(state)
    expect(rendered(state, items).startsWith('see bold text now')).toBe(true)
    expect(markedText(state, items)).toContain('cm-md-strong: **bold**')
  })

  it('never hides across a line break', () => {
    const state = away('a [text](http://x.com "long\ntitle") b')
    const items = scanAll(state)
    expect(hidden(items).length).toBeGreaterThan(0)
    for (const [from, to] of hidden(items)) {
      expect(state.doc.sliceString(from, to)).not.toContain('\n')
    }
  })
})

describe('reference links', () => {
  const doc = 'a [text][ref] and [short] b\n\n[ref]: http://y.com\n\nend of the document'

  it('hides the brackets and the label, and leaves the definition alone', () => {
    const state = stateOf(doc, doc.length)
    const items = scanAll(state)
    expect(rendered(state, items)).toBe(
      'a text and short b\n\n[ref]: http://y.com\n\nend of the document',
    )
  })

  it('shows the syntax with the caret in the link', () => {
    const state = stateOf(doc, 5)
    expect(rendered(state, scanAll(state)).startsWith('a [text][ref] and short b')).toBe(true)
  })
})

describe('autolinks and bare URLs', () => {
  it('hides the angle brackets of an autolink and styles the address', () => {
    const state = away('a <http://auto.com> b')
    const items = scanAll(state)
    expect(hidden(items)).toEqual([
      [2, 3],
      [18, 19],
    ])
    expect(markedText(state, items)).toContain('cm-md-link: http://auto.com')
  })

  it('styles a bare URL and hides nothing', () => {
    const state = away('see http://bare.com now')
    const items = scanAll(state)
    expect(hidden(items)).toEqual([])
    expect(markedText(state, items)).toEqual(['cm-md-link: http://bare.com'])
  })
})

describe('images', () => {
  it('are left alone until the images task', () => {
    const state = away('a ![alt](img.png) b')
    const items = scanAll(state)
    expect(hidden(items)).toEqual([])
    expect(markedText(state, items)).toEqual([])
  })
})
