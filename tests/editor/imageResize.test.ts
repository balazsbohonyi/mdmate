// @vitest-environment jsdom
/**
 * Selecting, resizing and deleting an image (P9-T4): the text a resize writes (ISC-158, ISC-159,
 * ISC-326), what a selection does with the keys, the handle and a drag, and a delete with its undo
 * through the real document (ISC-325). The look of the outline and the handle, and a real drag,
 * are checked in the real window (ISC-157, ISC-322).
 */
import { history, undo } from '@codemirror/commands'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { documentOfTab, followerOfTab, openPath, resetDocuments } from '@/documents/store'
import { resetUntitled } from '@/documents/untitled'
import { createState, createView } from '@/editor/create'
import {
  imageContext,
  resetImageSizes,
  resolveImageAddress,
  scanBlocks,
  selectedImageOf,
  selectImage,
  type ImageItem,
} from '@/editor/livePreview/blocks'
import {
  MIN_IMAGE_WIDTH,
  resizeEdits,
  type ResizeTarget,
} from '@/editor/livePreview/blocks/imageEdit'
import { contentWidth } from '@/editor/livePreview/blocks/imageHandle'
import { parseImgTag, widthEdits, type TextEdit } from '@/editor/livePreview/blocks/imageTag'
import { resetTree } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'

function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let result = text
  // From the end, so an earlier offset is still right; a tie goes to the later edit first.
  for (const edit of [...edits].reverse()) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to)
  }
  return result
}

/** Every `width` and `height` attribute taken out, by a rule that knows nothing of the code under test. */
function withoutSizes(tag: string): string {
  return tag.replace(
    /\s+(?:width|height)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?(?=[\s/>])/gi,
    '',
  )
}

