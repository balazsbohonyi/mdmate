// @vitest-environment jsdom
/**
 * The copy button of a fenced code block (ISC-698 to ISC-702): its place, the text it copies, its
 * feedback, and that it changes nothing about the document, the caret or the hidden syntax.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import { codeCopy, COPIED_MS, type CodeCopy } from '@/editor/livePreview/codeCopy'
import { decorationsFor, hiddenFor } from '@/editor/livePreview'
import { scanAll, stateOf } from '../helpers/preview'

const views: EditorView[] = []
const noCopy: CodeCopy = { write: () => Promise.resolve(), notify: () => undefined }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

interface Setup {
  readonly view: EditorView
  readonly written: string[]
  readonly notes: string[]
}

/** A view of `doc` with the copy button wired to a recorder, or to a clipboard that fails. */
function open(
  doc: string,
  options: { fail?: boolean; caret?: number; wired?: boolean } = {},
): Setup {
  const written: string[] = []
  const notes: string[] = []
  const copy: CodeCopy = {
    write: (text) => {
      if (options.fail === true) return Promise.reject(new Error('denied'))
      written.push(text)
      return Promise.resolve()
    },
    notify: (message) => notes.push(message),
  }
  const parent = document.createElement('div')
  document.body.append(parent)
  const state = createState(doc, [options.wired === false ? [] : codeCopy.of(copy)], {
    preview: true,
  })
  const view = createView(parent, state)
  if (options.caret !== undefined) view.dispatch({ selection: { anchor: options.caret } })
  views.push(view)
  return { view, written, notes }
}

const buttons = (view: EditorView): HTMLElement[] => [
  ...view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-copy'),
]

/** Clicks the first button and lets the write settle. */
async function click(view: EditorView, at = 0): Promise<HTMLElement> {
  const button = buttons(view)[at]
  if (button === undefined) throw new Error('no copy button')
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await vi.advanceTimersByTimeAsync(0)
  return button
}

describe('a button on every fenced code block (ISC-699)', () => {
  it('shows one button, with the fences hidden and with the caret inside', () => {
    const doc = 'intro\n\n```ts\nconst x = 1\n```\n\nend'
    expect(buttons(open(doc).view)).toHaveLength(1)
    expect(buttons(open(doc, { caret: doc.indexOf('const') }).view)).toHaveLength(1)
  })

  it('shows it for a block with no language and for two blocks apart', () => {
    expect(buttons(open('```\na\n```').view)).toHaveLength(1)
    expect(buttons(open('```js\na\n```\n\n~~~\nb\n~~~').view)).toHaveLength(2)
  })

  it('shows it for a block in a list item and in a quote', () => {
    expect(buttons(open('- item\n\n  ```js\n  a\n  ```').view)).toHaveLength(1)
    expect(buttons(open('> ```js\n> a\n> ```').view)).toHaveLength(1)
  })

  it('shows none for an indented code block, and none without a way to copy', () => {
    expect(buttons(open('para\n\n    indented\n    code').view)).toHaveLength(0)
    expect(buttons(open('```js\na\n```', { wired: false }).view)).toHaveLength(0)
  })

  it('is a button for a screen reader, with a hint drawn by the editor', () => {
    const [button] = buttons(open('```js\na\n```').view)
    expect(button?.getAttribute('role')).toBe('button')
    expect(button?.getAttribute('aria-label')).toBe('Copy code')
    expect(button?.dataset.hint).toBe('Copy code')
    expect(button?.hasAttribute('title')).toBe(false)
  })
})

describe('what a click copies (ISC-700)', () => {
  const cases: [string, string, string][] = [
    ['a block with a language', '```ts\nconst x = 1\nlet y = 2\n```', 'const x = 1\nlet y = 2'],
    ['a block with no language', '```\none\ntwo\n```', 'one\ntwo'],
    ['an empty block', '```\n```', ''],
    ['a block with blank lines inside', '```\na\n\n\nb\n```', 'a\n\n\nb'],
    ['a longer fence around a shorter one', '````\n```\nx\n```\n````', '```\nx\n```'],
    ['a tilde fence', '~~~py\nprint(1)\n~~~', 'print(1)'],
    ['an unclosed block', 'text\n\n```\nnever closed\nstill code', 'never closed\nstill code'],
    ['a document with CRLF line breaks', '```\r\na\r\nb\r\n```', 'a\nb'],
    ['a fence indented by two spaces', '  ```\n  a\n    b\n  ```', 'a\n  b'],
    ['a block in a list item', '- item\n\n  ```js\n  a\n    b\n  ```', 'a\n  b'],
    ['a block in a quote', '> ```js\n> a\n>   b\n> ```', 'a\n  b'],
  ]

  it.each(cases)('copies the text between the fences of %s', async (_name, doc, expected) => {
    const { view, written } = open(doc)
    await click(view)
    expect(written).toEqual([expected])
  })

  it('copies the block that was clicked when there are two', async () => {
    const { view, written } = open('```\nfirst\n```\n\n```\nsecond\n```')
    await click(view, 1)
    await click(view, 0)
    expect(written).toEqual(['second', 'first'])
  })

  it('copies the block as it is now, after an edit above it', async () => {
    const { view, written } = open('```\nold\n```')
    view.dispatch({ changes: { from: 0, insert: 'new line\n\n' } })
    view.dispatch({
      changes: { from: view.state.doc.toString().indexOf('old'), to: 14 + 3, insert: 'newer' },
    })
    await click(view)
    expect(written).toEqual(['newer'])
  })

  it('leaves the document and the caret alone, and takes the press away from the editor', async () => {
    const doc = 'intro\n\n```ts\nconst x = 1\n```\n\nend'
    const { view } = open(doc, { caret: 3 })
    const button = buttons(view)[0]!
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
    await click(view)
    expect(view.state.doc.toString()).toBe(doc)
    expect(view.state.selection.main.head).toBe(3)
  })
})

