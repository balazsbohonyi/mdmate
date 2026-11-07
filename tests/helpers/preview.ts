import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { scanPreview, type PreviewItem } from '@/editor/livePreview/scan'

/** A parsed state with the selection at `caret` (a number, or `[anchor, head]`). The doc is the whole parse. */
export function stateOf(doc: string, caret: number | [number, number] = doc.length): EditorState {
  const selection = Array.isArray(caret)
    ? EditorSelection.single(caret[0], caret[1])
    : EditorSelection.single(caret)
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdown({ base: markdownLanguage })],
  })
  // Small documents parse in one go, but a test must never read a half-built tree.
  if (ensureSyntaxTree(state, doc.length, 5000) === null)
    throw new Error('the parse did not finish')
  return state
}

/** Everything the layer does to the whole document. */
export function scanAll(state: EditorState): PreviewItem[] {
  return scanPreview(state, [{ from: 0, to: state.doc.length }])
}

/** The hidden ranges, sorted, as `[from, to]` pairs. */
export function hidden(items: readonly PreviewItem[]): [number, number][] {
  return items
    .flatMap((item) => (item.type === 'hide' ? [[item.from, item.to] as [number, number]] : []))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/** The text a reader sees: the document with every hidden range cut out. */
export function rendered(state: EditorState, items: readonly PreviewItem[]): string {
  const text = state.doc.toString()
  let out = ''
  let at = 0
  for (const [from, to] of hidden(items)) {
    out += text.slice(at, from)
    at = Math.max(at, to)
  }
  return out + text.slice(at)
}

/** The class names of the line items, as `line N: class`, so a test reads like the page. */
export function lineClasses(state: EditorState, items: readonly PreviewItem[]): string[] {
  return items
    .filter((item) => item.type === 'line')
    .map((item) => `${String(state.doc.lineAt(item.from).number)}: ${item.class}`)
    .sort()
}

/** The marked text, as `class: text`, in document order. */
export function markedText(state: EditorState, items: readonly PreviewItem[]): string[] {
  return items
    .filter((item) => item.type === 'mark')
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .map((item) => `${item.class}: ${state.doc.sliceString(item.from, item.to)}`)
}