describe('the width written into an <img> tag (ISC-158, ISC-326)', () => {
  const set = (tag: string, width = 80): string | null => {
    const edits = widthEdits(tag, width)
    return edits === null ? null : applyEdits(tag, edits)
  }

  it('sets the width the tag has, keeping its quotes', () => {
    expect(set('<img src="a.png" width="50">')).toBe('<img src="a.png" width="80">')
    expect(set("<img src='a.png' width='50'>")).toBe("<img src='a.png' width='80'>")
    expect(set('<img src="a.png" WIDTH="50px" alt="x">')).toBe(
      '<img src="a.png" WIDTH="80" alt="x">',
    )
    expect(set('<img src=a.png width=50>')).toBe('<img src=a.png width="80">')
    expect(set('<img src="a.png" width>')).toBe('<img src="a.png" width="80">')
  })

  it('adds a width after the last attribute when it has none, before the closing', () => {
    expect(set('<img src="a.png" alt="x">')).toBe('<img src="a.png" alt="x" width="80">')
    expect(set('<img src="a.png"/>')).toBe('<img src="a.png" width="80"/>')
    expect(set('<img src="a.png" />')).toBe('<img src="a.png" width="80" />')
    expect(set('<img src="a.png"  >')).toBe('<img src="a.png" width="80"  >')
  })

  it('drops the height, and nothing else but the width changes (ISC-326)', () => {
    expect(set('<img src="a.png" width="50" height="40">')).toBe('<img src="a.png" width="80">')
    expect(set('<img height="40" src="a.png" width="50">')).toBe('<img src="a.png" width="80">')
    expect(set('<img src="a.png" height="40">')).toBe('<img src="a.png" width="80">')
    expect(set('<img height=40 src="a.png" alt="x" />')).toBe(
      '<img src="a.png" alt="x" width="80" />',
    )
    expect(set('<img src="a.png" alt="keep  me" height="40" title="t"/>')).toBe(
      '<img src="a.png" alt="keep  me" title="t" width="80"/>',
    )
  })

  it('sets the first width, the one a browser reads, and removes every height', () => {
    expect(set('<img src="a.png" width="1" width="9" height="3" height="4">', 7)).toBe(
      '<img src="a.png" width="7" width="9">',
    )
  })

  it('keeps the whitespace around the tag', () => {
    expect(set('  <img src="a.png">\t')).toBe('  <img src="a.png" width="80">\t')
  })

  it('has nothing to do when the tag already says it', () => {
    expect(widthEdits('<img src="a.png" width="80">', 80)).toEqual([])
    expect(widthEdits('<img src="a.png" width="80px">', 80)).not.toEqual([])
    expect(set('<img src="a.png" height="9" width="80">')).toBe('<img src="a.png" width="80">')
  })

  it('is not asked about text that is not one tag', () => {
    for (const text of [
      'hello',
      '<img src="a.png"> more',
      '<img src="a.png"\nwidth="5">',
      '<div>',
    ]) {
      expect(widthEdits(text, 80), text).toBeNull()
    }
  })

  it('changes only the width and the height of a tag, whatever its shape (ISC-159, ISC-326)', () => {
    let seed = 20261113
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T
    const spaces = (): string => pick([' ', '  ', '\t', ' \t '])
    const name = (n: string): string => pick([n, n.toUpperCase(), n[0]?.toUpperCase() + n.slice(1)])
    let closing = '>'
    const attribute = (n: string, value: string): string => {
      const bare = !value.includes(' ') && closing !== '/>'
      const style = bare ? pick(['"', "'", '']) : pick(['"', "'"])
      const around = pick(['', ' ', '  '])
      return style === ''
        ? `${name(n)}${around}=${around}${value}`
        : `${name(n)}${around}=${around}${style}${value}${style}`
    }
    for (let round = 0; round < 3000; round++) {
      closing = pick(['>', ' >', '/>', ' />'])
      const parts = [attribute('src', pick(['a.png', 'sub/a b.png', 'https://example.com/a.png']))]
      if (next() < 0.5) parts.push(attribute('alt', pick(['x', 'a b', 'q&amp;r'])))
      if (next() < 0.3) parts.push(attribute('title', pick(['t', 'the title'])))
      if (next() < 0.3) parts.push(attribute('class', 'c'))
      if (next() < 0.7)
        parts.push(next() < 0.15 ? name('width') : attribute('width', pick(['50', '50px', '7'])))
      if (next() < 0.5) parts.push(attribute('height', pick(['40', '40px'])))
      if (next() < 0.2) parts.push(attribute('width', '9'))
      if (next() < 0.2) parts.push(attribute('height', '3'))
      for (let i = parts.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[parts[i], parts[j]] = [parts[j]!, parts[i]!]
      }
      const tag = `<img${parts.map((part) => spaces() + part).join('')}${closing}`
      const source = pick(['', '  ']) + tag + pick(['', ' ', '\t'])
      const width = 1 + Math.floor(next() * 3000)
      const edits = widthEdits(source, width)
      expect(edits, source).not.toBeNull()
      const after = applyEdits(source, edits ?? [])
      const body = after.trim()
      // The only differences are the sizes ...
      expect(withoutSizes(body), `${source} -> ${after}`).toBe(withoutSizes(tag))
      // ... the outside is untouched ...
      expect(after.slice(0, after.length - after.trimStart().length)).toBe(
        source.slice(0, source.length - source.trimStart().length),
      )
      expect(after.slice(after.trimEnd().length)).toBe(source.slice(source.trimEnd().length))
      // ... and the tag now says the width, no height, and everything else it said.
      const before = parseImgTag(tag)
      const now = parseImgTag(body)
      expect(now, after).not.toBeNull()
      expect(now?.width, after).toBe(width)
      expect(now?.height, after).toBeNull()
      expect({ ...now, width: 0, height: null }).toEqual({ ...before, width: 0, height: null })
    }
  })
})

