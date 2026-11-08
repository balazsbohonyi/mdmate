// @vitest-environment jsdom
/**
 * ISC-68: YAML frontmatter collapses to a pill, and a caret that touches it puts the YAML back.
 * Where the block is comes from the text alone (`frontmatterEnd`); the block layer and the inline
 * layer both read that, so the tests check the answer, what each layer does with it, and the page.
 */
import { Text } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { blocksOf, scanBlocks } from '@/editor/livePreview/blocks'
import { FrontmatterWidget } from '@/editor/livePreview/blocks/widgets'
import {
  FRONTMATTER_MAX_LINES,
  frontmatterEnd,
  frontmatterKeys,
} from '@/editor/livePreview/frontmatter'
import { blockStateOf, drawn, mountPreview } from '../helpers/blocks'
import { scanPreview } from '@/editor/livePreview/scan'
import { lineClasses, markedText, scanAll, stateOf } from '../helpers/preview'

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})
function mount(doc: string, caret: number): EditorView {
  const view = mountPreview(doc, caret)
  views.push(view)
  return view
}

const FRONT = '---\ntitle: Hello\ntags: [a, b]\n---'
const DOC = `${FRONT}\n\n# Body\n\ntext\n`
const END = FRONT.length

function endOf(text: string): number | null {
  return frontmatterEnd(Text.of(text.split('\n')))
}

describe('where frontmatter is', () => {
  it('ends at the end of the closing line', () => {
    expect(endOf(DOC)).toBe(END)
  })

  it('accepts a closing `...` and blanks after either fence', () => {
    expect(endOf('---\na: 1\n...')).toBe(12)
    expect(endOf('--- \t\na: 1\n---  ')).toBe(16)
  })

  it('accepts an empty block', () => {
    expect(endOf('---\n---\nafter')).toBe(7)
  })

  it('needs both fences, and the opening one on the very first line', () => {
    expect(endOf('---\na: 1\nno closing line')).toBeNull()
    expect(endOf('---')).toBeNull()
    expect(endOf('\n---\na: 1\n---')).toBeNull()
    expect(endOf('text\n---\na: 1\n---')).toBeNull()
  })

  it('needs the opening fence to be exactly three dashes', () => {
    expect(endOf('----\na: 1\n---')).toBeNull()
    expect(endOf('--- x\na: 1\n---')).toBeNull()
    expect(endOf(' ---\na: 1\n---')).toBeNull()
  })

  it('takes the first closing line, not the last', () => {
    expect(endOf('---\na: 1\n---\nmore\n---\nb: 2\n---')).toBe(12)
  })

  it('gives up after the line limit', () => {
    // Written out, so a change to the limit has to change this test too: 200 lines in all.
    expect(FRONTMATTER_MAX_LINES).toBe(200)
    const body = Array.from({ length: 198 }, (_, i) => `k${String(i)}: v`)
    // The closing line is line 200: found. One line later: not frontmatter.
    expect(endOf(['---', ...body, '---'].join('\n'))).not.toBeNull()
    expect(endOf(['---', ...body, 'one more: v', '---'].join('\n'))).toBeNull()
  })
})

