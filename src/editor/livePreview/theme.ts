import { EditorView } from '@codemirror/view'

/**
 * How rendered Markdown looks. Colors come from the theme tokens. Spacing is padding on `.cm-line`,
 * never margin: CodeMirror cannot measure a vertical margin, and the arrow keys would then skip
 * the line.
 */
export const previewTheme = EditorView.baseTheme({
  // The default highlight style underlines headings; a rendered heading is not underlined.
  '.cm-md-h, .cm-md-h span': { textDecoration: 'none' },
  '.cm-md-h': { fontWeight: '650', color: 'var(--syntax-heading)' },
  '.cm-md-h1': { fontSize: '1.7em', lineHeight: '1.35', paddingTop: '0.3em' },
  '.cm-md-h2': { fontSize: '1.45em', lineHeight: '1.4', paddingTop: '0.25em' },
  '.cm-md-h3': { fontSize: '1.25em', lineHeight: '1.45', paddingTop: '0.2em' },
  '.cm-md-h4': { fontSize: '1.1em' },
  '.cm-md-h5': { fontSize: '1em' },
  '.cm-md-h6': { fontSize: '0.95em', color: 'var(--syntax-marker)' },
  '.cm-md-setext-mark': { color: 'var(--syntax-marker)' },
})