describe('a Markdown image written as an <img> tag (ISC-158)', () => {
  const target = (over: Partial<ResizeTarget> & { address: string }): ResizeTarget => ({
    source: `![${over.alt ?? ''}](${over.address})`,
    html: false,
    alt: '',
    title: null,
    joinsNext: false,
    lineBreak: '\n',
    ...over,
  })
  const write = (t: ResizeTarget, width = 100): string | null => {
    const edits = resizeEdits(t, width)
    return edits === null ? null : applyEdits(t.source, edits)
  }

  it('gives the address, the label, the title and the width', () => {
    expect(write(target({ address: 'a.png', alt: 'An A' }))).toBe(
      '<img src="a.png" alt="An A" width="100">',
    )
    expect(write(target({ address: 'a.png', source: '![](a.png)' }))).toBe(
      '<img src="a.png" width="100">',
    )
    expect(
      write(target({ address: 'a.png', alt: 'A', title: 'The A', source: '![A](a.png "The A")' })),
    ).toBe('<img src="a.png" alt="A" title="The A" width="100">')
  })

  it('keeps the whitespace around it and rounds the width', () => {
    expect(write(target({ address: 'a.png', source: '  ![](a.png) ' }), 99.6)).toBe(
      '  <img src="a.png" width="100"> ',
    )
  })

  it('reads back as the same address, label and title, whatever they hold', () => {
    const folder = 'C:/notes/docs'
    for (const [address, alt, title] of [
      ['a.png', 'plain', null],
      ['<a b.png>', 'spaces', null],
      ['a%20b.png', 'encoded', null],
      ['sub/a\\_b.png', 'backslash', null],
      ['https://example.com/a.png?x=1&y=2#z', 'remote', 'T'],
      ['a.png', 'say "hi" <b> & co', 'a "quoted" <t> & b'],
      ['a.png', 'two\nlines', 'and\ntwo'],
      ['a.png', '&amp; kept as written', '&lt;'],
      ['a.png', "it's", "it's"],
      ['http://example.invalid/a.png', 'refused', null],
    ] as const) {
      const t = target({ address, alt, title, source: `![${alt}](${address})` })
      const text = write(t)
      expect(text, address).not.toBeNull()
      const back = parseImgTag(text ?? '')
      expect(back, text ?? '').not.toBeNull()
      expect(back?.alt).toBe(alt.replace(/\s*\n\s*/g, ' '))
      expect(back?.title).toBe(title === null ? null : title.replace(/\s*\n\s*/g, ' '))
      expect(back?.width).toBe(100)
      expect(resolveImageAddress(back?.src ?? '', folder, folder)).toEqual(
        resolveImageAddress(address, folder, folder),
      )
    }
  })

  it('does nothing rather than write a tag that says something else', () => {
    expect(write(target({ address: '' }))).toBeNull()
    expect(write(target({ address: '<>' }))).toBeNull()
    expect(write(target({ address: 'a.png' }), 0)).toBeNull()
    expect(write(target({ address: 'a.png' }), Number.NaN)).toBeNull()
  })

  it('ends the tag with a line break when the next line would join its HTML block', () => {
    const t = target({ address: 'a.png', source: '![](a.png)', joinsNext: true })
    expect(write(t)).toBe('<img src="a.png" width="100">\n')
    expect(write({ ...t, lineBreak: '\r\n' })).toBe('<img src="a.png" width="100">\r\n')
    // A tag already is an HTML block: nothing is added.
    expect(write({ ...t, html: true, source: '<img src="a.png">', address: 'a.png' })).toBe(
      '<img src="a.png" width="100">',
    )
  })

  it('has a smallest width', () => {
    expect(MIN_IMAGE_WIDTH).toBe(24)
  })
})

const folderContext = imageContext.of({
  folder: () => '/notes/docs',
  boundary: () => null,
  url: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
})

const views: EditorView[] = []
function mount(doc: string, caret = doc.length, extra: Extension = []): EditorView {
  const parent = document.body.appendChild(document.createElement('div'))
  const state = createState(doc, [folderContext, history(), extra], { preview: true })
  const view = createView(parent, state)
  views.push(view)
  view.dispatch({ selection: { anchor: caret } })
  return view
}

