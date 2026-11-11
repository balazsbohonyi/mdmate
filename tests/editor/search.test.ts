// @vitest-environment jsdom
/**
 * Find and replace in one file (P7-T1): ISC-133 to ISC-136 and the claims written for the task
 * (replace all as one undo step, read-only, plain source at 10 MB, matches inside hidden syntax,
 * whole word). The editor side only: `src/editor/find.ts` is plain TypeScript with no Vue.
 */
import { searchPanelOpen } from '@codemirror/search'
import { EditorSelection, EditorState, Text } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { Document } from '@/documents/document'
import { createFollowerState, createState } from '@/editor/create'
import {
  EMPTY_FIND,
  countMatches,
  findEffect,
  findNext,
  findPrevious,
  findSupport,
  isValidFind,
  regexpProblem,
  replaceEvery,
  replaceOne,
  seedFromSelection,
  type FindSpec,
} from '@/editor/find'
import { uniformEndings } from '@/lib/endings'
import type { OpenedFile } from '@/platform'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

function viewOf(state: EditorState): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({ state, parent })
  views.push(view)
  return view
}

/** A view on `doc` with the caret at `caret` and `spec` already set as the query. */
function finder(
  doc: string,
  spec: Partial<FindSpec>,
  caret = 0,
  extra: Parameters<typeof createState>[2] = {},
): EditorView {
  const view = viewOf(
    createState(doc, [EditorState.readOnly.of(false)], { parser: false, ...extra }).update({
      selection: EditorSelection.single(caret),
    }).state,
  )
  view.dispatch({ effects: findEffect({ ...EMPTY_FIND, ...spec }) })
  return view
}

const text = (view: EditorView): string => view.state.doc.toString()
const selected = (view: EditorView): string => {
  const { from, to } = view.state.selection.main
  return view.state.sliceDoc(from, to)
}
const at = (view: EditorView): [number, number] => {
  const { from, to } = view.state.selection.main
  return [from, to]
}

describe('Ctrl+F finds text in the file (ISC-133)', () => {
  it('selects the next match after the caret, and wraps round at the end', () => {
    const view = finder('one two one two one', { search: 'two' })
    expect(findNext(view)).toBe(true)
    expect(at(view)).toEqual([4, 7])
    expect(findNext(view)).toBe(true)
    expect(at(view)).toEqual([12, 15])
    expect(findNext(view)).toBe(true)
    expect(at(view)).toEqual([4, 7])
  })

  it('goes back with findPrevious, wrapping round at the start', () => {
    const view = finder('one two one two one', { search: 'one' }, 19)
    expect(findPrevious(view)).toBe(true)
    expect(at(view)).toEqual([16, 19])
    view.dispatch({ selection: { anchor: 0 } })
    expect(findPrevious(view)).toBe(true)
    expect(at(view)).toEqual([16, 19])
  })

  it('does nothing when nothing matches, and leaves the caret where it was', () => {
    const view = finder('alpha beta', { search: 'gamma' }, 3)
    expect(findNext(view)).toBe(false)
    expect(at(view)).toEqual([3, 3])
  })

  it('never opens CodeMirror own panel, with an empty query or with matches', () => {
    const empty = finder('abc', { search: '' })
    expect(findNext(empty)).toBe(false)
    expect(searchPanelOpen(empty.state)).toBe(false)
    expect(empty.dom.querySelector('.cm-search')).toBeNull()
    const some = finder('abc abc', { search: 'abc' })
    findNext(some)
    expect(searchPanelOpen(some.state)).toBe(false)
  })

  it('searches the text as typed: a backslash in a plain query is a backslash', () => {
    const view = finder('C:\\temp\\new and a tab\there', { search: 'temp\\new' })
    expect(findNext(view)).toBe(true)
    expect(selected(view)).toBe('temp\\new')
  })
})

describe('Find supports regular expressions (ISC-135)', () => {
  it('matches a pattern and selects the whole match', () => {
    const view = finder('a1 b22 c333', { search: '[a-z]\\d{2,}', regexp: true })
    expect(findNext(view)).toBe(true)
    expect(selected(view)).toBe('b22')
    expect(findNext(view)).toBe(true)
    expect(selected(view)).toBe('c333')
  })

  it('treats the same text as plain characters when the option is off', () => {
    const view = finder('a.c abc', { search: 'a.c' })
    expect(findNext(view)).toBe(true)
    expect(at(view)).toEqual([0, 3])
    expect(findNext(view)).toBe(true)
    expect(at(view)).toEqual([0, 3])
  })

  it('reports a pattern that does not compile, and finds nothing for it', () => {
    const spec = { ...EMPTY_FIND, search: '(unclosed', regexp: true }
    expect(isValidFind(spec)).toBe(false)
    expect(regexpProblem(spec)).toMatch(/regular expression/i)
    expect(regexpProblem({ ...spec, regexp: false })).toBeNull()
    const view = finder('(unclosed here', spec)
    expect(findNext(view)).toBe(false)
  })
})

