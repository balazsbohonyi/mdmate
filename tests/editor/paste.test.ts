// @vitest-environment jsdom
/** ISC-95: pasting a web address over selected text creates a link. */
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { createState } from '@/editor/create'
import { pasteAsLink } from '@/editor/paste'

function stateWith(doc: string, from: number, to: number, extensions = []): EditorState {
  return createState(doc, extensions).update({ selection: EditorSelection.single(from, to) }).state
}

function pasted(doc: string, from: number, to: number, text: string): string | null {
  const state = stateWith(doc, from, to)
  const spec = pasteAsLink(state, text)
  return spec === null ? null : state.update(spec).state.doc.toString()
}

describe('pasteAsLink', () => {
  it('turns the selection into a link to the pasted address (ISC-95)', () => {
    expect(pasted('Read the docs now', 5, 13, 'https://example.com/docs')).toBe(
      'Read [the docs](https://example.com/docs) now',
    )
    expect(pasted('Mail me', 5, 7, 'mailto:a@example.com')).toBe('Mail [me](mailto:a@example.com)')
    expect(pasted('x word y', 2, 6, '  http://example.com/a  ')).toBe(
      'x [word](http://example.com/a) y',
    )
  })

  it('puts the caret after the link', () => {
    const state = stateWith('Read the docs now', 5, 13)
    const spec = pasteAsLink(state, 'https://example.com')
    if (spec === null) throw new Error('expected a link')
    const after = state.update(spec).state
    expect(after.selection.main.head).toBe('Read [the docs](https://example.com)'.length)
  })

  it('leaves every other paste to CodeMirror', () => {
    // No selection, text that is not an address, an address over an address, several lines,
    // an address with spaces inside.
    expect(pasted('Read the docs', 5, 5, 'https://example.com')).toBeNull()
    expect(pasted('Read the docs', 5, 13, 'plain text')).toBeNull()
    expect(pasted('https://old.example', 0, 19, 'https://new.example')).toBeNull()
    expect(pasted('one\ntwo', 0, 7, 'https://example.com')).toBeNull()
    expect(pasted('Read the docs', 5, 13, 'https://example.com/a b')).toBeNull()
    expect(pasted('Read the docs', 5, 13, 'javascript:alert(1)')).toBeNull()
  })

  it('does not wrap across syntax: half a bold span, code, an existing link', () => {
    expect(pasted('a **bold** b', 2, 6, 'https://example.com')).toBeNull()
    expect(pasted('a `code` b', 3, 7, 'https://example.com')).toBeNull()
    expect(pasted('a [link](x.md) b', 3, 7, 'https://example.com')).toBeNull()
    // The words inside a bold span touch its closing marker, so this too is a plain paste, as in
    // lang-markdown's own rule. Plain text around the span still links.
    expect(pasted('a **bold** b', 4, 8, 'https://example.com')).toBeNull()
    expect(pasted('plain words here', 6, 11, 'https://example.com')).toBe(
      'plain [words](https://example.com) here',
    )
  })

  it("lang-markdown's own handler is off, so a read-only view keeps its text", () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      state: stateWith('Read the docs', 5, 13, [EditorState.readOnly.of(true)] as never),
      parent,
    })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? 'https://example.com' : '') },
    })
    view.contentDOM.dispatchEvent(event)
    expect(view.state.doc.toString()).toBe('Read the docs')
    view.destroy()
  })

  it('changes nothing in a read-only document', () => {
    const state = stateWith('Read the docs', 5, 13, [EditorState.readOnly.of(true)] as never)
    expect(pasteAsLink(state, 'https://example.com')).toBeNull()
  })
})

describe('a real paste event in a view', () => {
  const views: EditorView[] = []
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy()
  })

  /** jsdom has no DataTransfer, so the event carries a stand-in with the one method read. */
  function pasteInto(view: EditorView, text: string): Event {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    })
    view.contentDOM.dispatchEvent(event)
    return event
  }

  it('makes the link from a real paste event, and leaves a plain paste alone', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({ state: stateWith('Read the docs now', 5, 13), parent })
    views.push(view)
    const event = pasteInto(view, 'https://example.com/docs')
    expect(event.defaultPrevented).toBe(true)
    expect(view.state.doc.toString()).toBe('Read [the docs](https://example.com/docs) now')
    // A plain paste goes to CodeMirror, which inserts the text as it is at the caret.
    // jsdom syncs the DOM selection back without layout, so the caret is set again here.
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(' now') } })
    pasteInto(view, ' just words')
    expect(view.state.doc.toString()).toBe(
      'Read [the docs](https://example.com/docs) just words now',
    )
  })
})
