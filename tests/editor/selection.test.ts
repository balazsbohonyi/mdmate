/**
 * ISC-96: the editor never holds more than one selection range. CodeMirror keeps only the main
 * range while `allowMultipleSelections` is off, which is its default; these tests fail if any state
 * the app builds turns it on.
 */
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { Document } from '@/documents/document'
import { createFollowerState, createMasterState, createState } from '@/editor/create'
import { uniformEndings } from '@/lib/endings'
import type { OpenedFile } from '@/platform'

const two = EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(3, 5)], 1)

function opened(text: string): OpenedFile {
  return {
    id: 1,
    path: 'C:/n/a.md',
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
}

describe('one selection range (ISC-96)', () => {
  it('every kind of state the app builds keeps one range, the main one', () => {
    const states: [string, EditorState][] = [
      ['standalone', createState('abcdef')],
      ['plain source', createState('abcdef', [], { parser: false })],
      ['master', createMasterState('abcdef')],
      ['follower', createFollowerState({ doc: EditorState.create({ doc: 'abcdef' }).doc })],
    ]
    for (const [name, state] of states) {
      expect(state.facet(EditorState.allowMultipleSelections), name).toBe(false)
      const after = state.update({ selection: two }).state
      expect(after.selection.ranges.length, name).toBe(1)
      expect(after.selection.main.from, name).toBe(3)
    }
  })

  it("a document's tab keeps one range after a dispatch of two", () => {
    const doc = new Document(opened('abcdef\n'), () => undefined)
    const follower = doc.followerFor('tab-1')
    follower.dispatch({ selection: two })
    expect(follower.state.selection.ranges.length).toBe(1)
    expect(doc.master.selection.ranges.length).toBe(1)
  })
})
