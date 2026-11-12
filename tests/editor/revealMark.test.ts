/**
 * The mark on the match a search result jumped to (ISC-306): set by an effect, drawn as one range,
 * cleared by an edit or a move of the caret, and left alone by a scroll or an unrelated effect.
 */
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { revealMark, revealMarkEffect, revealedRange } from '@/editor/revealMark'

const make = (doc = 'one needle two\nthree needle'): EditorState =>
  EditorState.create({ doc, extensions: [revealMark()] })

describe('the revealed match', () => {
  it('starts with no mark, and an effect sets one', () => {
    const state = make()
    expect(revealedRange(state)).toBeNull()
    const next = state.update({ effects: revealMarkEffect.of({ from: 4, to: 10 }) }).state
    expect(revealedRange(next)).toEqual({ from: 4, to: 10 })
  })

  it('a jump sets the caret and the mark in one step and the mark stays', () => {
    const state = make()
    const next = state.update({
      selection: { anchor: 4 },
      effects: revealMarkEffect.of({ from: 4, to: 10 }),
    }).state
    expect(next.selection.main.head).toBe(4)
    expect(revealedRange(next)).toEqual({ from: 4, to: 10 })
  })

  it('moving the caret or editing ends it', () => {
    const marked = make().update({ effects: revealMarkEffect.of({ from: 4, to: 10 }) }).state
    expect(revealedRange(marked.update({ selection: { anchor: 2 } }).state)).toBeNull()
    expect(revealedRange(marked.update({ changes: { from: 0, insert: 'x' } }).state)).toBeNull()
  })

  it('a transaction that touches neither leaves it, and null takes it away', () => {
    const marked = make().update({ effects: revealMarkEffect.of({ from: 4, to: 10 }) }).state
    expect(revealedRange(marked.update({ scrollIntoView: true }).state)).toEqual({
      from: 4,
      to: 10,
    })
    expect(revealedRange(marked.update({ effects: revealMarkEffect.of(null) }).state)).toBeNull()
  })
})
