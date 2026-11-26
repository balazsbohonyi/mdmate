// @vitest-environment jsdom
/**
 * ISC-746: the gap below a whole list is one line of body text. A blank line is already that gap, so
 * only a list followed directly by other content gets padding, and only on its last line.
 */
import type { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { blocksOf } from '@/editor/livePreview/blocks'
import { LIST_GAP_EXTRA } from '@/editor/livePreview/blocks/widgets'
import { blockStateOf, mountPreview } from '../helpers/blocks'
import { valuesOf } from '../helpers/editorRules'
import { lineClasses, scanAll, stateOf } from '../helpers/preview'

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

function mount(doc: string, caret = doc.length): EditorView {
  const view = mountPreview(doc, caret)
  views.push(view)
  return view
}

/** The numbers of the lines that carry the gap. */
function ends(doc: string): number[] {
  const state = stateOf(doc)
  return lineClasses(state, scanAll(state))
    .filter((entry) => entry.includes('cm-md-list-end'))
    .map((entry) => Number.parseInt(entry, 10))
}

const LINE = 'calc(var(--doc-line-height, 1.5) * var(--doc-size, 16px))'

describe('the gap below a list (ISC-746)', () => {
  it.each([
    ['a blank line', '- a\n- b\n\ntext', []],
    ['a heading', '- a\n- b\n# H', [2]],
    ['a fence', '- a\n- b\n```\nx\n```', [2]],
    ['a rule', '- a\n- b\n***', [2]],
    ['a quote', '1. a\n2. b\n> q', [2]],
    ['a list of another kind', '- a\n1. b\n\nend', [1]],
    ['the end of the file', '- a\n- b', []],
    ['a last line break', '- a\n- b\n', []],
  ])('before %s', (_name, doc, expected) => {
    expect(ends(doc)).toEqual(expected)
  })

  it('puts none inside a list, and one below the whole of a nested one', () => {
    expect(ends('- a\n  - b\n    - c\n- d\n  - e\n# H')).toEqual([5])
    expect(ends('- a\n  - b\n\n- c\n# H')).toEqual([4])
  })

  it('puts it on the last line of an item with more than one line', () => {
    expect(ends('- a\n\n  second paragraph\n# H')).toEqual([3])
  })

  it('is padding of one body line', () => {
    mount('- a\n# H', 0)
    expect(valuesOf('.cm-line.cm-md-list-end', 'padding-bottom')).toEqual([LINE])
  })

  it('goes inside the table when the list ends in one, and counts in its height', () => {
    const doc = '- a\n  | x |\n  |---|\n  | 1 |\n# H'
    const view = mount(doc)
    const shell = view.contentDOM.querySelector('.cm-md-table-indented')
    expect(shell?.classList.contains('cm-md-list-end')).toBe(true)
    expect(valuesOf('.cm-md-list-end > .cm-md-table-wrap', 'padding-bottom')).toEqual([LINE])
    const spaced = blocksOf(blockStateOf(doc, doc.length))[0]?.estimatedHeight ?? 0
    const apart = doc.replace('# H', '\n# H')
    const plain = blocksOf(blockStateOf(apart, apart.length))[0]?.estimatedHeight ?? 0
    expect(spaced - plain).toBe(LIST_GAP_EXTRA)
  })

  it('comes and goes with the line after a table, without touching the table', () => {
    const view = mount('- a\n  | x |\n  |---|\n  | 1 |\n\n# H')
    const gap = (): boolean => view.contentDOM.querySelector('.cm-md-list-end') !== null
    expect(gap()).toBe(false)
    const blank = view.state.doc.line(5).from
    view.dispatch({ changes: { from: blank - 1, to: blank } })
    expect(gap()).toBe(true)
    view.dispatch({ changes: { from: blank - 1, insert: '\n' } })
    expect(gap()).toBe(false)
  })
})
