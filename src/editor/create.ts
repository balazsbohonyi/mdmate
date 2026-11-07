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

/** What every document gets. Live preview joins it in Phase 3. */
const base: Extension = [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  markdown(),
  syntaxHighlighting(defaultHighlightStyle),
  EditorView.lineWrapping,
  frame,
]

/** A document's state: its text, undo history and extensions. One per open file. */
export function createState(doc: string, extensions: Extension = []): EditorState {
  return EditorState.create({ doc, extensions: [base, extensions] })
}

/** A view that shows `state` inside `parent`. One per pane. */
export function createView(parent: HTMLElement, state: EditorState): EditorView {
  return new EditorView({ state, parent })
}