beforeAll(() => {
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
  resetImageSizes()
})

function key(view: EditorView, name: string): boolean {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  return runScopeHandlers(view, event, 'editor')
}

const image = (view: EditorView): HTMLElement | null =>
  view.contentDOM.querySelector<HTMLElement>('.cm-md-image-frame')
const handleOf = (view: EditorView): HTMLElement | null =>
  view.contentDOM.querySelector<HTMLElement>('.cm-md-image-handle')

/** A press on the first picture on the page. */
function press(view: EditorView): void {
  const img = view.contentDOM.querySelector('.cm-md-image-frame img')
  if (img === null) throw new Error('no picture to press')
  img.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
}

/** The picture finishes loading at this size. */
async function load(view: EditorView, width = 400, height = 200): Promise<void> {
  const img = view.contentDOM.querySelector('.cm-md-image-frame img')
  if (img === null) throw new Error('no picture')
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true })
  img.dispatchEvent(new Event('load'))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function items(state: EditorState): ImageItem[] {
  return scanBlocks(state, [{ from: 0, to: state.doc.length }]).filter(
    (item): item is ImageItem => item.kind === 'image',
  )
}

describe('selecting an image (ISC-322)', () => {
  const doc = 'top\n\n![a](a.png)\n\nbottom'

  it('a press selects it: outlined, drawn, the caret and the text where they were', () => {
    const view = mount(doc)
    const caret = view.state.selection.main.head
    press(view)
    expect(selectedImageOf(view.state)).toEqual({
      from: doc.indexOf('!['),
      to: doc.indexOf(')') + 1,
    })
    expect(view.contentDOM.querySelector('.cm-md-image-selected')).not.toBeNull()
    expect(view.dom.classList.contains('cm-image-selected')).toBe(true)
    expect(image(view)).not.toBeNull()
    expect(view.contentDOM.textContent).not.toContain('![a]')
    expect(view.state.selection.main.head).toBe(caret)
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('a caret that moves onto a selected image drops the selection and shows the source', () => {
    const view = mount(doc, 0)
    press(view)
    // Selecting again is no change, and the image stays drawn.
    view.dispatch({ effects: selectImage.of(selectedImageOf(view.state)) })
    expect(image(view)).not.toBeNull()
    view.dispatch({ selection: { anchor: doc.indexOf('![a]') } })
    expect(selectedImageOf(view.state)).toBeNull()
    expect(image(view)).toBeNull()
    expect(view.contentDOM.textContent).toContain('![a](a.png)')
  })

  it('Escape drops the selection and leaves the picture drawn and the caret alone', () => {
    const view = mount(doc)
    expect(key(view, 'Escape')).toBe(false)
    press(view)
    const caret = view.state.selection.main.head
    expect(key(view, 'Escape')).toBe(true)
    expect(selectedImageOf(view.state)).toBeNull()
    expect(view.contentDOM.querySelector('.cm-md-image-selected')).toBeNull()
    expect(view.dom.classList.contains('cm-image-selected')).toBe(false)
    expect(image(view)).not.toBeNull()
    expect(view.state.selection.main.head).toBe(caret)
  })

  it('a press anywhere else, or a move of the caret, drops it', () => {
    const view = mount(doc)
    press(view)
    view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(selectedImageOf(view.state)).toBeNull()
    press(view)
    view.dispatch({ selection: { anchor: 1 } })
    expect(selectedImageOf(view.state)).toBeNull()
    expect(image(view)).not.toBeNull()
  })

  it('a press on another image moves the selection to it', () => {
    const two = 'top\n\n![a](a.png)\n\n![b](b.png)\n\nend'
    const view = mount(two)
    press(view)
    const second = view.contentDOM.querySelectorAll('.cm-md-image-frame img')[1]
    second?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
    )
    expect(selectedImageOf(view.state)?.from).toBe(two.indexOf('![b]'))
    expect(view.contentDOM.querySelectorAll('.cm-md-image-selected')).toHaveLength(1)
  })

  it('Enter and the arrow keys put the caret into the source and show it', () => {
    const cases: [string, number][] = [
      ['Enter', doc.indexOf(')') + 1],
      ['ArrowRight', doc.indexOf('![a]')],
      ['ArrowDown', doc.indexOf('![a]')],
      ['ArrowLeft', doc.indexOf(')') + 1],
      ['ArrowUp', doc.indexOf(')') + 1],
    ]
    for (const [name, caret] of cases) {
      const view = mount(doc)
      press(view)
      expect(key(view, name), name).toBe(true)
      expect(selectedImageOf(view.state), name).toBeNull()
      expect(view.state.selection.main.head, name).toBe(caret)
      expect(image(view), name).toBeNull()
      expect(view.contentDOM.textContent, name).toContain('![a](a.png)')
    }
  })

  it('typing and a paste do nothing but drop the selection; cut and copy take its source', () => {
    const view = mount(doc)
    press(view)
    const typed = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true })
    view.contentDOM.dispatchEvent(typed)
    expect(typed.defaultPrevented).toBe(true)
    expect(selectedImageOf(view.state)).toBeNull()

    press(view)
    const pasted = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasted, 'clipboardData', { value: { getData: () => 'text', files: [] } })
    view.contentDOM.dispatchEvent(pasted)
    expect(pasted.defaultPrevented).toBe(true)
    expect(selectedImageOf(view.state)).toBeNull()
    expect(view.state.doc.toString()).toBe(doc)

    for (const [type, removed] of [
      ['copy', false],
      ['cut', true],
    ] as const) {
      const v = mount(doc)
      press(v)
      let text = ''
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: { setData: (_: string, value: string) => (text = value) },
      })
      v.contentDOM.dispatchEvent(event)
      expect(text, type).toBe('![a](a.png)')
      expect(v.state.doc.toString() === doc, type).toBe(!removed)
    }
  })

  it('a change to the text drops it', () => {
    const view = mount(doc)
    press(view)
    view.dispatch({ changes: { from: 0, insert: 'x' } })
    expect(selectedImageOf(view.state)).toBeNull()
  })
})