describe('Find supports case-sensitive matching (ISC-136)', () => {
  it('ignores case by default and respects it when asked', () => {
    const insensitive = finder('Foo foo FOO', { search: 'foo' })
    expect(countMatches(insensitive.state)).toMatchObject({ total: 3 })
    const exact = finder('Foo foo FOO', { search: 'foo', caseSensitive: true })
    expect(countMatches(exact.state)).toMatchObject({ total: 1 })
    expect(findNext(exact)).toBe(true)
    expect(at(exact)).toEqual([4, 7])
  })

  it('applies to patterns too', () => {
    const view = finder('ABC abc', { search: 'a.c', regexp: true, caseSensitive: true })
    expect(findNext(view)).toBe(true)
    expect(at(view)).toEqual([4, 7])
  })
})

describe('Find supports whole-word matching (ISC-265)', () => {
  it('skips a match that is part of a longer word', () => {
    const view = finder('cat concat cat. category', { search: 'cat', wholeWord: true })
    expect(findNext(view)).toBe(true)
    expect(at(view)).toEqual([0, 3])
    expect(findNext(view)).toBe(true)
    expect(at(view)).toEqual([11, 14])
    expect(countMatches(view.state)).toMatchObject({ total: 2 })
  })

  it('finds the part of a word when the option is off', () => {
    const view = finder('cat concat cat. category', { search: 'cat' })
    expect(countMatches(view.state)).toMatchObject({ total: 4 })
  })

  it('counts letters outside ASCII as part of a word', () => {
    const view = finder('über uber ber', { search: 'ber', wholeWord: true })
    expect(countMatches(view.state)).toMatchObject({ total: 1 })
    expect(findNext(view)).toBe(true)
    expect(at(view)).toEqual([10, 13])
  })

  it('combines with a pattern', () => {
    const view = finder('a1 a12 a123x', { search: 'a\\d+', regexp: true, wholeWord: true })
    expect(countMatches(view.state)).toMatchObject({ total: 2 })
  })
})

describe('Ctrl+H replaces text in the file (ISC-134)', () => {
  it('selects the first match, then replaces the selected one and moves to the next', () => {
    const view = finder('x one x two x', { search: 'x', replace: 'YY' })
    // Nothing is selected yet, so the first press only shows which match it would replace.
    expect(replaceOne(view)).toBe(true)
    expect(text(view)).toBe('x one x two x')
    expect(at(view)).toEqual([0, 1])
    expect(replaceOne(view)).toBe(true)
    expect(text(view)).toBe('YY one x two x')
    expect(at(view)).toEqual([7, 8])
    expect(replaceOne(view)).toBe(true)
    expect(text(view)).toBe('YY one YY two x')
  })

  it('replaces every match at once', () => {
    const view = finder('x one x two x', { search: 'x', replace: 'YY' })
    expect(replaceEvery(view)).toBe(true)
    expect(text(view)).toBe('YY one YY two YY')
  })

  it('uses capture groups in a pattern, and reads \\n as a line break there', () => {
    const view = finder('a=1, b=2', {
      search: '(\\w)=(\\d)',
      regexp: true,
      replace: '$2:$1\\n',
    })
    expect(replaceEvery(view)).toBe(true)
    expect(text(view)).toBe('1:a\n, 2:b\n')
  })

  it('writes the replacement as typed when the pattern option is off', () => {
    const view = finder('a b', { search: 'a', replace: '$1\\n' })
    expect(replaceEvery(view)).toBe(true)
    expect(text(view)).toBe('$1\\n b')
  })

  it('replaces nothing, and says so, when there is no match', () => {
    const view = finder('abc', { search: 'zzz', replace: 'q' })
    expect(replaceEvery(view)).toBe(false)
    expect(replaceOne(view)).toBe(false)
    expect(text(view)).toBe('abc')
  })

  it('replaces with an empty string', () => {
    const view = finder('a-b-c', { search: '-', replace: '' })
    expect(replaceEvery(view)).toBe(true)
    expect(text(view)).toBe('abc')
  })
})

