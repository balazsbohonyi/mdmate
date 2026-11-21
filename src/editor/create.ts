import { defaultKeymap, history, historyKeymap, indentLess, insertTab } from '@codemirror/commands'
import { indentUnit, syntaxHighlighting } from '@codemirror/language'
import { EditorState, type EditorSelection, type Extension, type Text } from '@codemirror/state'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import { appKeys } from './appKeys'
import { findSupport } from './find'
import { matchTicks } from './matchTicks'
import { revealMark } from './revealMark'
import { tokenHighlight } from './highlight'
import { listEditing } from './lists'
import { hoverHints } from './hoverHints'
import { textDrag } from './textDrag'
import { smartPaste } from './paste'
import { livePreview } from './livePreview'
import { previewSlot } from './previewMode'
import { markdownSupport } from './markdownSupport'
import { documentFonts } from './documentFonts'
import {
  contentWidthValue,
  CONTENT_PADDING_X,
  FULL_WIDTH_CLASS,
  WIDTH_VARIABLE,
} from './documentWidth'
import { lineNumbers } from './lineNumbers'
import { wordWrap } from './wordWrap'
import { DEFAULT_SETTINGS } from '@/lib/settings'

/** Fills its parent and scrolls inside itself, in the app's own colors. */
const frame = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
  },
  // CodeMirror draws a dotted outline round a focused editor by default. The caret already shows
  // where focus is, and the outline cuts across the top of the pane under the tab strip.
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  // Room between the text and the edges of the pane. Padding on the content, not margin: the
  // scrollbar stays at the pane's edge, and CodeMirror counts content padding in its heights.
  // The selection and the caret are drawn by CodeMirror (`drawSelection`, in `common` and
  // `followerBase`), which hides the browser's own, so the theme's Selection and Caret colors apply
  // here. The focused rule is as specific as CodeMirror's own, and wins by coming from the theme.
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--caret)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection':
    { background: 'var(--selection)' },
  '.cm-content': {
    padding: `1.25rem ${CONTENT_PADDING_X}`,
    // The text column stops at the width from settings.json and sits in the middle (documentWidth.ts).
    // The fallback is the default, for the moment before the file is read or when it cannot be.
    maxWidth: `var(${WIDTH_VARIABLE}, ${contentWidthValue(DEFAULT_SETTINGS.editor)})`,
    marginInline: 'auto',
    // The document's body font and size, from settings.json (documentFonts.ts). The fallbacks are
    // the defaults, for the moment before the file is read or when it cannot be (a test keeps them
    // equal to DEFAULT_SETTINGS).
    fontFamily: 'var(--doc-font-body, monospace)',
    fontSize: 'var(--doc-size, 15px)',
    // One line height for everything in the text (headings, lists, quotes, tables inherit it);
    // code blocks have their own (livePreview/box.ts). The fallback is CodeMirror's own 1.4.
    lineHeight: 'var(--doc-line-height, 1.4)',
  },
  // Without wrapping there is no column to keep: a long line runs out of it, so the limit waits for
  // word wrap (documentWidth.ts).
  '.cm-content:not(.cm-lineWrapping)': { maxWidth: 'none', marginInline: '0' },
  // The app's own JSON files keep the whole width (documentWidth.ts).
  [`&.${FULL_WIDTH_CLASS} .cm-content`]: { maxWidth: 'none', marginInline: '0' },
  // The line-number gutter (lineNumbers.ts). Off, it takes no room. On, the gutter comes before the
  // text column, which would be centered in what is left of the pane with the gutter at the edge of
  // the window. The column steps off the left margin and the gutter takes that free space instead,
  // so the pair sits in the middle with the numbers against the text.
  '&:not(.cm-lineNumbersOn) .cm-gutters': { display: 'none' },
  '&.cm-lineNumbersOn .cm-content.cm-lineWrapping': { marginInlineStart: '0' },
  '&.cm-lineNumbersOn .cm-gutters': {
    marginInlineStart: 'auto',
    backgroundColor: 'var(--gutter)',
    color: 'var(--gutter-foreground)',
    border: 'none',
    fontFamily: 'var(--doc-font-code, var(--font-mono))',
    // 0.8 times the code size (`fonts.codeSize` as a ratio of the text size, times the text size).
    fontSize: 'calc(var(--doc-code-ratio, calc(14 / 15)) * var(--doc-size, 15px) * 0.8)',
    // The height of one line of body text, as a length: a number sits on the middle of the line it
    // names at any line height, however small the number's own size is.
    lineHeight: 'calc(var(--doc-line-height, 1.4) * var(--doc-size, 15px))',
    userSelect: 'none',
  },
  '&.cm-lineNumbersOn .cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
  },
})

/**
 * Keys the app's own commands use, taken out of CodeMirror's default keymap so they reach the
 * command registry. The app listens in the bubble phase and leaves a key the editor handled alone,
 * so an editor binding for the same key would win. On Windows, Alt+Left and Alt+Right are
 * CodeMirror's syntax-wise caret moves; here they are history (P5-T3).
 */
export const APP_KEYS: ReadonlySet<string> = new Set([
  'Alt-ArrowLeft',
  'Alt-ArrowRight',
  // CodeMirror's "select parent syntax"; here it is italic (P5-T4).
  'Mod-i',
])

/** CodeMirror's default keys, less the ones the app takes. */
export const editorKeymap = defaultKeymap.filter(
  (binding) => binding.key === undefined || !APP_KEYS.has(binding.key),
)

/**
 * Tab and Shift+Tab stay in the editor, as in other Markdown editors: Tab inserts a tab at the caret
 * (or indents the selected lines) and Shift+Tab outdents. List items get their own Tab first
 * (`lists.ts`, at a higher precedence). A read-only document lets the key move focus.
 */
const tabKeys: Extension = [
  keymap.of([{ key: 'Tab', run: insertTab, shift: indentLess }]),
  // One tab is one level, so Shift+Tab takes back exactly what Tab put in.
  indentUnit.of('\t'),
]

/** What every document gets, with or without the Markdown parser. */
const common: Extension = [
  appKeys,
  history(),
  keymap.of([...editorKeymap, ...historyKeymap]),
  wordWrap,
  lineNumbers,
  documentFonts,
  frame,
  drawSelection(),
  tabKeys,
  textDrag(),
  findSupport(),
  revealMark(),
  matchTicks(),
]
const withParser: Extension = [
  common,
  markdownSupport(),
  syntaxHighlighting(tokenHighlight),
  listEditing(),
  smartPaste(),
]

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
const followerBase: Extension = [
  // The app's own shortcuts first, so a rebinding wins over a key of the editor's own (ISC-402).
  appKeys,
  keymap.of(editorKeymap),
  wordWrap,
  lineNumbers,
  documentFonts,
  frame,
  drawSelection(),
  tabKeys,
  // Drag-to-move for selected text, on pointer events (P5-T7).
  textDrag(),
  // Find and replace: the query lives on the state, the bar in the pane (P7-T1).
  findSupport(),
  // The match a search result jumped to, until the caret moves.
  revealMark(),
  // Ticks along the scrollbar for the find matches and the folder search hits (P7-T6).
  matchTicks(),
  // Hints for things drawn in the editor, in the shadcn tooltip's colors (ISC-226).
  hoverHints(),
]

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
      : [
          markdownSupport(),
          syntaxHighlighting(tokenHighlight),
          previewSlot(),
          listEditing(),
          smartPaste(),
        ]
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
