import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

/** Fills its parent and scrolls inside itself, in the app's own colors. */
const frame = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
  },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--foreground)' },
})

/** What every document gets, with or without the Markdown parser. */
const common: Extension = [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  EditorView.lineWrapping,
  frame,
]
const withParser: Extension = [common, markdown(), syntaxHighlighting(defaultHighlightStyle)]

export interface StateOptions {
  /**
   * False gives plain source: no Markdown parser and no highlighting, which is what a file above
   * the size cutoff opens as. Live preview joins the parser in Phase 3.
   */
  parser?: boolean
}

/** A document's state: its text, undo history and extensions. One per open file. */
export function createState(
  doc: string,
  extensions: Extension = [],
  options: StateOptions = {},
): EditorState {
  const base = options.parser === false ? common : withParser
  return EditorState.create({ doc, extensions: [base, extensions] })
}

/** A view that shows `state` inside `parent`. One per pane. */
export function createView(parent: HTMLElement, state: EditorState): EditorView {
  return new EditorView({ state, parent })
}
