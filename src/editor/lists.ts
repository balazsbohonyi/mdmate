import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  Prec,
  type ChangeSpec,
  type EditorState,
  type Extension,
  type StateCommand,
} from '@codemirror/state'
import { keymap } from '@codemirror/view'

/**
 * List editing: Enter continues a list (CodeMirror's `insertNewlineContinueMarkup`, which also
 * turns `- [x]` into a fresh `- [ ]`), Enter on an empty item ends the list or steps out one level,
 * and Tab and Shift+Tab move an item, with everything nested under it, one level in or out.
 */

/** A node of the syntax tree, typed without a direct `@lezer/common` dependency (as in scan.ts). */
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolve']>

/** A list item line with nothing after its marker (and its task box). */
const EMPTY_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?[ \t]*$/

function treeAt(state: EditorState, pos: number) {
  return ensureSyntaxTree(state, pos, 50) ?? syntaxTree(state)
}

/** The list item whose own first line is the line holding `pos`, or null. */
function itemOnLine(state: EditorState, pos: number): SyntaxNode | null {
  const line = state.doc.lineAt(pos)
  const indent = /^\s*/.exec(line.text)?.[0].length ?? 0
  for (
    let node: SyntaxNode | null = treeAt(state, line.to).resolveInner(line.from + indent, 1);
    node;
    node = node.parent
  ) {
    if (node.name === 'ListItem')
      return state.doc.lineAt(node.from).number === line.number ? node : null
  }
  return null
}

/** The item a list item is nested in, or null for a top-level item. */
function parentItem(item: SyntaxNode): SyntaxNode | null {
  for (let node = item.parent; node; node = node.parent) {
    if (node.name === 'ListItem') return node
    if (node.name === 'Document' || node.name === 'Blockquote') return null
  }
  return null
}

/** Columns of leading whitespace on the line of `pos` (a tab counts as one, as written). */
function indentOf(state: EditorState, pos: number): number {
  return /^[ \t]*/.exec(state.doc.lineAt(pos).text)?.[0].length ?? 0
}

/** Where an item's text starts on its first line: its indent, marker and the spaces after. */
function contentColumn(state: EditorState, item: SyntaxNode): number {
  const text = state.doc.lineAt(item.from).text
  return /^[ \t]*([-*+]|\d{1,9}[.)])[ \t]*/.exec(text)?.[0].length ?? 0
}

/** Changes that shift every non-blank line of an item (children included) by `delta` columns. */
function shiftItem(state: EditorState, item: SyntaxNode, delta: number): ChangeSpec[] {
  const changes: ChangeSpec[] = []
  const first = state.doc.lineAt(item.from).number
  const last = state.doc.lineAt(Math.max(item.from, item.to - 1)).number
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n)
    if (line.text.trim() === '') continue
    if (delta > 0) {
      changes.push({ from: line.from, insert: ' '.repeat(delta) })
    } else {
      const remove = Math.min(-delta, /^[ \t]*/.exec(line.text)?.[0].length ?? 0)
      if (remove > 0) changes.push({ from: line.from, to: line.from + remove })
    }
  }
  return changes
}

/** Tab: nests the item under the one before it, so its marker lines up with that item's text. */
export const indentListItem: StateCommand = ({ state, dispatch }) => {
  const item = itemOnLine(state, state.selection.main.head)
  if (item === null) return false
  if (state.readOnly) return true
  const previous = item.prevSibling
  // The first item of a list has nothing to nest under; the key is still taken.
  if (previous?.name !== 'ListItem') return true
  const delta = contentColumn(state, previous) - indentOf(state, item.from)
  if (delta <= 0) return true
  dispatch(
    state.update({
      changes: shiftItem(state, item, delta),
      scrollIntoView: true,
      userEvent: 'input.indent',
    }),
  )
  return true
}

/** Shift+Tab: moves a nested item out to the level of the item it is nested in. */
export const outdentListItem: StateCommand = ({ state, dispatch }) => {
  const item = itemOnLine(state, state.selection.main.head)
  if (item === null) return false
  if (state.readOnly) return true
  const parent = parentItem(item)
  if (parent === null) return true
  const delta = indentOf(state, parent.from) - indentOf(state, item.from)
  if (delta >= 0) return true
  dispatch(
    state.update({
      changes: shiftItem(state, item, delta),
      scrollIntoView: true,
      userEvent: 'delete.dedent',
    }),
  )
  return true
}

/**
 * Enter. On an empty item (only its marker, perhaps a task box) with the caret at its end: a nested
 * item steps out one level, a top-level item ends the list, leaving a blank line after the list so
 * what is typed next is a paragraph and not part of the last item. Anywhere else in a list,
 * CodeMirror's own continuation.
 */
export const continueList: StateCommand = (target) => {
  const { state, dispatch } = target
  const range = state.selection.main
  if (state.selection.ranges.length === 1 && range.empty) {
    const line = state.doc.lineAt(range.head)
    const item =
      range.head === line.to && EMPTY_ITEM.test(line.text) ? itemOnLine(state, line.from) : null
    if (item !== null) {
      if (state.readOnly) return true
      if (parentItem(item) !== null) return outdentListItem(target)
      const previous = line.number > 1 ? state.doc.line(line.number - 1) : null
      // A blank line between the list and the caret ends the list for the parser too.
      const insert = previous !== null && previous.text.trim() !== '' ? '\n' : ''
      dispatch(
        state.update({
          changes: { from: line.from, to: line.to, insert },
          selection: EditorSelection.cursor(line.from + insert.length),
          scrollIntoView: true,
          userEvent: 'input',
        }),
      )
      return true
    }
  }
  return insertNewlineContinueMarkup(target)
}

/** The list keys, above CodeMirror's Markdown keymap. Only for documents with the parser. */
export function listEditing(): Extension {
  return Prec.highest(
    keymap.of([
      { key: 'Enter', run: continueList },
      { key: 'Tab', run: indentListItem },
      { key: 'Shift-Tab', run: outdentListItem },
    ]),
  )
}