describe('Replace is off on a read-only document (ISC-259)', () => {
  it('changes nothing, while Find still works', () => {
    const view = viewOf(
      createState('one two one', [EditorState.readOnly.of(true)], { parser: false }),
    )
    view.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: 'one', replace: 'X' }) })
    expect(replaceEvery(view)).toBe(false)
    expect(replaceOne(view)).toBe(false)
    expect(text(view)).toBe('one two one')
    expect(findNext(view)).toBe(true)
    expect(selected(view)).toBe('one')
  })
})

describe('Find works in a plain-source tab on the 10 MB fixture (ISC-260)', () => {
  /** Slightly over 10 MB of lines, with one match in the very last line. */
  const big = (() => {
    const line = 'The quick brown fox jumps over the lazy dog, again and again.'
    const lines: string[] = []
    let size = 0
    while (size < 10 * 1024 * 1024) {
      lines.push(line)
      size += line.length + 1
    }
    lines.push('the very last needle is here')
    return Text.of(lines)
  })()

  it('finds the last match from the top, and counts without waiting for the parser', () => {
    const state = createFollowerState({ doc: big, parser: false, extensions: [] })
    const view = viewOf(state)
    view.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: 'needle' }) })
    expect(findNext(view)).toBe(true)
    expect(selected(view)).toBe('needle')
    expect(view.state.selection.main.from).toBe(
      big.length - 'the very last needle is here'.length + 'the very last '.length,
    )
    expect(countMatches(view.state, { budgetMs: 60_000 })).toEqual({
      total: 1,
      current: 1,
      capped: false,
    })
  })

  it('stops counting at the cap and says the number is a floor', () => {
    const state = createFollowerState({ doc: big, parser: false, extensions: [] })
    const view = viewOf(state)
    view.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: 'fox' }) })
    const count = countMatches(view.state, { cap: 500 })
    expect(count.total).toBe(500)
    expect(count.capped).toBe(true)
  })

  it('stops on the clock even when there is nothing to count by: a rare word at the very end', () => {
    const state = createFollowerState({ doc: big, parser: false, extensions: [] })
    const view = viewOf(state)
    view.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: 'needle' }) })
    // No time at all: the count gives up after its first piece, and says so.
    expect(countMatches(view.state, { budgetMs: 0 })).toEqual({
      total: 0,
      current: 0,
      capped: true,
    })
  })

  it('counts every match of a document that is several pieces long, none twice', () => {
    // Every line is 100 characters, a match line included, so the joins are easy to find.
    const filler = 'x'.repeat(100)
    const needleLine = 'a needle here'.padEnd(100, 'x')
    const lines = Array.from({ length: 13_000 }, () => filler)
    const probe = Text.of(lines)
    expect(probe.length).toBeGreaterThan(1_200_000)
    // The first three places where a piece of 128 KB ends, as the count cuts them (at the end of a line).
    const joins: number[] = []
    for (let from = 0; joins.length < 3;) {
      from = probe.lineAt(from + 128 * 1024).to
      joins.push(from)
    }
    const matching = new Set([5, 12_999])
    for (const join of joins) {
      const after = probe.lineAt(join + 1).number - 1
      for (let n = after - 3; n <= after + 3; n++) matching.add(n)
    }
    for (const n of matching) lines[n] = needleLine
    const view = viewOf(createFollowerState({ doc: Text.of(lines), parser: false, extensions: [] }))
    view.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: 'needle' }) })
    expect(matching.size).toBe(2 + 3 * 7)
    expect(countMatches(view.state, { budgetMs: 60_000 })).toEqual({
      total: matching.size,
      current: 0,
      capped: false,
    })
  })
})

