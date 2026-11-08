import { EditorView } from '@codemirror/view'

/**
 * How the block widgets look. Colors come from the theme tokens. Spacing is padding, never margin:
 * CodeMirror cannot measure a vertical margin on a block, and the heights it tracks would drift.
 */
export const blockTheme = EditorView.baseTheme({
  '.cm-md-table-wrap': { padding: '0.45em 0', overflowX: 'auto', overflowY: 'hidden' },
  '.cm-md-table': {
    borderCollapse: 'collapse',
    fontSize: '0.95em',
    color: 'var(--foreground)',
    // The editor wraps lines anywhere, which would squeeze every column to a few letters.
    whiteSpace: 'normal',
    overflowWrap: 'normal',
    wordBreak: 'normal',
  },
  '.cm-md-table th, .cm-md-table td': {
    border: '1px solid var(--border)',
    padding: '0.3em 0.8em',
    textAlign: 'left',
    verticalAlign: 'top',
  },
  '.cm-md-table th': {
    backgroundColor: 'var(--muted)',
    fontWeight: '650',
  },
  '.cm-md-table code': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.92em',
    color: 'var(--syntax-code)',
    backgroundColor: 'var(--syntax-code-background)',
    borderRadius: 'var(--radius)',
  },
  '.cm-md-table .cm-md-link': {
    color: 'var(--syntax-link)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
})
