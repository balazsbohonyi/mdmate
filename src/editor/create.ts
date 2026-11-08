import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting } from '@codemirror/language'
import { EditorState, type EditorSelection, type Extension, type Text } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { tokenHighlight } from './highlight'
import { livePreview } from './livePreview'
import { previewSlot } from './previewMode'
import { markdownSupport } from './markdownSupport'

/** Fills its parent and scrolls inside itself, in the app's own colors. */
const frame = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
  },
  '.cm-scroller': { overflow: 'auto' },
  // Room between the text and the edges of the pane. Padding on the content, not margin: the
  // scrollbar stays at the pane's edge, and CodeMirror counts content padding in its heights.
  '.cm-content': { caretColor: 'var(--foreground)', padding: '1.25rem 1.5rem' },
})

/** What every document gets, with or without the Markdown parser. */
const common: Extension = [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  EditorView.lineWrapping,
  frame,
]
const withParser: Extension = [common, markdownSupport(), syntaxHighlighting(tokenHighlight)]

export interface StateOptions {
  /**
   * False gives plain source: no Markdown parser and no highlighting, which is what a file above
   * the size cutoff opens as. Live preview joins the parser in Phase 3.
   */
  parser?: boolean
  /** True adds live preview. It needs the parser, so plain source never gets it. Off by default here. */
  preview?: boolean
}

/** A document's state: its text, undo history and extensions. One per open file. */
export function createState(
  doc: string,
  extensions: Extension = [],
  options: StateOptions = {},
): EditorState {
  const parsing = options.parser !== false
  const preview = parsing && options.preview === true ? livePreview() : []
  return EditorState.create({
    doc,
    extensions: [parsing ? withParser : common, preview, extensions],
  })
}

/**
 * The headless state that owns a document: its text, undo history and line endings. No view ever
 * shows it. Views show follower states, which hand their edits to this one.
 */
export function createMasterState(doc: string, extensions: Extension = []): EditorState {
  return EditorState.create({ doc, extensions: [history(), extensions] })
}

/** What every follower gets: the default keys without history, which lives on the master. */
const followerBase: Extension = [keymap.of(defaultKeymap), EditorView.lineWrapping, frame]

export interface FollowerOptions {
  /** The master's text. The follower shares it rather than copying it. */
  doc: Text
  /** Where the caret starts. Defaults to the start of the document. */
  selection?: EditorSelection | undefined
  /** False gives plain source, as for a file above the size cutoff. */
  parser?: boolean | undefined
  extensions?: Extension
}

/**
 * The state one tab shows in a view. It has no undo history: it is wired to its document with
 * `followerSync` (passed in `extensions`), which sends its edits to the master.
 */
export function createFollowerState(options: FollowerOptions): EditorState {
  // Live preview rides with the parser, so a tab that opens as plain source gets neither.
  const parsing: Extension =
    options.parser === false
      ? []
      : [markdownSupport(), syntaxHighlighting(tokenHighlight), previewSlot()]
  return EditorState.create({
    doc: options.doc,
    ...(options.selection === undefined ? {} : { selection: options.selection }),
    extensions: [followerBase, parsing, options.extensions ?? []],
  })
}

/** A view that shows `state` inside `parent`. One per pane. */
export function createView(parent: HTMLElement, state: EditorState): EditorView {
  return new EditorView({ state, parent })
}
