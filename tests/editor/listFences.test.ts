// @vitest-environment jsdom
/**
 * ISC-748 to ISC-750: a fenced block in a list item is drawn as a code container that starts at the
 * item's indent. A block in a quote keeps the plain look, a list marker before a fence stays, and
 * what is copied has none of the list's indentation.
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { codeBlockText } from '@/editor/livePreview/codeCopy'
import { codeCopy } from '@/editor/livePreview/codeCopy'
import type { LineItem, PreviewItem } from '@/editor/livePreview/scan'
import { mountPreview } from '../helpers/blocks'
import { valuesOf } from '../helpers/editorRules'
import { hidden, scanAll, stateOf } from '../helpers/preview'

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

const copy = codeCopy.of({ write: () => Promise.resolve(), notify: () => undefined })

const BULLET = '- item\n\n  ```zzz\n  a\n    b\n\n  ```\n\nend'
const ORDERED = '1. one\n   ```zzz\n   a\n   ```\n\nend'
const NESTED = '- a\n  - b\n    ```zzz\n    c\n    ```\n\nend'
const MARKER = '- ```zzz\n  a\n  ```\n\nend'
const OPEN = '- item\n\n  ```zzz\n  a\n\nend'

function boxesOf(items: readonly PreviewItem[]): LineItem[] {
  return items
    .flatMap((item) => (item.type === 'line' && item.class.includes('cm-md-box') ? [item] : []))
    .sort((a, b) => a.from - b.from)
}

/** `line N columns/lead` for each line of a container, read from the style it carries. */
function layout(doc: string): string[] {
  const state = stateOf(doc, doc.length)
  return boxesOf(scanAll(state)).map((item) => {
    const style = item.attributes?.style ?? ''
    const read = (name: string): string => new RegExp(`${name}:\\s*(\\d+)`).exec(style)?.[1] ?? '-'
    return `${String(state.doc.lineAt(item.from).number)} ${read('--box-columns')}/${read('--box-lead')}`
  })
}

describe('a fence in a list item is a code container (ISC-748)', () => {
  it.each([
    ['a bullet item', BULLET, ['3 2/2', '4 2/2', '5 2/2', '6 2/0', '7 2/2']],
    ['a numbered item', ORDERED, ['2 3/3', '3 3/3', '4 3/3']],
    // The fence is four typed columns in, and the nested item adds its own two.
    ['a nested item', NESTED, ['3 6/4', '4 6/4', '5 6/4']],
    // The marker line has no typed blanks to pull back.
    ['the marker line', MARKER, ['1 2/0', '2 2/2', '3 2/2']],
    ['an unclosed block', OPEN, ['3 2/2', '4 2/2']],
  ])('in %s, at the item indent', (_name, doc, expected) => {
    expect(layout(doc).slice(0, expected.length)).toEqual(expected)
  })

  it('has the container classes, the label, the button and hidden fences', () => {
    const state = stateOf(BULLET, BULLET.length, [copy])
    const items = scanAll(state)
    const lines = boxesOf(items)
    expect(lines[0]?.class).toBe('cm-md-box cm-md-box-code cm-md-box-first cm-md-box-nested')
    expect(lines.at(-1)?.class).toContain('cm-md-box-last')
    expect(lines[0]?.attributes?.['data-box-label']).toBe('zzz')
    expect(items.filter((item) => item.type === 'copy')).toEqual([
      { type: 'copy', at: BULLET.indexOf('```') },
    ])
    expect(
      items.filter((item) => item.type === 'line' && item.class === 'cm-md-copy-host'),
    ).toEqual([])
    expect(hidden(items)).toEqual([
      [BULLET.indexOf('```zzz'), BULLET.indexOf('```zzz') + 6],
      [BULLET.lastIndexOf('```'), BULLET.lastIndexOf('```') + 3],
    ])
  })

  it('shows the fences and no label while the caret is in the block', () => {
    const state = stateOf(BULLET, BULLET.indexOf('a\n'))
    const items = scanAll(state)
    expect(hidden(items)).toEqual([])
    expect(boxesOf(items)[0]?.attributes?.['data-box-label']).toBeUndefined()
  })

  it('draws the second copy of the indent on no line inside the container', () => {
    const state = stateOf(NESTED, NESTED.length)
    const shifted = scanAll(state).flatMap((item) =>
      item.type === 'indent' ? [state.doc.lineAt(item.from).number] : [],
    )
    expect(shifted).toEqual([2])
  })

  it('starts the container and the text at the indent, on the page', () => {
    mountPreview(BULLET, BULLET.length)
    const left = valuesOf('.cm-line.cm-md-box-nested', '--box-left')[0]
    expect(left).toContain('var(--box-columns')
    expect(left).toContain('var(--md-space')
    expect(valuesOf('.cm-line.cm-md-box-nested', 'padding-left')).toEqual([
      'calc(var(--box-left) + var(--box-inset))',
    ])
    expect(valuesOf('.cm-line.cm-md-box-nested', 'text-indent')).toEqual([
      'calc(var(--box-lead, 0) * -1ch)',
    ])
    expect(valuesOf('.cm-line.cm-md-box-nested::before', 'left')).toEqual(['var(--box-left)'])
  })

  it('keeps one line of body text below a list that ends in a container', () => {
    const doc = '- item\n\n  ```zzz\n  a\n  ```\n# H'
    const state = stateOf(doc, doc.length)
    const last = scanAll(state).filter(
      (item) => item.type === 'line' && item.from === state.doc.line(5).from,
    )
    expect(last.map((item) => (item.type === 'line' ? item.class : ''))).toContain('cm-md-list-end')
    const view = mountPreview(doc, doc.length)
    views.push(view)
    expect(valuesOf('.cm-line.cm-md-box-last.cm-md-list-end::before', 'bottom')).toHaveLength(1)
  })
})