describe('the handle (ISC-157)', () => {
  const doc = 'top\n\n![a](a.png)\n\nbottom'

  it('shows on a selected picture once it has loaded, not before and not on a broken one', async () => {
    const view = mount(doc)
    expect(handleOf(view)).toBeNull()
    press(view)
    expect(handleOf(view)).toBeNull()
    await load(view)
    expect(handleOf(view)).not.toBeNull()
    expect(image(view)?.contains(handleOf(view))).toBe(true)

    const broken = mount(doc)
    press(broken)
    broken.contentDOM.querySelector('.cm-md-image-frame img')?.dispatchEvent(new Event('error'))
    expect(handleOf(broken)).toBeNull()
    expect(broken.contentDOM.querySelector('.cm-md-image-selected')).not.toBeNull()
  })

  it('goes with the selection, and a picture that was never selected has none', async () => {
    const view = mount(doc)
    await load(view)
    expect(handleOf(view)).toBeNull()
    press(view)
    await load(view)
    expect(handleOf(view)).not.toBeNull()
    key(view, 'Escape')
    expect(handleOf(view)).toBeNull()
  })

  it('is on an inline picture and on an <img> tag, local or https', async () => {
    for (const text of [
      'one ![a](a.png) two',
      'one <img src="a.png" width="50"> two',
      '<img src="https://example.com/a.png" width="50">\n\nend',
      '![r](https://example.com/a.png)\n\nend',
    ]) {
      const view = mount(text, text.length)
      press(view)
      await load(view)
      expect(handleOf(view), text).not.toBeNull()
    }
  })

  /** Presses the handle at `x`, moves to `to` and releases; the frame is `width` wide on the page. */
  function drag(view: EditorView, width: number, to: number, content = 500): void {
    const frame = image(view)
    const handle = handleOf(view)
    if (frame === null || handle === null) throw new Error('no handle')
    frame.getBoundingClientRect = () => ({ width }) as DOMRect
    view.contentDOM.getBoundingClientRect = () => ({ width: content }) as DOMRect
    const at = (type: string, x: number): void => {
      handle.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x }),
      )
    }
    at('pointerdown', 100)
    at('pointermove', to)
    at('pointerup', to)
  }

  it('a drag writes the width once, as an <img> tag, and keeps the image selected (ISC-158)', async () => {
    const view = mount(doc)
    press(view)
    await load(view)
    const before = view.state.doc.toString()
    const frame = image(view)
    const handle = handleOf(view)
    if (frame === null || handle === null) throw new Error('no handle')
    frame.getBoundingClientRect = () => ({ width: 200 }) as DOMRect
    view.contentDOM.getBoundingClientRect = () => ({ width: 500 }) as DOMRect
    const send = (type: string, x: number): void => {
      handle.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x }),
      )
    }
    send('pointerdown', 100)
    send('pointermove', 130)
    // While the pointer is down only the picture moves: the text is still what it was.
    expect(frame.style.maxWidth).toBe('230px')
    expect(view.state.doc.toString()).toBe(before)
    send('pointermove', 150)
    expect(view.state.doc.toString()).toBe(before)
    send('pointerup', 150)
    expect(view.state.doc.toString()).toBe('top\n\n<img src="a.png" alt="a" width="250">\n\nbottom')
    const [item] = items(view.state)
    expect(item).toMatchObject({ html: true, width: 250, alt: 'a' })
    expect(selectedImageOf(view.state)).toEqual({ from: item?.from, to: item?.to })
    expect(view.contentDOM.querySelector('.cm-md-image-selected')).not.toBeNull()
  })

  it('is one step of undo, which brings the Markdown image back', async () => {
    const view = mount(doc)
    press(view)
    await load(view)
    drag(view, 200, 160)
    expect(view.state.doc.toString()).toContain('<img')
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(doc)
    expect(undo(view)).toBe(false)
  })

  it('keeps the width between 24 pixels and the width of the text, and upscales freely', async () => {
    let limit = 0
    const width = async (to: number): Promise<number | null> => {
      const view = mount(doc)
      press(view)
      await load(view, 100, 50)
      drag(view, 100, to, 500)
      // The text column: the width of the editor less the padding the theme gives it.
      limit = contentWidth(view)
      return items(view.state)[0]?.width ?? null
    }
    expect(await width(-9999)).toBe(24)
    expect(await width(100 - 90)).toBe(24)
    expect(await width(100 + 300)).toBe(400)
    expect(await width(100 + 9999)).toBe(limit)
    expect(limit).toBeGreaterThan(400)
    expect(limit).toBeLessThanOrEqual(500)
    expect(await width(100 + 41)).toBe(141)
  })

  it('writes nothing when the pointer is released where it started, or the drag is cancelled', async () => {
    const view = mount(doc)
    press(view)
    await load(view)
    drag(view, 200, 100)
    expect(view.state.doc.toString()).toBe(doc)

    const frame = image(view)
    const handle = handleOf(view)
    if (frame === null || handle === null) throw new Error('no handle')
    frame.getBoundingClientRect = () => ({ width: 200 }) as DOMRect
    frame.style.maxWidth = '300px'
    handle.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 100 }),
    )
    handle.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 160 }))
    expect(frame.style.maxWidth).toBe('260px')
    handle.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }))
    expect(frame.style.maxWidth).toBe('300px')
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('an inline picture takes the width on its own box, and an <img> keeps all but its sizes', async () => {
    const inline = mount('one ![a](a.png) two', 0)
    press(inline)
    await load(inline)
    const frame = image(inline)
    if (frame === null) throw new Error('no frame')
    drag(inline, 100, 180)
    expect(inline.state.doc.toString()).toBe('one <img src="a.png" alt="a" width="180"> two')

    const tag = mount('<img src="a.png" alt="x y" width="50" height="40" class="k">\n\nend')
    press(tag)
    await load(tag)
    drag(tag, 50, 180)
    expect(tag.state.doc.toString()).toBe(
      '<img src="a.png" alt="x y" width="130" class="k">\n\nend',
    )
  })

  it('leaves the text outside the image as it was, in LF and CRLF documents (ISC-159)', async () => {
    for (const eol of ['\n', '\r\n']) {
      const text = ['# Title', '', 'before  ', '', '  ![a](a.png)  ', '', 'after', ''].join(eol)
      // The document keeps its own line break, as a file with CRLF endings does.
      const view = mount(text, 0, EditorState.lineSeparator.of(eol))
      expect(view.state.lineBreak).toBe(eol)
      press(view)
      await load(view)
      drag(view, 100, 150)
      const out = view.state.doc.sliceString(0, view.state.doc.length, eol)
      const at = text.indexOf('![a]')
      const end = text.indexOf(')') + 1
      expect(out.startsWith(text.slice(0, at)), JSON.stringify(eol)).toBe(true)
      expect(out.endsWith(text.slice(end)), JSON.stringify(eol)).toBe(true)
      expect(out.slice(at, out.length - (text.length - end))).toBe(
        '<img src="a.png" alt="a" width="150">',
      )
    }
  })

  it('keeps a caption on the next line out of the tag’s HTML block, with one line break (ISC-159)', async () => {
    const text = 'top\n\n![a](a.png)\n_caption_\n\nend\n'
    const view = mount(text, 0)
    press(view)
    await load(view)
    drag(view, 100, 150)
    expect(view.state.doc.toString()).toBe(
      'top\n\n<img src="a.png" alt="a" width="150">\n\n_caption_\n\nend\n',
    )
    expect(items(view.state)).toHaveLength(1)
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(text)

    // The same image after a line of text is part of that paragraph: no line break is needed.
    const inside = 'top\n![a](a.png)\n_caption_\n'
    const second = mount(inside, 0)
    press(second)
    await load(second)
    drag(second, 100, 150)
    expect(second.state.doc.toString()).toBe(
      'top\n<img src="a.png" alt="a" width="150">\n_caption_\n',
    )
    expect(items(second.state)).toHaveLength(1)

    // And two pictures on neighbouring lines: resizing the first leaves the second a picture.
    const pair = '![a](a.png)\n![b](b.png)\n'
    const both = mount(pair, pair.length)
    press(both)
    await load(both)
    drag(both, 100, 150)
    expect(both.state.doc.toString()).toBe('<img src="a.png" alt="a" width="150">\n\n![b](b.png)\n')
    expect(items(both.state)).toHaveLength(2)
  })

  it('does not write when the text changed under the widget', async () => {
    const view = mount(doc)
    press(view)
    await load(view)
    const handle = handleOf(view)
    const frame = image(view)
    if (handle === null || frame === null) throw new Error('no handle')
    frame.getBoundingClientRect = () => ({ width: 200 }) as DOMRect
    handle.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 100 }),
    )
    handle.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 150 }))
    // Another edit lands while the pointer is down: the widget is redrawn, which ends the drag.
    view.dispatch({
      changes: { from: doc.indexOf('a.png'), to: doc.indexOf('a.png') + 1, insert: 'b' },
    })
    handle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 150 }))
    expect(view.state.doc.toString()).toBe(doc.replace('a.png', 'b.png'))
  })
})

