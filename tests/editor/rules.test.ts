/** ISC-56: horizontal rules render as a line, with their text shown on the caret line. */
import { describe, expect, it } from 'vitest'
import { hidden, lineClasses, rendered, scanAll, stateOf } from '../helpers/preview'

describe('horizontal rules', () => {
  const doc = 'top\n\n---\n\nmiddle\n\n***\n\n___\n\n- - -\n\nend'

  it('gives every rule the rule line style and hides its text', () => {
    const state = stateOf(doc)
    const items = scanAll(state)
    expect(lineClasses(state, items)).toEqual([
      '11: cm-md-hr',
      '3: cm-md-hr',
      '7: cm-md-hr',
      '9: cm-md-hr',
    ])
    expect(rendered(state, items)).toBe('top\n\n\n\nmiddle\n\n\n\n\n\n\n\nend')
  })

  it('shows the text of the rule the caret is on, and only that one', () => {
    const state = stateOf(doc, doc.indexOf('***') + 1)
    expect(rendered(state, scanAll(state))).toBe('top\n\n\n\nmiddle\n\n***\n\n\n\n\n\nend')
  })

  it('shows the text with the caret at either end of the rule line', () => {
    for (const caret of [5, 8]) {
      const state = stateOf('top\n\n---\n\nend', caret)
      expect(hidden(scanAll(state)), `caret at ${String(caret)}`).toEqual([])
    }
  })

  it('does not treat a setext underline as a rule', () => {
    const state = stateOf('Title\n---\n\nend')
    expect(lineClasses(state, scanAll(state)).some((c) => c.endsWith('cm-md-hr'))).toBe(false)
  })

  it('does not treat dashes in text as a rule', () => {
    const state = stateOf('a --- b\n\nend')
    expect(lineClasses(state, scanAll(state))).toEqual([])
  })
})
