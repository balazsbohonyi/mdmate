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
  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-code': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.92em',
    color: 'var(--syntax-code)',
    backgroundColor: 'var(--syntax-code-background)',
    borderRadius: 'var(--radius)',
  },
  // The default highlight style colors and underlines the pieces of a link itself, so the span
  // sets both on its children too.
  '.cm-md-link, .cm-md-link span': {
    color: 'var(--syntax-link)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  // The YAML of an open frontmatter block reads as plain text, whatever the highlighter makes of it.
  '.cm-md-frontmatter-line, .cm-md-frontmatter-line span': {
    color: 'var(--syntax-marker)',
    fontWeight: 'normal',
    fontStyle: 'normal',
    textDecoration: 'none',
  },
  '.cm-md-list-mark': { color: 'var(--syntax-marker)', fontWeight: '700' },
  '.cm-md-checkbox': {
    margin: '0 0.35em 0 0',
    verticalAlign: 'middle',
    cursor: 'pointer',
    accentColor: 'var(--primary)',
  },
  '.cm-content[aria-readonly="true"] .cm-md-checkbox': { cursor: 'default' },
  '.cm-md-quote': {
    color: 'var(--syntax-quote)',
    borderLeft: '3px solid var(--syntax-quote)',
    paddingLeft: '0.75em',
  },
  // A rule is an empty line with a bottom border; its `---` shows over it only on the caret line.
  '.cm-md-hr': { borderBottom: '1px solid var(--border)' },
})
