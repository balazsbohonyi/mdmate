// @vitest-environment jsdom
/**
 * ISC-61: a per-pane toggle shows raw source. The mode belongs to the pane, so another pane (even
 * one on the same document) is untouched, and a tab that comes up in a pane gets that pane's mode
 * whatever mode it was last shown in. The panes here are the real `PaneEditor` the app uses.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Document } from '@/documents/document'
import { previewShown } from '@/editor/previewMode'
import { uniformEndings } from '@/lib/endings'
import type { OpenedFile } from '@/platform'
import { PaneEditor } from '@/workbench/paneEditor'

const TEXT = '# Title\n\nsome **bold** and `code` here\n'
/** What a reader sees with live preview on and with raw Markdown. */
const RENDERED = 'Titlesome bold and code here'
const RAW = '# Titlesome **bold** and `code` here'

const panes: PaneEditor[] = []

beforeAll(() => {
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const pane of panes.splice(0)) pane.destroy()
  document.body.replaceChildren()
})

function open(text = TEXT, options: { parser?: boolean } = {}): Document {
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
  return new Document(opened, () => undefined, options)
}

function pane(): PaneEditor {
  const parent = document.createElement('div')
  document.body.append(parent)
  const editor = new PaneEditor(parent)
  panes.push(editor)
  return editor
}

/** The page of a pane. The caret is moved away from every element first, so nothing is revealed. */
function page(editor: PaneEditor): string {
  const view = editor.view
  if (view === undefined) throw new Error('nothing shown')
  view.dispatch({ selection: { anchor: view.state.doc.length } })
  return view.contentDOM.textContent
}

describe('one pane at a time', () => {
  it('shows raw Markdown in the pane that was toggled and leaves the other one alone', () => {
    const doc = open()
    const a = pane()
    const b = pane()
    a.show(doc.followerFor('a'))
    b.show(doc.followerFor('b'))
    expect(page(a)).toBe(RENDERED)
    expect(page(b)).toBe(RENDERED)

    a.setRaw(true)
    expect(page(a)).toBe(RAW)
    expect(page(b)).toBe(RENDERED)

    b.setRaw(true)
    a.setRaw(false)
    expect(page(a)).toBe(RENDERED)
    expect(page(b)).toBe(RAW)
  })

  it('changes no text, makes no edit and leaves nothing to undo', () => {
    const doc = open()
    const a = pane()
    const follower = doc.followerFor('a')
    a.show(follower)
    a.setRaw(true)
    a.setRaw(false)
    a.setRaw(true)
    expect(doc.master.doc.toString()).toBe(TEXT)
    expect(follower.state.doc.toString()).toBe(TEXT)
    expect(doc.dirty).toBe(false)
    expect(follower.undo()).toBe(false)
  })
})

describe('tabs inside a pane', () => {
  it('stay raw when the user switches between them, and rendered when the pane is toggled back', () => {
    const doc = open()
    const a = pane()
    const first = doc.followerFor('one')
    const second = doc.followerFor('two')
    a.show(first)
    a.setRaw(true)
    expect(page(a)).toBe(RAW)

    a.show(second)
    expect(page(a)).toBe(RAW)
    a.show(first)
    expect(page(a)).toBe(RAW)

    a.setRaw(false)
    expect(page(a)).toBe(RENDERED)
    // `second` was last shown raw; it must come up rendered now.
    a.show(second)
    expect(page(a)).toBe(RENDERED)
  })

  it('come up in the mode of the pane they are shown in, not the one they were last shown in', () => {
    const doc = open()
    const rawPane = pane()
    const livePane = pane()
    const follower = doc.followerFor('moving')
    rawPane.setRaw(true)
    rawPane.show(follower)
    expect(previewShown(follower.state)).toBe(false)

    // The tab is dragged to the other pane.
    rawPane.show(doc.followerFor('other'))
    livePane.show(follower)
    expect(page(livePane)).toBe(RENDERED)
    expect(previewShown(follower.state)).toBe(true)
  })

  it('apply the mode of a pane that was toggled before any tab was shown', () => {
    const doc = open()
    const a = pane()
    a.setRaw(true)
    a.show(doc.followerFor('one'))
    expect(page(a)).toBe(RAW)
  })
})

describe('plain source', () => {
  it('has no preview to switch, so a toggle changes nothing and breaks nothing', () => {
    const doc = open(TEXT, { parser: false })
    const a = pane()
    a.show(doc.followerFor('big'))
    const before = page(a)
    expect(before).toBe('# Titlesome **bold** and `code` here')
    a.setRaw(true)
    a.setRaw(false)
    expect(page(a)).toBe(before)
  })
})
