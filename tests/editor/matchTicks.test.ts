// @vitest-environment jsdom
/**
 * The ticks along the scrollbar (P7-T6, ISC-309 and ISC-310): where the find query matches and where
 * the folder search found hits. The pixel positions are checked in the real window; here, the
 * places, the mapping through edits, the rows the ticks fall in, and the strip a view draws.
 */
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_FIND, findEffect, findSupport } from '@/editor/find'
import {
  TICK_STEP,
  matchPositions,
  matchTicks,
  searchHitsOf,
  setSearchHits,
  tickRows,
} from '@/editor/matchTicks'

const text = (lines: number): string =>
  Array.from({ length: lines }, (_, i) => `line ${String(i)} needle`).join('\n')

describe('the places the find query matches', () => {
  const searching = (doc: string, search: string): EditorState =>
    EditorState.create({ doc, extensions: [findSupport()] }).update({
      effects: findEffect({ ...EMPTY_FIND, search }),
    }).state

  it('lists where each match starts, in order, and nothing without a query', () => {
    expect(matchPositions(searching('a needle b needle', 'needle'))).toEqual([2, 11])
    expect(matchPositions(searching('a needle', ''))).toEqual([])
    expect(matchPositions(EditorState.create({ doc: 'needle' }))).toEqual([])
  })

  it('stops at the cap, so a common letter stays cheap', () => {
    const state = searching('e'.repeat(500), 'e')
    expect(matchPositions(state, { cap: 100 })).toHaveLength(100)
    expect(matchPositions(state)).toHaveLength(500)
  })
})

/** A hit of 6 letters starting at `from`. */
const r = (from: number): { from: number; to: number } => ({ from, to: from + 6 })
const starts = (state: EditorState): number[] => searchHitsOf(state).map((hit) => hit.from)

describe('the places the folder search found', () => {
  const make = (): EditorState =>
    EditorState.create({ doc: 'one needle two\nthree needle', extensions: [matchTicks()] })

  it('are set by an effect, and an empty list takes them away', () => {
    const state = make()
    expect(starts(state)).toEqual([])
    const set = state.update({ effects: setSearchHits.of([r(4), r(21)]) }).state
    expect(starts(set)).toEqual([4, 21])
    expect(starts(set.update({ effects: setSearchHits.of([]) }).state)).toEqual([])
  })

  it('are marked in the text, every one of them, and the marks move and go with the places', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({ parent, state: make() })
    view.dispatch({ effects: setSearchHits.of([r(4), r(21)]) })
    expect([...parent.querySelectorAll('.cm-md-hit')].map((e) => e.textContent)).toEqual([
      'needle',
      'needle',
    ])
    view.dispatch({ changes: { from: 0, insert: 'XX' } })
    expect([...parent.querySelectorAll('.cm-md-hit')].map((e) => e.textContent)).toEqual([
      'needle',
      'needle',
    ])
    view.dispatch({ effects: setSearchHits.of([]) })
    expect(parent.querySelector('.cm-md-hit')).toBeNull()
    view.destroy()
    parent.remove()
  })

  it('move with the text when it is edited', () => {
    const set = make().update({ effects: setSearchHits.of([r(4), r(21)]) }).state
    const edited = set.update({ changes: { from: 0, insert: 'XX' } }).state
    expect(starts(edited)).toEqual([6, 23])
    const cut = set.update({ changes: { from: 0, to: 3 } }).state
    expect(starts(cut)).toEqual([1, 18])
  })
})

describe('the rows the ticks fall in', () => {
  it('puts places that share a few pixels in one row, in order', () => {
    // A 300 px track in 3 px rows has 100 rows.
    expect(tickRows([0, 0.001, 0.5, 0.5, 1], 300)).toEqual([0, 50, 99])
    expect(TICK_STEP).toBe(3)
  })

  it('keeps every row inside the track and ignores a place with no height', () => {
    expect(tickRows([1.5, -1, Number.NaN], 30)).toEqual([0, 9])
    expect(tickRows([], 300)).toEqual([])
  })
})

describe('the strip a view draws', () => {
  let view: EditorView | undefined
  afterEach(() => {
    view?.destroy()
    view = undefined
    document.body.replaceChildren()
  })

  const frame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

  function mount(doc: string): EditorView {
    const parent = document.createElement('div')
    document.body.append(parent)
    view = new EditorView({
      parent,
      state: EditorState.create({ doc, extensions: [findSupport(), matchTicks()] }),
    })
    // jsdom has no layout, so the scroller is given the size a real one would have.
    Object.defineProperty(view.scrollDOM, 'scrollHeight', { value: 3000, configurable: true })
    Object.defineProperty(view.scrollDOM, 'clientHeight', { value: 600, configurable: true })
    Object.defineProperty(view.scrollDOM, 'offsetWidth', { value: 610, configurable: true })
    Object.defineProperty(view.scrollDOM, 'clientWidth', { value: 600, configurable: true })
    return view
  }

  const strip = (): HTMLElement | null => document.querySelector('[data-scroll-ticks]')
  const boxes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.cm-md-tick')]

  it('draws nothing until there is something to point at', async () => {
    mount(text(50))
    await frame()
    expect(strip()).toBeNull()
  })

  it('draws a tick row for the folder search places, inside the scroller frame and before the scroller', async () => {
    const v = mount(text(50))
    v.dispatch({ effects: setSearchHits.of([r(0), r(text(50).length - 1)]) })
    await frame()
    expect(strip()).not.toBeNull()
    expect(strip()?.nextElementSibling).toBe(v.scrollDOM)
    expect(strip()?.getAttribute('aria-hidden')).toBe('true')
    expect(boxes().length).toBe(2)
    expect(boxes()[0]?.style.top).toBe('0px')
    v.dispatch({ effects: setSearchHits.of([]) })
    await frame()
    expect(strip()).toBeNull()
  })

  it('draws the find query matches along the file, and removes them with the query', async () => {
    const v = mount(text(50))
    v.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: 'needle' }) })
    await frame()
    expect(boxes().length).toBeGreaterThan(5)
    v.dispatch({ effects: findEffect(EMPTY_FIND) })
    await frame()
    expect(strip()).toBeNull()
  })

  it('leaves no strip behind when the view is destroyed with a measure still waiting', async () => {
    const v = mount(text(50))
    v.dispatch({ effects: setSearchHits.of([r(10)]) })
    v.destroy()
    view = undefined
    await frame()
    expect(strip()).toBeNull()
  })
})
