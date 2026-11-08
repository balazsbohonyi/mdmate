/** ISC-54: list markers render styled, and stay in the text. */
import { describe, expect, it } from 'vitest'
import { hidden, markedText, scanAll, stateOf } from '../helpers/preview'

describe('lists', () => {
  it('styles bullet and number markers and hides nothing', () => {
    const doc = '- one\n* two\n+ three\n\n1. first\n2) second\n\nend'
    const state = stateOf(doc)
    const items = scanAll(state)
    expect(markedText(state, items)).toEqual([
      'cm-md-list-mark: -',
      'cm-md-list-mark: *',
      'cm-md-list-mark: +',
      'cm-md-list-mark: 1.',
      'cm-md-list-mark: 2)',
    ])
    expect(hidden(items)).toEqual([])
  })

  it('styles nested markers and the marker of a task item', () => {
    const doc = '- a\n  - b\n    1. c\n- [ ] task\n\nend'
    const state = stateOf(doc)
    expect(markedText(state, scanAll(state))).toEqual([
      'cm-md-list-mark: -',
      'cm-md-list-mark: -',
      'cm-md-list-mark: 1.',
      'cm-md-list-mark: -',
    ])
  })

  it('does not treat a dash inside text as a marker', () => {
    const state = stateOf('a - b and 1. c\n\nend')
    expect(markedText(state, scanAll(state))).toEqual([])
  })

  it('styles emphasis inside an item', () => {
    const state = stateOf('- some **bold** item\n\nend')
    expect(markedText(state, scanAll(state))).toContain('cm-md-strong: **bold**')
  })
})
