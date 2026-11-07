import type { EditorState, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { joinWithEndings, type Endings } from '@/lib/endings'

/** One run of text a copy takes from the document, as CodeMirror's copy handler picks them. */
interface Piece {
  readonly from: number
  readonly plain: string
}

/**
 * What CodeMirror copies: each non-empty selection range, or, with nothing selected, the line each
 * caret is on. The same choice as its own copy handler, so the pieces line up with its text.
 */
function piecesOf(state: EditorState): Piece[] {
  const pieces: Piece[] = []
  for (const range of state.selection.ranges) {
    if (!range.empty) pieces.push({ from: range.from, plain: state.sliceDoc(range.from, range.to) })
  }
  if (pieces.length > 0) return pieces
  let upto = -1
  for (const { from } of state.selection.ranges) {
    const line = state.doc.lineAt(from)
    if (line.number > upto) pieces.push({ from: line.from, plain: line.text })
    upto = line.number
  }
  return pieces
}

/**
 * `text` with the document's own line endings back in. The editor holds `\n` only, so a copy would
 * hand over a file's `\r\n` lines as `\n`; this gives back the bytes the file has. If `text` is not
 * what a plain copy of the selection would be (another filter changed it), it is left alone.
 */
export function withSourceEndings(state: EditorState, endings: Endings, text: string): string {
  const pieces = piecesOf(state)
  if (pieces.map((piece) => piece.plain).join(state.lineBreak) !== text) return text
  return pieces
    .map((piece) => joinWithEndings(piece.plain, endings, state.doc.lineAt(piece.from).number - 1))
    .join(state.lineBreak)
}

/**
 * Copy and cut hand over source, not what is drawn. Hidden Markdown syntax is still in the text, so
 * it is copied; this adds the original line endings, which live with the document and not in the
 * state a view shows.
 */
export function sourceCopy(endings: () => Endings): Extension {
  return EditorView.clipboardOutputFilter.of((text, state) =>
    withSourceEndings(state, endings(), text),
  )
}
