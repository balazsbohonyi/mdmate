/**
 * ISC-50: headings render without their `#` markers away from the caret. The layer's answer is
 * read as data (`scanPreview`) on plain editor states, and the page-level checks live in
 * tests/editor/livePreviewView.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { scanPreview } from '@/editor/livePreview/scan'
import { hidden, lineClasses, rendered, scanAll, stateOf } from '../helpers/preview'

describe('ATX headings', () => {
  it('hides the hashes and the blank after them when the caret is on another line', () => {
    const state = stateOf('# Title\n\nbody', 12)
    const items = scanAll(state)
    expect(hidden(items)).toEqual([[0, 2]])
    expect(rendered(state, items)).toBe('Title\n\nbody')
    expect(lineClasses(state, items)).toEqual(['1: cm-md-h cm-md-h1'])
  })

  it.each([1, 2, 3, 4, 5, 6])('styles and unmarks a level %i heading', (level) => {
    const marks = '#'.repeat(level)
    const doc = `${marks} Heading\ntext`
    const state = stateOf(doc, doc.length)
    const items = scanAll(state)
    expect(hidden(items)).toEqual([[0, level + 1]])
    expect(lineClasses(state, items)).toEqual([`1: cm-md-h cm-md-h${String(level)}`])
  })

  it('shows the hashes with the caret anywhere on the heading line, edges included', () => {
    for (const caret of [0, 1, 2, 5, 7]) {
      const state = stateOf('# Title\nbody', caret)
      expect(hidden(scanAll(state)), `caret at ${String(caret)}`).toEqual([])
    }
    // Position 8 is the start of the next line.
    expect(hidden(scanAll(stateOf('# Title\nbody', 8)))).toEqual([[0, 2]])
  })

  it('reveals only the heading the caret is on', () => {
    const state = stateOf('# One\n## Two\n### Three', 8)
    expect(hidden(scanAll(state))).toEqual([
      [0, 2],
      [13, 17],
    ])
  })

  it('reveals every heading a selection reaches', () => {
    const state = stateOf('# One\n## Two\n### Three', [3, 15])
    expect(hidden(scanAll(state))).toEqual([])
  })

  it('hides the closing hashes and the blank before them too', () => {
    const state = stateOf('## Title ##\nbody', 14)
    const items = scanAll(state)
    expect(hidden(items)).toEqual([
      [0, 3],
      [8, 11],
    ])
    expect(rendered(state, items)).toBe('Title\nbody')
  })

  it('leaves a bare hash alone, since nothing would be left to show', () => {
    const state = stateOf('#\n## \ntext', 8)
    expect(hidden(scanAll(state))).toEqual([])
  })

  it('does not touch a hash without a blank, which is not a heading', () => {
    const state = stateOf('#hashtag\n\ntext', 12)
    expect(scanAll(state)).toEqual([])
  })

  it('does not style hashes inside fenced code', () => {
    const state = stateOf('```\n# not a heading\n```\n', 0)
    // The block is a code container; nothing in it is a heading.
    const rest = scanAll(state).filter(
      (item) => item.type !== 'line' || !item.class.startsWith('cm-md-box'),
    )
    expect(rest).toEqual([])
  })

  it('handles a heading with a tab after the hashes', () => {
    const state = stateOf('#\tTitle\ntext', 11)
    expect(hidden(scanAll(state))).toEqual([[0, 2]])
  })

  it('never hides across a line break', () => {
    const state = stateOf('# A\n\n## B\n\n### C ###\n\ntext', 25)
    for (const [from, to] of hidden(scanAll(state))) {
      expect(state.doc.sliceString(from, to)).not.toContain('\n')
    }
  })

  it('hides nothing when the document is empty', () => {
    expect(scanAll(stateOf(''))).toEqual([])
  })
})

describe('Setext headings', () => {
  it('styles the text lines and keeps the underline visible, muted', () => {
    const state = stateOf('Title\n=====\n\nbody', 15)
    const items = scanAll(state)
    expect(hidden(items)).toEqual([])
    expect(lineClasses(state, items)).toEqual(['1: cm-md-h cm-md-h1', '2: cm-md-setext-mark'])
  })

  it('uses level two for a dash underline', () => {
    const state = stateOf('Title\n-----\n\nbody', 15)
    expect(lineClasses(state, scanAll(state))).toEqual([
      '1: cm-md-h cm-md-h2',
      '2: cm-md-setext-mark',
    ])
  })
})

describe('scanning a part of the document', () => {
  it('returns only what overlaps the range it is given', () => {
    const doc = '# One\n\nsome text\n\n## Two\n'
    const state = stateOf(doc, 10)
    const items = scanPreview(state, [{ from: 17, to: doc.length }])
    expect(lineClasses(state, items)).toEqual(['5: cm-md-h cm-md-h2'])
  })
})