describe('a fence in a quote stays plain (ISC-749)', () => {
  it.each([
    ['a quote', '> ```js\n> x\n> ```\n'],
    ['a list in a quote', '> - a\n>\n>   ```js\n>   x\n>   ```\n'],
    ['a quote in a list', '- a\n\n  > ```js\n  > x\n  > ```\n'],
  ])('in %s', (_name, doc) => {
    expect(boxesOf(scanAll(stateOf(doc, doc.length)))).toEqual([])
  })
})

describe('the marker and the copied text (ISC-750)', () => {
  it('hides nothing before the fence, so the marker stays', () => {
    const state = stateOf(MARKER, MARKER.length)
    const items = scanAll(state)
    for (const [from] of hidden(items)) {
      const line = state.doc.lineAt(from)
      expect(from).toBeGreaterThanOrEqual(line.from + 2)
    }
    expect(items).toContainEqual({ type: 'bullet', from: 0, to: 1 })
    expect(items).toContainEqual({ type: 'mark', from: 0, to: 2, class: 'cm-md-box-lead' })
    expect(boxesOf(items)[0]?.class).toContain('cm-md-box-marker')
  })

  it('draws the marker inside its own box before the container', () => {
    const view = mountPreview(MARKER, MARKER.length)
    views.push(view)
    const lead = view.contentDOM.querySelector('.cm-md-box-marker .cm-md-box-lead')
    expect(lead?.querySelector('.cm-md-bullet')).not.toBeNull()
  })

  it.each([
    ['a nested fence', NESTED, 'c'],
    ['a fence on the marker line', MARKER, 'a'],
    ['a fence indented by a tab', '- a\n\n\t```\n\tx\n\t\ty\n\t```\n', 'x\n\ty'],
  ])('copies the code of %s without the list indentation', (_name, doc, expected) => {
    const state = stateOf(doc)
    let at = -1
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === 'FencedCode') at = node.from
      },
    })
    expect(codeBlockText(state, at)).toBe(expected)
  })
})
