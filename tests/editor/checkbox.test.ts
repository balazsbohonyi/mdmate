// @vitest-environment jsdom
/**
 * ISC-69 and ISC-184: a task marker is drawn as a checkbox, and pressing it changes exactly one
 * byte of the file, whatever the line endings are. A read-only document ignores the press.
 *
 * The scan is read without a view. The presses go through the real pieces the app uses: a
 * `Document` with its endings kept apart from the text, a `PaneEditor` showing a follower, and the
 * text a save would write, built the way a save builds it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Document } from '@/documents/document'
import type { Follower } from '@/documents/follower'
import { toggleCheckbox } from '@/editor/livePreview/checkbox'
import { joinWithEndings } from '@/lib/endings'
import type { OpenedFile, ReadOnlyReason } from '@/platform'
import { PaneEditor } from '@/workbench/paneEditor'
import { splitRaw } from '../helpers/endings'
import { hidden, scanAll, stateOf } from '../helpers/preview'

describe('which markers become checkboxes', () => {
  const boxes = (doc: string, caret = doc.length): string[] => {
    const state = stateOf(doc, caret)
    return scanAll(state)
      .filter((item) => item.type === 'checkbox')
      .sort((a, b) => a.from - b.from)
      .map((item) => `${state.doc.sliceString(item.from, item.to)}=${String(item.checked)}`)
  }

  it('draws an open marker open, and a done one done, in either case', () => {
    expect(boxes('- [ ] a\n- [x] b\n- [X] c\n\nend')).toEqual(['[ ]=false', '[x]=true', '[X]=true'])
  })

  it('finds markers in numbered, nested and quoted items', () => {
    expect(boxes('1. [ ] n\n\n- a\n  - [x] deep\n\n> - [ ] quoted\n\nend')).toEqual([
      '[ ]=false',
      '[x]=true',
      '[ ]=false',
    ])
  })

  it('leaves alone what is not a task marker', () => {
    expect(boxes('[ ] not in a list\n\n- [y] unknown\n\n- [] empty\n\nend')).toEqual([])
  })

  it('leaves alone a marker inside code', () => {
    expect(boxes('```\n- [ ] x\n```\n\n    - [ ] y\n\n`- [ ] z`\n\nend')).toEqual([])
  })

  it('hides nothing, so the text stays as it was', () => {
    const state = stateOf('- [ ] a\n- [x] b\n\nend')
    expect(hidden(scanAll(state))).toEqual([])
  })

  it('shows the brackets, not a box, while the caret touches the marker', () => {
    const doc = '- [ ] task\n\nend'
    for (const caret of [2, 3, 4, 5]) {
      expect(boxes(doc, caret), `caret at ${String(caret)}`).toEqual([])
    }
    expect(boxes(doc, 1)).toEqual(['[ ]=false'])
    expect(boxes(doc, 7)).toEqual(['[ ]=false'])
  })
})

beforeAll(() => {
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const panes: PaneEditor[] = []
afterEach(() => {
  for (const pane of panes.splice(0)) pane.destroy()
  document.body.replaceChildren()
})

interface Rig {
  readonly doc: Document
  readonly follower: Follower
  readonly pane: PaneEditor
  /** The checkboxes on the page, in order. */
  boxes(): HTMLInputElement[]
  /** The nth checkbox on the page. */
  box(index: number): HTMLInputElement
  /** Presses one the way a pointer does: the press, then the click. */
  press(box: HTMLInputElement): void
  /** What a save would write to the file now. */
  disk(): string
}

function rig(raw: string, readOnly: ReadOnlyReason | null = null): Rig {
  const { text, endings } = splitRaw(raw)
  const opened: OpenedFile = {
    id: 1,
    path: '/t/a.md',
    name: 'a.md',
    encoding: 'utf-8',
    bom: false,
    readOnly,
    size: raw.length,
    hash: '0'.repeat(32),
    kind: 'markdown',
    text,
    endings,
  }
  const doc = new Document(opened, () => undefined)
  const follower = doc.followerFor('a')
  const parent = document.createElement('div')
  document.body.append(parent)
  const pane = new PaneEditor(parent)
  panes.push(pane)
  pane.show(follower)
  const view = pane.view
  if (view === undefined) throw new Error('no view')
  // Away from every marker, so each one is drawn as a box.
  view.dispatch({ selection: { anchor: view.state.doc.length } })
  return {
    doc,
    follower,
    pane,
    boxes: () => [...view.contentDOM.querySelectorAll<HTMLInputElement>('input.cm-md-checkbox')],
    box: (index) => {
      const box = view.contentDOM.querySelectorAll<HTMLInputElement>('input.cm-md-checkbox')[index]
      if (box === undefined) throw new Error('no checkbox ' + String(index))
      return box
    },
    press: (box) => {
      box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    disk: () => {
      const snapshot = doc.snapshot()
      return joinWithEndings(snapshot.text, snapshot.endings)
    },
  }
}

/** The indexes where two strings of the same length differ. */
function differences(a: string, b: string): number[] {
  expect(b.length).toBe(a.length)
  const at: number[] = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) at.push(i)
  return at
}