describe('Replace All is one undo step, seen in both panes (ISC-258)', () => {
  function open(text: string): Document {
    const opened: OpenedFile = {
      id: 1,
      path: '/t/a.md',
      name: 'a.md',
      encoding: 'utf-8',
      bom: false,
      readOnly: null,
      size: text.length,
      hash: '0'.repeat(32),
      kind: 'markdown',
      text,
      endings: uniformEndings(),
    }
    return new Document(opened, () => undefined)
  }

  it('is undone by one undo, in the master and in the pane that did not ask', () => {
    const doc = open('x one x two x\n')
    const left = doc.followerFor('left')
    const right = doc.followerFor('right')
    const leftView = viewOf(left.state)
    left.show(leftView)
    const rightView = viewOf(right.state)
    right.show(rightView)
    leftView.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: 'x', replace: 'YY' }) })
    expect(replaceEvery(leftView)).toBe(true)
    expect(leftView.state.doc.toString()).toBe('YY one YY two YY\n')
    expect(rightView.state.doc.toString()).toBe('YY one YY two YY\n')
    expect(doc.master.doc.toString()).toBe('YY one YY two YY\n')
    expect(right.undo()).toBe(true)
    expect(doc.master.doc.toString()).toBe('x one x two x\n')
    expect(leftView.state.doc.toString()).toBe('x one x two x\n')
    expect(rightView.state.doc.toString()).toBe('x one x two x\n')
  })

  it('leaves the replaced text in the master, so a later undo does not need two presses', () => {
    const doc = open('a a a\n')
    const only = doc.followerFor('only')
    const view = viewOf(only.state)
    only.show(view)
    view.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: 'a', replace: 'bb' }) })
    replaceEvery(view)
    expect(only.undo()).toBe(true)
    expect(doc.master.doc.toString()).toBe('a a a\n')
    expect(only.undo()).toBe(false)
  })
})

describe('Find Next reveals a match inside hidden syntax (ISC-261)', () => {
  const preview = { preview: true } as const

  /** Shows the document with the caret at the end, so nothing the match is in is touched by it. */
  function drawn(doc: string, search: string): EditorView {
    const view = viewOf(
      createState(doc, [], preview).update({ selection: EditorSelection.single(doc.length) }).state,
    )
    view.dispatch({ effects: findEffect({ ...EMPTY_FIND, search }) })
    return view
  }

  it('a link target is hidden until the match is selected, then it shows', () => {
    const view = drawn('first line\n\nsee [the docs](https://example.com/zzfind) now\n', 'zzfind')
    expect(view.dom.textContent).not.toContain('zzfind')
    expect(findNext(view)).toBe(true)
    expect(selected(view)).toBe('zzfind')
    expect(view.dom.textContent).toContain('https://example.com/zzfind')
  })

  it('a table is drawn until the match inside it is selected, then its source shows', () => {
    const view = drawn('intro\n\n| a | b |\n| - | - |\n| zzfind | 2 |\n\nafter\n', 'zzfind')
    expect(view.dom.querySelector('table')).not.toBeNull()
    expect(findNext(view)).toBe(true)
    expect(selected(view)).toBe('zzfind')
    expect(view.dom.querySelector('table')).toBeNull()
    expect(view.dom.textContent).toContain('| zzfind | 2 |')
  })

  it('frontmatter is a pill until the match inside it is selected, then the YAML shows', () => {
    const view = drawn('---\ntitle: zzfind\n---\n\nbody\n', 'zzfind')
    expect(view.dom.textContent).not.toContain('title: zzfind')
    expect(findNext(view)).toBe(true)
    expect(selected(view)).toBe('zzfind')
    expect(view.dom.textContent).toContain('title: zzfind')
  })

  it('an image is drawn until the match in its source is selected, then the source shows', () => {
    const view = drawn('text\n\n![alt zzfind](pic.png)\n\nafter\n', 'zzfind')
    expect(view.dom.textContent).not.toContain('![alt zzfind](pic.png)')
    expect(findNext(view)).toBe(true)
    expect(selected(view)).toBe('zzfind')
    expect(view.dom.textContent).toContain('![alt zzfind](pic.png)')
  })
})

describe('Match marks', () => {
  it('marks the matches on screen and the selected one as current', () => {
    const view = finder('aa bb aa bb aa', { search: 'aa' })
    expect(view.dom.querySelectorAll('.cm-md-find')).toHaveLength(3)
    expect(view.dom.querySelectorAll('.cm-md-find-active')).toHaveLength(0)
    findNext(view)
    const active = view.dom.querySelectorAll('.cm-md-find-active')
    expect(active).toHaveLength(1)
    expect(active[0]?.textContent).toBe('aa')
  })

  it('marks nothing for an empty or invalid query, and clears when the query is emptied', () => {
    const view = finder('aa bb', { search: 'aa' })
    expect(view.dom.querySelectorAll('.cm-md-find')).toHaveLength(1)
    view.dispatch({ effects: findEffect(EMPTY_FIND) })
    expect(view.dom.querySelectorAll('.cm-md-find')).toHaveLength(0)
    view.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: '(', regexp: true }) })
    expect(view.dom.querySelectorAll('.cm-md-find')).toHaveLength(0)
  })

  it('follows the text when it is edited', () => {
    const view = finder('aa bb', { search: 'aa' })
    view.dispatch({ changes: { from: 5, insert: ' aa aa' } })
    expect(view.dom.querySelectorAll('.cm-md-find')).toHaveLength(3)
  })

  it('drops the mark of a match an edit destroyed, even when the viewport does not move', () => {
    const view = finder('aa bb', { search: 'aa' })
    view.dispatch({ changes: { from: 0, to: 2, insert: 'xx' } })
    expect(view.dom.querySelectorAll('.cm-md-find')).toHaveLength(0)
    view.dispatch({ changes: { from: 3, to: 5, insert: 'aa' } })
    expect(view.dom.querySelectorAll('.cm-md-find')).toHaveLength(1)
  })
})

