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
  '.cm-md-frontmatter': { padding: '0.4em 0 0.4em 6px' },
  '.cm-md-frontmatter-pill': {
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: '0.7em',
    maxWidth: '100%',
    padding: '0.2em 0.9em',
    border: '1px solid var(--border)',
    borderRadius: '999px',
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    fontSize: '0.85em',
    cursor: 'pointer',
  },
  '.cm-md-frontmatter-label': { fontWeight: '650', color: 'var(--foreground)' },
  '.cm-md-frontmatter-keys': {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-md-image-block': { padding: '14px 0' },
  '.cm-md-image-frame': {
    display: 'inline-block',
    position: 'relative',
    verticalAlign: 'middle',
    boxSizing: 'border-box',
    maxWidth: '100%',
  },
  '.cm-md-image-block > .cm-md-image-frame': { display: 'block' },
  '.cm-md-image-frame img': {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  '.cm-md-image-frame:not(.cm-md-image-loaded)': { backgroundColor: 'var(--muted)' },
  // Until the box has its real size the picture stays out of the layout, so it cannot resize it.
  '.cm-md-image-frame:not(.cm-md-image-sized) img': {
    position: 'absolute',
    inset: '0',
    opacity: '0',
  },
  '.cm-md-image-frame.cm-md-image-failed': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px dashed var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--muted-foreground)',
    fontStyle: 'italic',
    padding: '0 0.6em',
    overflow: 'hidden',
  },
  '.cm-md-image-label': { overflowWrap: 'anywhere' },
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