describe('pressing a checkbox (ISC-69)', () => {
  const lines = ['# Tasks', '', '- [ ] one', '- [x] two', '- [ ] three', '', 'end', '']

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])('changes one byte of a file with %s endings', (_name, ending) => {
    const raw = lines.join(ending)
    const r = rig(raw)
    const boxes = r.boxes()
    expect(boxes.map((box) => box.checked)).toEqual([false, true, false])

    r.press(r.box(0))
    const after = r.disk()
    expect(differences(raw, after)).toEqual([raw.indexOf('[ ] one') + 1])
    expect(after[raw.indexOf('[ ] one') + 1]).toBe('x')

    r.press(r.box(1))
    const second = differences(after, r.disk())
    expect(second).toEqual([raw.indexOf('[x] two') + 1])
    expect(r.disk()[raw.indexOf('[x] two') + 1]).toBe(' ')
  })

  it('changes one byte of a file that mixes all three endings', () => {
    const raw = '# T\r\n\n- [ ] one\r- [ ] two\n- [x] three\r\n\r\nend\n'
    const r = rig(raw)
    expect(r.boxes()).toHaveLength(3)
    for (const [i, name] of ['one', 'two', 'three'].entries()) {
      const before = r.disk()
      r.press(r.box(i))
      const changed = differences(before, r.disk())
      expect(changed, name).toEqual([raw.indexOf(`] ${name}`) - 1])
    }
    expect(r.disk()).toBe(
      raw
        .replace('[ ] one', '[x] one')
        .replace('[ ] two', '[x] two')
        .replace('[x] three', '[ ] three'),
    )
  })

  it('draws the box again from the new text', () => {
    const r = rig(lines.join('\n'))
    r.press(r.box(0))
    expect(r.boxes().map((box) => box.checked)).toEqual([true, true, false])
    expect(r.boxes().map((box) => box.hasAttribute('checked'))).toEqual([true, true, false])
    r.press(r.box(1))
    expect(r.boxes().map((box) => box.checked)).toEqual([true, false, false])
  })

  it('leaves the caret and the selection where they were', () => {
    const r = rig(lines.join('\n'))
    const view = r.pane.view
    view?.dispatch({ selection: { anchor: 3, head: 6 } })
    // The caret is on the heading line; the boxes below are still boxes.
    const before = view?.state.selection.main
    r.press(r.box(0))
    expect(view?.state.selection.main.anchor).toBe(before?.anchor)
    expect(view?.state.selection.main.head).toBe(before?.head)
  })

  it('does not let the press take the focus from the text', () => {
    const r = rig(lines.join('\n'))
    const box = r.box(0)
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    box.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
  })

  it('marks the document as edited', () => {
    const r = rig(lines.join('\n'))
    expect(r.doc.dirty).toBe(false)
    r.press(r.box(0))
    expect(r.doc.dirty).toBe(true)
  })

  it('is undone by undo, byte for byte, and done again by redo', () => {
    const raw = lines.join('\r\n')
    const r = rig(raw)
    r.press(r.box(0))
    expect(r.disk()).not.toBe(raw)
    expect(r.follower.undo()).toBe(true)
    expect(r.disk()).toBe(raw)
    expect(r.doc.dirty).toBe(false)
    expect(r.follower.redo()).toBe(true)
    expect(differences(raw, r.disk())).toEqual([raw.indexOf('[ ] one') + 1])
  })

  it('makes each press a step of undo of its own, even in quick succession', () => {
    const raw = lines.join('\n')
    const r = rig(raw)
    r.press(r.box(0))
    r.press(r.box(2))
    const both = r.disk()
    expect(r.follower.undo()).toBe(true)
    expect(differences(raw, r.disk())).toEqual([raw.indexOf('[ ] one') + 1])
    expect(r.disk()).not.toBe(both)
    expect(r.follower.undo()).toBe(true)
    expect(r.disk()).toBe(raw)
  })

  it('undoes two quick presses on the same box one at a time', () => {
    const raw = lines.join('\n')
    const r = rig(raw)
    r.press(r.box(0))
    const once = r.disk()
    r.press(r.box(0))
    expect(r.disk()).toBe(raw)
    expect(r.follower.undo()).toBe(true)
    expect(r.disk()).toBe(once)
    expect(r.follower.undo()).toBe(true)
    expect(r.disk()).toBe(raw)
  })

  it('does nothing to a marker that stopped being one under a box that was not redrawn', () => {
    const r = rig(lines.join('\n'))
    const view = r.pane.view
    if (view === undefined) throw new Error('no view')
    const box = r.box(0)
    const from = view.posAtDOM(box)
    // The brackets are gone from the text but the old box is still in the hand of the test.
    view.dispatch({ changes: { from, to: from + 3, insert: 'xyz' } })
    const before = view.state.doc.toString()
    expect(toggleCheckbox(view, box)).toBe(false)
    expect(view.state.doc.toString()).toBe(before)
  })
})

describe('a read-only document (ISC-184)', () => {
  it('ignores a press: no change, nothing to undo, not edited', () => {
    const raw = '- [ ] one\n- [x] two\n\nend\n'
    const r = rig(raw, 'unsupported-encoding')
    expect(r.follower.state.readOnly).toBe(true)
    const boxes = r.boxes()
    expect(boxes).toHaveLength(2)
    for (const box of boxes) r.press(box)
    expect(r.disk()).toBe(raw)
    expect(r.doc.master.doc.toString()).toBe(raw)
    expect(r.doc.dirty).toBe(false)
    expect(r.follower.undo()).toBe(false)
    expect(r.boxes().map((box) => box.checked)).toEqual([false, true])
  })
})