describe('CodeMirror search keys stay out (ISC-262)', () => {
  it('Ctrl+D, Ctrl+Shift+L, Ctrl+G, F3 and Ctrl+F reach no editor binding', () => {
    const view = finder('aa aa aa', { search: 'aa' }, 0)
    const keys: [string, KeyboardEventInit][] = [
      ['d', { ctrlKey: true }],
      ['l', { ctrlKey: true, shiftKey: true }],
      ['g', { ctrlKey: true }],
      ['g', { ctrlKey: true, altKey: true }],
      ['F3', {}],
      ['f', { ctrlKey: true }],
    ]
    for (const [key, init] of keys) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
      expect(runScopeHandlers(view, event, 'editor')).toBe(false)
    }
    expect(view.state.selection.ranges).toHaveLength(1)
  })
})

describe('countMatches', () => {
  it('gives the total and the number of the selected match', () => {
    const view = finder('a a a a', { search: 'a' })
    expect(countMatches(view.state)).toEqual({ total: 4, current: 0, capped: false })
    findNext(view)
    findNext(view)
    expect(countMatches(view.state)).toEqual({ total: 4, current: 2, capped: false })
  })

  it('gives zero for a query that cannot match', () => {
    const view = finder('abc', { search: '(', regexp: true })
    expect(countMatches(view.state)).toEqual({ total: 0, current: 0, capped: false })
  })
})

describe('seedFromSelection', () => {
  const doc = 'hello world\nsecond line'
  const state = (from: number, to: number): EditorState =>
    createState(doc, [], { parser: false }).update({ selection: EditorSelection.single(from, to) })
      .state

  it('takes a selected word as the query', () => {
    expect(seedFromSelection(state(6, 11), EMPTY_FIND).search).toBe('world')
  })

  it('keeps the old query for a caret, a selection over lines, or a very long one', () => {
    const old = { ...EMPTY_FIND, search: 'keep' }
    expect(seedFromSelection(state(3, 3), old).search).toBe('keep')
    expect(seedFromSelection(state(0, 18), old).search).toBe('keep')
    const long = createState('x'.repeat(500), [], { parser: false }).update({
      selection: EditorSelection.single(0, 400),
    }).state
    expect(seedFromSelection(long, old).search).toBe('keep')
  })

  it('escapes the text when the pattern option is on', () => {
    const spec = seedFromSelection(state(0, 5), { ...EMPTY_FIND, regexp: true })
    expect(spec.search).toBe('hello')
    const dotted = createState('a.b*c', [], { parser: false }).update({
      selection: EditorSelection.single(0, 5),
    }).state
    expect(seedFromSelection(dotted, { ...EMPTY_FIND, regexp: true }).search).toBe('a\\.b\\*c')
  })

  it('leaves the other options alone', () => {
    const spec = seedFromSelection(state(6, 11), {
      ...EMPTY_FIND,
      caseSensitive: true,
      replace: 'r',
    })
    expect(spec).toMatchObject({ search: 'world', caseSensitive: true, replace: 'r' })
  })
})

describe('the support extension', () => {
  it('is in every state the app builds for a tab, with or without the parser', () => {
    const doc = Text.of(['abc'])
    for (const parser of [true, false]) {
      const view = viewOf(createFollowerState({ doc, parser, extensions: [] }))
      view.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: 'b' }) })
      expect(findNext(view), `parser ${String(parser)}`).toBe(true)
    }
  })

  it('can be added to a bare state', () => {
    const view = viewOf(EditorState.create({ doc: 'abc', extensions: [findSupport()] }))
    view.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: 'c' }) })
    expect(findNext(view)).toBe(true)
  })
})
