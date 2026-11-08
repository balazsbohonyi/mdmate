// @vitest-environment jsdom
/**
 * Fenced code as a styled container: its lines carry the container classes, its fences hide away
 * from the caret and a label names the language. The container itself is `box.ts`, which a later
 * block kind (Mermaid) will use too; the last tests here exercise it without any code block.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import { codeLanguage, languageName } from '@/editor/codeLanguages'
import { boxLines } from '@/editor/livePreview/box'
import type { PreviewItem } from '@/editor/livePreview/scan'
import { scanPreview } from '@/editor/livePreview/scan'
import { hidden, lineClasses, rendered, scanAll, stateOf } from '../helpers/preview'
import { Text } from '@codemirror/state'

// An unknown word, so the label is the word itself whatever other tests have loaded: the list's
// names are kept for the whole run (the last test in the first group loads `ts`).
const doc = 'intro\n\n```zzzlang\nconst x = 1\nlet y = 2\n```\n\nend'
const FENCE_FROM = doc.indexOf('```zzzlang')
const FENCE_TO = doc.indexOf('\n\nend')

/** The `data-box-label` of every line item, as `line N: label`. */
function labels(state: ReturnType<typeof stateOf>, items: readonly PreviewItem[]): string[] {
  return items.flatMap((item) =>
    item.type === 'line' && item.attributes?.['data-box-label'] !== undefined
      ? [`${String(state.doc.lineAt(item.from).number)}: ${item.attributes['data-box-label']}`]
      : [],
  )
}

describe('fenced code container', () => {
  it('gives every line of the block its place: first, mid, last', () => {
    const state = stateOf(doc, 0)
    expect(lineClasses(state, scanAll(state))).toEqual([
      '3: cm-md-box cm-md-box-code cm-md-box-first',
      '4: cm-md-box cm-md-box-code cm-md-box-mid',
      '5: cm-md-box cm-md-box-code cm-md-box-mid',
      '6: cm-md-box cm-md-box-code cm-md-box-last',
    ])
  })

  it('hides both fences and labels the language with the caret outside', () => {
    const state = stateOf(doc, 0)
    const items = scanAll(state)
    expect(hidden(items)).toEqual([
      [FENCE_FROM, FENCE_FROM + 10],
      [doc.indexOf('```\n\nend'), doc.indexOf('```\n\nend') + 3],
    ])
    expect(labels(state, items)).toEqual(['3: zzzlang'])
    expect(rendered(state, items)).toBe('intro\n\n\nconst x = 1\nlet y = 2\n\n\nend')
  })

  it('shows the fences and no label with the caret anywhere in the block, edges included', () => {
    for (const caret of [FENCE_FROM, FENCE_FROM + 2, doc.indexOf('const') + 3, FENCE_TO]) {
      const state = stateOf(doc, caret)
      const items = scanAll(state)
      expect(hidden(items), `caret at ${String(caret)}`).toEqual([])
      expect(labels(state, items), `caret at ${String(caret)}`).toEqual([])
      // The block keeps its box: only the fences and the label change.
      expect(lineClasses(state, items), `caret at ${String(caret)}`).toHaveLength(4)
    }
  })

  it('shows the fences when a selection only touches the block', () => {
    const state = stateOf(doc, [0, FENCE_FROM])
    expect(hidden(scanAll(state))).toEqual([])
  })

  it('names the word as typed when the language list does not know it', () => {
    const text = 'a\n\n```zzzlang\nx\n```\n'
    const state = stateOf(text, 0)
    expect(labels(state, scanAll(state))).toEqual(['3: zzzlang'])
  })

  it('has no label for a fence without a language', () => {
    const state = stateOf('a\n\n```\nx\n```\n', 0)
    const items = scanAll(state)
    expect(labels(state, items)).toEqual([])
    expect(lineClasses(state, items)).toHaveLength(3)
    expect(hidden(items)).toHaveLength(2)
  })

  it('uses the first word of the info string as the label', () => {
    const state = stateOf('a\n\n```zzzlang title="x.ts"\nx\n```\n', 0)
    expect(labels(state, scanAll(state))).toEqual(['3: zzzlang'])
  })

  it('leaves a block with no closing fence open at the bottom and hides only the opening', () => {
    const text = 'a\n\n```py\nprint(1)'
    const state = stateOf(text, 0)
    const items = scanAll(state)
    expect(hidden(items)).toEqual([[3, 8]])
    expect(lineClasses(state, items)).toEqual([
      '3: cm-md-box cm-md-box-code cm-md-box-first',
      '4: cm-md-box cm-md-box-code cm-md-box-last',
    ])
  })

  it('draws two blocks apart, each with its own label', () => {
    const text = '```aaalang\na\n```\n\ntext\n\n```bbblang\nb\n```\n'
    const state = stateOf(text, text.length)
    const items = scanAll(state)
    expect(labels(state, items)).toEqual(['1: aaalang', '7: bbblang'])
    expect(lineClasses(state, items).filter((l) => l.endsWith('-first'))).toHaveLength(2)
  })

  it('reveals only the block the caret is in', () => {
    const text = '```aaalang\na\n```\n\ntext\n\n```bbblang\nb\n```\n'
    const state = stateOf(text, text.indexOf('a\n'))
    expect(labels(state, scanAll(state))).toEqual(['7: bbblang'])
  })

  it('draws no box for a fence inside a list or a quote', () => {
    for (const text of ['- item\n\n  ```js\n  x\n  ```\n', '> ```js\n> x\n> ```\n']) {
      const state = stateOf(text, text.length)
      const items = scanAll(state)
      expect(
        items.filter((item) => item.type === 'line' && item.class.includes('cm-md-box')),
        text,
      ).toEqual([])
      expect(labels(state, items)).toEqual([])
    }
  })

  it('does not draw a box around indented code', () => {
    const state = stateOf('para\n\n    indented\n', 0)
    expect(lineClasses(state, scanAll(state)).filter((l) => l.includes('cm-md-box'))).toEqual([])
  })

  it('costs what the screen shows for a block of thousands of lines', () => {
    const body = Array.from({ length: 5000 }, (_, i) => `line ${String(i)}`).join('\n')
    const big = `\`\`\`zzzlang\n${body}\n\`\`\`\n\nafter`
    // The caret is past the block, so its fences are hidden.
    const state = stateOf(big, big.length)
    const at = (n: number) => state.doc.line(n)
    const middle = scanPreview(state, [{ from: at(2000).from, to: at(2050).to }])
    const lines = middle.filter((item) => item.type === 'line')
    expect(lines).toHaveLength(51)
    expect(lines.every((item) => item.class.endsWith('cm-md-box-mid'))).toBe(true)
    // The fences are far outside the range: nothing is hidden or labelled there.
    expect(hidden(middle)).toEqual([])
    expect(labels(state, middle)).toEqual([])

    const top = scanPreview(state, [{ from: 0, to: at(20).to }])
    expect(top.filter((item) => item.type === 'line')).toHaveLength(20)
    expect(labels(state, top)).toEqual(['1: zzzlang'])
    expect(hidden(top)).toEqual([[0, 10]])
  })

  it('names a language the way the list does once it has loaded, and shows that name', async () => {
    expect(languageName('ts')).toBeNull()
    await codeLanguage('ts')?.load()
    expect(languageName('ts')).toBe('TypeScript')
    expect(languageName('TS ')).toBe('TypeScript')
    const state = stateOf('a\n\n```ts\nx\n```\n', 0)
    expect(labels(state, scanAll(state))).toEqual(['3: TypeScript'])
  })
})

