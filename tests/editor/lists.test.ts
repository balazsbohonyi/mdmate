// @vitest-environment jsdom
/** ISC-54: list markers render styled, and stay in the text. */
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Text, type StateCommand } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { createFollowerState, createState } from '@/editor/create'
import { continueList, indentListItem, outdentListItem } from '@/editor/lists'
import { hidden, markedText, scanAll, stateOf } from '../helpers/preview'

describe('lists', () => {
  it('styles bullet and number markers and hides nothing', () => {
    const doc = '- one\n* two\n+ three\n\n1. first\n2) second\n\nend'
    const state = stateOf(doc)
    const items = scanAll(state)
    expect(markedText(state, items)).toEqual([
      'cm-md-list-mark: -',
      'cm-md-list-mark: *',
      'cm-md-list-mark: +',
      'cm-md-list-mark: 1.',
      'cm-md-list-mark: 2)',
    ])
    expect(hidden(items)).toEqual([])
  })

  it('styles nested markers and the marker of a task item', () => {
    const doc = '- a\n  - b\n    1. c\n- [ ] task\n\nend'
    const state = stateOf(doc)
    expect(markedText(state, scanAll(state))).toEqual([
      'cm-md-list-mark: -',
      'cm-md-list-mark: -',
      'cm-md-list-mark: 1.',
      'cm-md-list-mark: -',
    ])
  })

  it('does not treat a dash inside text as a marker', () => {
    const state = stateOf('a - b and 1. c\n\nend')
    expect(markedText(state, scanAll(state))).toEqual([])
  })

  it('styles emphasis inside an item', () => {
    const state = stateOf('- some **bold** item\n\nend')
    expect(markedText(state, scanAll(state))).toContain('cm-md-strong: **bold**')
  })
})

