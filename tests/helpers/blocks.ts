import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import { blockLayer, blocksOf, type BlockInfo } from '@/editor/livePreview/blocks'
import { markdownSupport } from '@/editor/markdownSupport'

/**
 * A fully parsed state with the block layer and nothing else, the selection at `caret` (a number,
 * or `[anchor, head]`). The block layer reads only the state, so a test needs no view.
 */
export function blockStateOf(
  doc: string,
  caret: number | [number, number] = 0,
  extensions: Extension = [],
): EditorState {
  const selection = Array.isArray(caret)
    ? EditorSelection.single(caret[0], caret[1])
    : EditorSelection.single(caret)
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdownSupport(), blockLayer(), extensions],
  })
  // The field reads the tree as it stands, so the parse must be whole before the first read.
  if (ensureSyntaxTree(state, doc.length, 5000) === null)
    throw new Error('the parse did not finish')
  // Re-run the field with the whole tree, as the parser advancing would.
  return state.update({}).state
}

/** The blocks the layer draws now, as `kind from-to`, so a test reads like the page. */
export function drawn(state: EditorState): string[] {
  return blocksOf(state).map(
    (block: BlockInfo) => `${block.kind} ${String(block.from)}-${String(block.to)}`,
  )
}

/** A live-preview view over `doc` in the page, the caret at `caret`. The caller destroys it. */
export function mountPreview(doc: string, caret: number, extensions: Extension = []): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createView(parent, createState(doc, extensions, { preview: true }))
  view.dispatch({ selection: { anchor: caret } })
  return view
}