describe('deleting an image (ISC-325)', () => {
  const doc = 'top\n\n![a](a.png)\n\nbottom'

  it('Delete and Backspace remove the whole source, and one undo brings it back', () => {
    for (const name of ['Delete', 'Backspace']) {
      const view = mount(doc)
      press(view)
      expect(key(view, name), name).toBe(true)
      expect(view.state.doc.toString(), name).toBe('top\n\n\n\nbottom')
      expect(selectedImageOf(view.state), name).toBeNull()
      expect(undo(view), name).toBe(true)
      expect(view.state.doc.toString(), name).toBe(doc)
      expect(undo(view), name).toBe(false)
      expect(image(view), name).not.toBeNull()
    }
  })

  it('removes an <img> tag and an inline picture the same way, and nothing around them', () => {
    const tag = mount('one\n\n  <img src="a.png" width="9">  \n\nend', 0)
    press(tag)
    key(tag, 'Delete')
    expect(tag.state.doc.toString()).toBe('one\n\n\n\nend')
    const inline = mount('one ![a](a.png) two', 0)
    press(inline)
    key(inline, 'Backspace')
    expect(inline.state.doc.toString()).toBe('one  two')
  })

  it('does not merge with the typing before it, so one undo takes back only the delete', () => {
    const inline = 'x![a](a.png) end'
    const view = mount(inline)
    // A deletion right beside it, a moment before, is what history would join the next one to.
    view.dispatch({
      changes: { from: 0, to: 1 },
      selection: { anchor: inline.length - 1 },
      userEvent: 'delete.forward',
    })
    press(view)
    key(view, 'Delete')
    expect(view.state.doc.toString()).toBe(' end')
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('![a](a.png) end')
  })
})