describe('list editing (ISC-90 to ISC-94)', () => {
  /** Runs a command on `doc`, where `|` is the caret, and returns the text with the caret back in. */
  function run(marked: string, command: StateCommand): string {
    const at = marked.indexOf('|')
    let state = createState(marked.replace('|', '')).update({
      selection: EditorSelection.cursor(at),
    }).state
    ensureSyntaxTree(state, state.doc.length, 5000)
    command({
      state,
      dispatch: (tr) => {
        state = tr.state
      },
    })
    const head = state.selection.main.head
    const doc = state.doc.toString()
    return doc.slice(0, head) + '|' + doc.slice(head)
  }

  it('Enter continues a bullet, a number and a quoted list (ISC-90)', () => {
    expect(run('- one|', continueList)).toBe('- one\n- |')
    expect(run('* one|', continueList)).toBe('* one\n* |')
    expect(run('1. a|', continueList)).toBe('1. a\n2. |')
    expect(run('> - q|', continueList)).toBe('> - q\n> - |')
    expect(run('- a\n  - b|', continueList)).toBe('- a\n  - b\n  - |')
  })

  it('Enter continues a checkbox list with an unchecked box (ISC-91)', () => {
    expect(run('- [x] done|', continueList)).toBe('- [x] done\n- [ ] |')
    expect(run('- [ ] todo|', continueList)).toBe('- [ ] todo\n- [ ] |')
  })

  it('Enter on an empty item ends the list, with a blank line after it (ISC-92)', () => {
    expect(run('- one\n- |', continueList)).toBe('- one\n\n|')
    expect(run('- one\n- [ ] |', continueList)).toBe('- one\n\n|')
    expect(run('1. a\n2. |', continueList)).toBe('1. a\n\n|')
    expect(run('- |', continueList)).toBe('|')
  })

  it('Enter on an empty nested item steps out one level', () => {
    expect(run('- a\n  - b\n  - |', continueList)).toBe('- a\n  - b\n- |')
  })

  it('Enter outside a list and in the middle of an item behaves as usual', () => {
    // Outside a list the command declines, so CodeMirror's plain Enter runs next.
    const state = createState('plain').update({ selection: EditorSelection.cursor(5) }).state
    expect(continueList({ state, dispatch: () => undefined })).toBe(false)
    expect(run('- on|e', continueList)).toBe('- on\n- |e')
  })

  it('Tab nests an item under the one before, with its children (ISC-93)', () => {
    expect(run('- a\n- b|', indentListItem)).toBe('- a\n  - b|')
    expect(run('1. a\n2. b|', indentListItem)).toBe('1. a\n   2. b|')
    expect(run('- a\n- b|\n  - c', indentListItem)).toBe('- a\n  - b|\n    - c')
  })

  it('Tab on the first item changes nothing but still takes the key', () => {
    expect(run('- a|\n- b', indentListItem)).toBe('- a|\n- b')
    expect(run('plain|', indentListItem)).toBe('plain|')
  })

  it('Shift+Tab moves a nested item out one level, with its children (ISC-94)', () => {
    expect(run('- a\n  - b|', outdentListItem)).toBe('- a\n- b|')
    expect(run('- a\n  - b|\n    - c', outdentListItem)).toBe('- a\n- b|\n  - c')
    expect(run('1. a\n   1. b|', outdentListItem)).toBe('1. a\n1. b|')
    expect(run('- top|', outdentListItem)).toBe('- top|')
    // A top-level item stays put, but the key is still taken so focus does not leave the editor.
    const top = createState('- top').update({ selection: EditorSelection.cursor(5) }).state
    ensureSyntaxTree(top, top.doc.length, 5000)
    expect(outdentListItem({ state: top, dispatch: () => undefined })).toBe(true)
  })

  it('Tab then Shift+Tab gives the same text back', () => {
    for (const doc of ['- a\n- b|', '- a\n- b|\n  - c', '1. a\n2. b|']) {
      expect(run(run(doc, indentListItem), outdentListItem)).toBe(doc)
    }
  })

  it('take the key but change nothing in a read-only document', () => {
    const state = createState('- a\n- b', [EditorState.readOnly.of(true)]).update({
      selection: EditorSelection.cursor(7),
    }).state
    let changed = false
    const dispatch = () => {
      changed = true
    }
    expect(indentListItem({ state, dispatch })).toBe(true)
    expect(outdentListItem({ state, dispatch })).toBe(true)
    expect(changed).toBe(false)
  })

  it("are bound in every follower, above CodeMirror's own Enter", () => {
    const follower = createFollowerState({
      doc: Text.of(['- a', '- ']),
      selection: EditorSelection.single(6),
    })
    ensureSyntaxTree(follower, follower.doc.length, 5000)
    const enter = follower
      .facet(keymap)
      .flat()
      .filter((binding) => binding.key === 'Enter')
    expect(enter[0]?.run).toBe(continueList)
  })
})

describe('Tab and Shift+Tab in a view', () => {
  /** Presses a key in a follower view of `doc` with the caret at `|`, and returns the result. */
  function press(marked: string, shiftKey = false): { text: string; taken: boolean } {
    const at = marked.indexOf('|')
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      state: createFollowerState({
        doc: Text.of(marked.replace('|', '').split('\n')),
        selection: EditorSelection.single(at),
      }),
      parent,
    })
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      keyCode: 9,
      shiftKey,
      bubbles: true,
      cancelable: true,
    })
    view.contentDOM.dispatchEvent(event)
    const head = view.state.selection.main.head
    const doc = view.state.doc.toString()
    view.destroy()
    return { text: doc.slice(0, head) + '|' + doc.slice(head), taken: event.defaultPrevented }
  }

  it('Tab outside a list inserts a tab at the caret and keeps focus in the editor', () => {
    expect(press('plain| text')).toEqual({ text: 'plain\t| text', taken: true })
  })

  it('Shift+Tab outside a list outdents the line and keeps focus in the editor', () => {
    expect(press('\tindented| line', true)).toEqual({ text: 'indented| line', taken: true })
  })

  it('Tab on a list item still nests it rather than inserting a tab', () => {
    expect(press('- a\n- b|')).toEqual({ text: '- a\n  - b|', taken: true })
  })
})
