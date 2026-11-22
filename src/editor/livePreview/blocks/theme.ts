import { EditorView } from '@codemirror/view'

/**
 * How the block widgets look. Colors come from the theme tokens. Spacing is padding, never margin:
 * CodeMirror cannot measure a vertical margin on a block, and the heights it tracks would drift.
 */
export const blockTheme = EditorView.baseTheme({
  '.cm-md-table-wrap': {
    padding: '0.45em 0',
    overflowX: 'auto',
    overflowY: 'hidden',
    // Contain horizontal overscroll at the table edge without blocking vertical scroll chaining.
    overscrollBehaviorX: 'contain',
  },
  // A table in a list item: a row of the invisible indent and the table, which scrolls by itself.
  '.cm-md-table-indented': { display: 'flex', alignItems: 'flex-start' },
  '.cm-md-table-indented > .cm-md-table-wrap': { flex: '1 1 auto', minWidth: '0' },
  '.cm-md-table-indent': {
    flex: 'none',
    whiteSpace: 'pre',
    visibility: 'hidden',
    padding: '0.45em 0',
  },
  '.cm-md-table': {
    // Separate, not collapsed, so the outer corners can be rounded; each cell draws its own right
    // and bottom edge and the first row and column the top and left ones, which gives the same grid.
    borderCollapse: 'separate',
    borderSpacing: '0',
    fontSize: '0.95em',
    color: 'var(--foreground)',
    // The editor wraps lines anywhere, which would squeeze every column to a few letters.
    whiteSpace: 'normal',
    overflowWrap: 'normal',
    wordBreak: 'normal',
  },
  '.cm-md-table th, .cm-md-table td': {
    borderRight: '1px solid var(--border)',
    borderBottom: '1px solid var(--border)',
    padding: '0.3em 0.8em',
    textAlign: 'left',
    verticalAlign: 'top',
  },
  '.cm-md-table thead th': { borderTop: '1px solid var(--border)' },
  '.cm-md-table tr > :first-child': { borderLeft: '1px solid var(--border)' },
  '.cm-md-table th': {
    backgroundColor: 'var(--muted)',
    fontWeight: '650',
    // A taller header: the extra is `HEADER_EXTRA` in widgets.ts, which the estimate counts.
    padding: '0.55em 0.8em',
  },
  // Every second body row; the variable is the stripe token or transparent (editor.stripedTables).
  '.cm-md-table tbody tr:nth-child(even) td': {
    backgroundColor: 'var(--doc-table-stripe, transparent)',
  },
  '.cm-md-table thead tr:first-child th:first-child': { borderTopLeftRadius: 'var(--radius)' },
  '.cm-md-table thead tr:first-child th:last-child': { borderTopRightRadius: 'var(--radius)' },
  '.cm-md-table tbody tr:last-child td:first-child': { borderBottomLeftRadius: 'var(--radius)' },
  '.cm-md-table tbody tr:last-child td:last-child': { borderBottomRightRadius: 'var(--radius)' },
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
  // A selected image: an outline on the picture and, once it has loaded, a handle at its corner, both
  // in --handle-active (one color whether or not the pointer is on the handle).
  '.cm-md-image-selected > .cm-md-image-frame': {
    outline: '2px solid var(--handle-active)',
    outlineOffset: '1px',
  },
  '.cm-md-image-handle': {
    position: 'absolute',
    right: '-6px',
    bottom: '-6px',
    width: '12px',
    height: '12px',
    boxSizing: 'border-box',
    border: '2px solid var(--background)',
    borderRadius: '3px',
    backgroundColor: 'var(--handle-active)',
    cursor: 'nwse-resize',
    touchAction: 'none',
  },
  // The caret is somewhere else while an image is selected, so it is not drawn.
  '&.cm-image-selected .cm-content': { caretColor: 'transparent' },
  '&.cm-image-selected .cm-cursorLayer': { visibility: 'hidden' },
  // Inline code in a cell, as outside a table: the code family at the size of the cell's text.
  '.cm-md-table code': {
    fontFamily: 'var(--doc-font-code, var(--font-mono))',
    fontSize: '1em',
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