describe('through the real document (ISC-325, ISC-158)', () => {
  const text = 'top\n\n![a](a.png)\n\nbottom\n'
  let host: ReturnType<typeof createMockHost>

  beforeEach(() => {
    host = createMockHost({ files: { 'C:/notes/a.md': text } })
    setHost(host)
    resetWorkbench()
    resetDocuments()
    resetUntitled()
    resetTree()
  })

  afterEach(() => {
    resetTree()
    resetWorkbench()
    resetDocuments()
    setHost(undefined)
  })

  async function shown() {
    const tab = await openPath('C:/notes/a.md')
    const follower = followerOfTab(tab)
    if (follower === undefined) throw new Error('no follower')
    const view = createView(
      document.body.appendChild(document.createElement('div')),
      follower.state,
    )
    views.push(view)
    follower.show(view)
    return { tab, follower, view, doc: documentOfTab(tab) }
  }

  it('a delete is one step of undo on the document, and the text comes back whole', async () => {
    const { follower, view, doc } = await shown()
    view.dispatch({ selection: { anchor: 0 } })
    view.dispatch({
      changes: { from: 0, insert: 'x' },
      selection: { anchor: 1 },
      userEvent: 'input.type',
    })
    const typed = doc?.master.doc.toString()
    press(view)
    expect(key(view, 'Delete')).toBe(true)
    expect(doc?.master.doc.toString()).toBe(typed?.replace('![a](a.png)', ''))
    expect(follower.undo()).toBe(true)
    expect(doc?.master.doc.toString()).toBe(typed)
  })

  it('a resize is one step of undo on the document', async () => {
    const { follower, view, doc } = await shown()
    press(view)
    await load(view)
    const handle = handleOf(view)
    const frame = image(view)
    if (handle === null || frame === null) throw new Error('no handle')
    frame.getBoundingClientRect = () => ({ width: 100 }) as DOMRect
    view.contentDOM.getBoundingClientRect = () => ({ width: 500 }) as DOMRect
    for (const [type, x] of [
      ['pointerdown', 10],
      ['pointermove', 70],
      ['pointerup', 70],
    ] as const) {
      handle.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x }),
      )
    }
    expect(doc?.master.doc.toString()).toBe(
      'top\n\n<img src="a.png" alt="a" width="160">\n\nbottom\n',
    )
    expect(follower.undo()).toBe(true)
    expect(doc?.master.doc.toString()).toBe(text)
  })
})