describe('what the button shows after a click (ISC-701)', () => {
  it('turns into a check mark for a moment, then is the copy icon again', async () => {
    const { view } = open('```\na\n```')
    const button = buttons(view)[0]!
    expect(button.dataset.copied).toBeUndefined()
    const before = button.innerHTML
    await click(view)
    expect(button.dataset.copied).toBe('true')
    expect(button.innerHTML).not.toBe(before)
    await vi.advanceTimersByTimeAsync(COPIED_MS - 1)
    expect(button.dataset.copied).toBe('true')
    await vi.advanceTimersByTimeAsync(2)
    expect(button.dataset.copied).toBeUndefined()
    expect(button.innerHTML).toBe(before)
  })

  it('tells the user and shows no check mark when the write fails', async () => {
    const { view, notes } = open('```\na\n```', { fail: true })
    const button = await click(view)
    expect(button.dataset.copied).toBeUndefined()
    expect(notes).toEqual(['Could not copy the code: denied'])
  })
})

describe('the button changes nothing around it (ISC-702)', () => {
  const doc = 'intro\n\n```ts\nconst x = 1\n```\n\n> ```\n> q\n> ```\n\nend'

  it('is no step for the caret: the hidden ranges are the same with and without it', () => {
    const ranges = (set: ReturnType<typeof hiddenFor>): [number, number][] => {
      const found: [number, number][] = []
      for (const cursor = set.iter(); cursor.value !== null; cursor.next())
        found.push([cursor.from, cursor.to])
      return found
    }
    const without = ranges(hiddenFor(scanAll(stateOf(doc, 0))))
    const withButton = ranges(hiddenFor(scanAll(stateOf(doc, 0, codeCopy.of(noCopy)))))
    expect(without.length).toBeGreaterThan(0)
    expect(withButton).toEqual(without)
  })

  it('takes no room: the widget is drawn out of the flow, so the block keeps its height', () => {
    const { view } = open(doc)
    const button = buttons(view)[0]!
    expect(button.tagName).toBe('SPAN')
    // The rule that takes it out of the flow is in the theme CodeMirror injected.
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n')
    expect(css.replace(/\s+/g, '')).toMatch(/\.cm-md-copy\{[^}]*position:absolute/)
  })

  it('is not part of a copy of a selection across the block', () => {
    const { view } = open(doc)
    const from = 0
    const to = view.state.doc.length
    expect(view.state.sliceDoc(from, to)).toBe(doc)
    expect(view.contentDOM.querySelectorAll('.cm-md-copy').length).toBeGreaterThan(0)
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('is a point widget before the fence, one for each block, and no replacement', () => {
    const items = scanAll(stateOf(doc, 0, codeCopy.of(noCopy)))
    const at = items.flatMap((item) => (item.type === 'copy' ? [item.at] : []))
    expect(at).toEqual([doc.indexOf('```ts'), doc.indexOf('```\n> q')])
    const cursor = decorationsFor([{ type: 'copy', at: 7 }]).iter()
    expect([cursor.from, cursor.to]).toEqual([7, 7])
  })
})

describe('the label and the button sit at opposite corners (ISC-698)', () => {
  it('draws the language label at the left and puts no label rule at the right', () => {
    open('```ts\na\n```')
    const css = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
      .replace(/\s+/g, '')
    const rule = /\.cm-md-box-first\[data-box-label\]::after[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('left:1em')
    expect(rule).not.toContain('right:')
    const copy = /\.cm-md-copy\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(copy).toContain('right:')
    expect(copy).not.toContain('left:')
  })
})