describe('the label of the pill', () => {
  it('lists the top-level keys in order', () => {
    expect(frontmatterKeys('---\ntitle: A\ntags:\n  - x\n  - y\ndate: 2020-01-01\n---')).toBe(
      'title, tags, date',
    )
  })

  it('skips nested keys, list items, comments and text that is not a key', () => {
    const source =
      '---\nroot:\n  child: 1\n- item: 2\n# note: x\nplain text\nhttp://x.test/a\nname: v\n---'
    expect(frontmatterKeys(source)).toBe('root, name')
  })

  it('does not take the fences for keys, and is empty when there are none', () => {
    expect(frontmatterKeys('---\n---')).toBe('')
    expect(frontmatterKeys('---\njust text\n---')).toBe('')
  })

  it('cuts a long list with an ellipsis', () => {
    const keys = Array.from({ length: 30 }, (_, i) => `key${String(i)}: v`)
    const label = frontmatterKeys(['---', ...keys, '---'].join('\n'))
    expect(label.endsWith('…')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(49)
    expect(label.startsWith('key0, key1, key2')).toBe(true)
  })
})

describe('the block layer', () => {
  it('draws the block as one pill over the whole range', () => {
    expect(drawn(blockStateOf(DOC, DOC.length))).toEqual([`frontmatter 0-${String(END)}`])
  })

  it('draws nothing while the caret touches the block, edges included', () => {
    for (const caret of [0, 2, 4, 10, END - 1, END]) {
      expect(drawn(blockStateOf(DOC, caret)), `caret at ${String(caret)}`).toEqual([])
    }
    expect(drawn(blockStateOf(DOC, END + 1))).toEqual([`frontmatter 0-${String(END)}`])
  })

  it('carries the label and the source into the widget', () => {
    const [info] = blocksOf(blockStateOf(DOC, DOC.length))
    expect(info?.widget).toBeInstanceOf(FrontmatterWidget)
    const widget = info?.widget as FrontmatterWidget
    expect(widget.keys).toBe('title, tags')
    expect(widget.source).toBe(FRONT)
  })

  it('is found by a scan that starts before its end, and not by one that starts at its end', () => {
    const state = blockStateOf(DOC, DOC.length)
    const kinds = (from: number): string[] =>
      scanBlocks(state, [{ from, to: DOC.length }]).map((item) => item.kind)
    expect(kinds(0)).toEqual(['frontmatter'])
    expect(kinds(END - 1)).toEqual(['frontmatter'])
    expect(kinds(END)).toEqual([])
  })

  it('treats the same text as the same widget, and other text as another', () => {
    expect(new FrontmatterWidget('a', FRONT).eq(new FrontmatterWidget('a', FRONT))).toBe(true)
    expect(new FrontmatterWidget('a', FRONT).eq(new FrontmatterWidget('a', `${FRONT} `))).toBe(
      false,
    )
  })

  it('draws no table, image or other block inside the range', () => {
    const doc = '---\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![x](y.png)\n\n---\n\nend'
    // The same text without the fences has a table and an image to draw.
    const bare = doc.replace('---\n', '').replace('\n\n---', '')
    expect(drawn(blockStateOf(bare, bare.length)).map((entry) => entry.split(' ')[0])).toEqual([
      'table',
      'image',
    ])
    expect(drawn(blockStateOf(doc, doc.length))).toEqual([
      `frontmatter 0-${String(doc.indexOf('\n\nend'))}`,
    ])
  })

  it('still draws a table right after the block', () => {
    const doc = `${FRONT}\n\n| a |\n|---|\n| 1 |\n\nend`
    const state = blockStateOf(doc, doc.length)
    expect(drawn(state).map((entry) => entry.split(' ')[0])).toEqual(['frontmatter', 'table'])
  })

  it('does not take a rule at the top for frontmatter when nothing closes it', () => {
    expect(drawn(blockStateOf('---\nsome text\n', 0))).toEqual([])
    expect(drawn(blockStateOf('---\n\nsome text\n', 15))).toEqual([])
  })

  it('does not take a block that starts further down for frontmatter', () => {
    const doc = 'intro\n\n---\ntitle: x\n---\n\nend'
    expect(drawn(blockStateOf(doc, doc.length))).toEqual([])
  })

  it('turns on when the closing line is typed below, with nothing near the first line changed', () => {
    const before = blockStateOf('---\ntitle: x\n\nbody text\n', 24)
    expect(drawn(before)).toEqual([])
    const typed = before.update({ changes: { from: before.doc.length, insert: '---\n' } }).state
    const end = typed.doc.toString().lastIndexOf('---')
    expect(drawn(typed.update({ selection: { anchor: typed.doc.length } }).state)).toEqual([
      `frontmatter 0-${String(end + 3)}`,
    ])
  })

  it('turns off when the closing line is deleted', () => {
    const before = blockStateOf(DOC, DOC.length)
    expect(drawn(before)).toHaveLength(1)
    const cut = before.update({ changes: { from: END - 3, to: END } }).state
    expect(drawn(cut)).toEqual([])
  })

  it('turns off when the opening line stops being a fence', () => {
    const before = blockStateOf(DOC, DOC.length)
    const changed = before.update({ changes: { from: 0, insert: 'x' } }).state
    expect(drawn(changed)).toEqual([])
  })

  it('follows an edit inside the block once the caret leaves: one pill, the new label', () => {
    let state = blockStateOf(DOC, 10)
    state = state.update({ changes: { from: 4, insert: 'author: me\n' } }).state
    expect(drawn(state)).toEqual([])
    state = state.update({ selection: { anchor: state.doc.length } }).state
    const pills = blocksOf(state)
    expect(pills).toHaveLength(1)
    expect((pills[0]?.widget as FrontmatterWidget).keys).toBe('author, title, tags')
    expect(pills[0]?.to).toBe(state.doc.toString().indexOf('\n\n# Body'))
  })

  it('comes back as one pill after the caret goes in and out', () => {
    let state = blockStateOf(DOC, DOC.length)
    for (const caret of [5, DOC.length, 0, DOC.length]) {
      state = state.update({ selection: { anchor: caret } }).state
    }
    expect(drawn(state)).toEqual([`frontmatter 0-${String(END)}`])
  })
})

describe('the inline layer leaves the block alone', () => {
  const doc =
    '---\n# not a heading\nkey: **bold** [a](b)\n- [ ] not a task\n---\n\n# Real\n\n- [ ] task\n'

  it('styles and hides nothing inside the range', () => {
    const state = stateOf(doc, doc.length)
    const end = doc.indexOf('\n\n# Real')
    for (const item of scanAll(state)) {
      expect(item.from, `${item.type} at ${String(item.from)}`).toBeGreaterThan(end)
    }
  })

  it('still styles the text after it', () => {
    const state = stateOf(doc, doc.length)
    const items = scanAll(state)
    expect(lineClasses(state, items)).toEqual([`7: cm-md-h cm-md-h1`])
    expect(markedText(state, items)).toContain('cm-md-list-mark: -')
  })

  it('marks every line of the block as plain while a caret touches it, and none otherwise', () => {
    const plain = (caret: number): string[] =>
      lineClasses(stateOf(doc, caret), scanAll(stateOf(doc, caret))).filter((entry) =>
        entry.includes('cm-md-frontmatter-line'),
      )
    const all = ['1', '2', '3', '4', '5'].map((n) => `${n}: cm-md-frontmatter-line`)
    for (const caret of [0, 7, doc.indexOf('\n\n# Real')]) {
      expect(plain(caret), `caret at ${String(caret)}`).toEqual(all)
    }
    expect(plain(doc.length)).toEqual([])
    expect(
      lineClasses(stateOf('# Title\n\ntext', 3), scanAll(stateOf('# Title\n\ntext', 3))),
    ).toEqual(['1: cm-md-h cm-md-h1'])
  })

  it('marks only the lines of the block that a scan covers', () => {
    const state = stateOf(doc, 0)
    const items = scanPreview(state, [{ from: state.doc.line(3).from, to: state.doc.line(4).to }])
    expect(lineClasses(state, items)).toEqual([
      '3: cm-md-frontmatter-line',
      '4: cm-md-frontmatter-line',
    ])
  })

  it('still styles a rule at the top that no closing line follows', () => {
    const state = stateOf('---\n\nafter\n', 11)
    expect(lineClasses(state, scanAll(state))).toEqual(['1: cm-md-hr'])
  })
})

describe('the page', () => {
  it('shows a pill with the label and the keys, and none of the YAML', () => {
    const view = mount(DOC, DOC.length)
    const pill = view.contentDOM.querySelector('.cm-md-frontmatter-pill')
    expect(pill?.querySelector('.cm-md-frontmatter-label')?.textContent).toBe('Frontmatter')
    expect(pill?.querySelector('.cm-md-frontmatter-keys')?.textContent).toBe('title, tags')
    expect(view.contentDOM.textContent).not.toContain('title: Hello')
    expect(view.contentDOM.textContent).toContain('Body')
  })

  it('shows no keys part for a block without keys', () => {
    const view = mount('---\n---\n\nend', 11)
    expect(view.contentDOM.querySelector('.cm-md-frontmatter-pill')).not.toBeNull()
    expect(view.contentDOM.querySelector('.cm-md-frontmatter-keys')).toBeNull()
  })

  it('opens to the YAML when it is pressed, and closes when the caret leaves', () => {
    const view = mount(DOC, DOC.length)
    const wrap = view.contentDOM.querySelector<HTMLElement>('.cm-md-frontmatter')
    expect(wrap).not.toBeNull()
    wrap?.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }))
    expect(view.state.selection.main.head).toBe(0)
    expect(view.contentDOM.querySelector('.cm-md-frontmatter')).toBeNull()
    expect(view.contentDOM.textContent).toContain('title: Hello')
    view.dispatch({ selection: { anchor: DOC.length } })
    expect(view.contentDOM.querySelector('.cm-md-frontmatter-pill')).not.toBeNull()
    expect(view.contentDOM.textContent).not.toContain('title: Hello')
  })

  it('leaves the document itself alone', () => {
    const view = mount(DOC, DOC.length)
    for (let pos = 0; pos <= DOC.length; pos += 2) view.dispatch({ selection: { anchor: pos } })
    expect(view.state.doc.toString()).toBe(DOC)
  })
})