describe('box lines, without a code block', () => {
  const text = Text.of(['one', 'two', 'three', 'four'])

  it('marks a one-line container as the only line', () => {
    const items = boxLines(text, 4, 7, { from: 0, to: text.length }, { kind: 'mermaid' })
    expect(items.map((item) => item.class)).toEqual(['cm-md-box cm-md-box-mermaid cm-md-box-only'])
  })

  it('puts the label on the first line only', () => {
    const items = boxLines(
      text,
      0,
      text.length,
      { from: 0, to: text.length },
      { kind: 'mermaid', label: 'Mermaid' },
    )
    expect(items.map((item) => item.attributes)).toEqual([
      { 'data-box-label': 'Mermaid' },
      undefined,
      undefined,
      undefined,
    ])
  })

  it('skips the lines above the view, and the label with the first one', () => {
    const items = boxLines(
      text,
      0,
      text.length,
      { from: 8, to: text.length },
      { kind: 'mermaid', label: 'Mermaid' },
    )
    expect(items).toHaveLength(2)
    expect(items.every((item) => item.attributes === undefined)).toBe(true)
  })
})

const views: EditorView[] = []

function mount(text: string, caret: number): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createView(parent, createState(text, [], { preview: true }))
  view.dispatch({ selection: { anchor: caret } })
  views.push(view)
  return view
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

describe('fenced code container, in a view', () => {
  it('puts the classes and the label on the lines the page draws', () => {
    const view = mount(doc, 0)
    const lines = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-box')]
    expect(lines).toHaveLength(4)
    expect(lines[0]?.classList.contains('cm-md-box-first')).toBe(true)
    expect(lines[3]?.classList.contains('cm-md-box-last')).toBe(true)
    expect(lines[0]?.getAttribute('data-box-label')).toBe('zzzlang')
    expect(lines.slice(1).every((line) => !line.hasAttribute('data-box-label'))).toBe(true)
    // The fences are not text on the page, and the label is an attribute, not text.
    expect(view.contentDOM.textContent).not.toContain('```')
    expect(view.contentDOM.textContent).not.toContain('zzzlang')
  })

  it('shows the fences, and drops the label, when the caret comes in, and back again', () => {
    const view = mount(doc, 0)
    view.dispatch({ selection: { anchor: doc.indexOf('const') } })
    expect(view.contentDOM.textContent).toContain('```zzzlang')
    expect(view.contentDOM.querySelector('[data-box-label]')).toBeNull()
    expect(view.contentDOM.querySelectorAll('.cm-md-box')).toHaveLength(4)

    view.dispatch({ selection: { anchor: 0 } })
    expect(view.contentDOM.textContent).not.toContain('```')
    expect(view.contentDOM.querySelector('[data-box-label]')?.getAttribute('data-box-label')).toBe(
      'zzzlang',
    )
  })

  it('gives each block its own label on the page', () => {
    const text = '```aaalang\na\n```\n\ntext\n\n```bbblang\nb\n```\n\nend'
    const view = mount(text, text.length)
    const found = [...view.contentDOM.querySelectorAll('[data-box-label]')].map((line) =>
      line.getAttribute('data-box-label'),
    )
    expect(found).toEqual(['aaalang', 'bbblang'])
  })

  it('leaves the document alone, whatever is hidden', () => {
    const view = mount(doc, 0)
    for (let pos = 0; pos <= doc.length; pos++) view.dispatch({ selection: { anchor: pos } })
    expect(view.state.doc.toString()).toBe(doc)
  })
})
