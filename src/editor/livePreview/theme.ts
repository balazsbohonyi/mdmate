import { EditorView } from '@codemirror/view'

/**
 * How rendered Markdown looks. Colors come from the theme tokens. Spacing is padding on `.cm-line`,
 * never margin: CodeMirror cannot measure a vertical margin, and the arrow keys would then skip
 * the line.
 */
export const previewTheme = EditorView.baseTheme({
  // The default highlight style underlines headings; a rendered heading is not underlined.
  '.cm-md-h, .cm-md-h span': { textDecoration: 'none' },
  // The family and the size multiples come from settings.json (documentFonts.ts); the fallbacks
  // are the values the headings had before they were settings.
  '.cm-md-h': {
    fontWeight: '650',
    color: 'var(--syntax-heading)',
    fontFamily: 'var(--doc-font-heading, monospace)',
  },
  // No line height here: a heading inherits the body's (`fonts.lineHeight`), times its own size.
  '.cm-md-h1': {
    fontSize: 'calc(var(--doc-heading-1, 1.7) * 1em)',
    paddingTop: '0.3em',
  },
  '.cm-md-h2': {
    fontSize: 'calc(var(--doc-heading-2, 1.45) * 1em)',
    paddingTop: '0.25em',
  },
  '.cm-md-h3': {
    fontSize: 'calc(var(--doc-heading-3, 1.25) * 1em)',
    paddingTop: '0.2em',
  },
  '.cm-md-h4': { fontSize: 'calc(var(--doc-heading-4, 1.1) * 1em)' },
  '.cm-md-h5': { fontSize: 'calc(var(--doc-heading-5, 1) * 1em)' },
  // Level 6 takes the heading color like the rest: the themes make that the body text color.
  '.cm-md-h6': { fontSize: 'calc(var(--doc-heading-6, 0.95) * 1em)' },
  '.cm-md-setext-mark': { color: 'var(--syntax-marker)' },
  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  // Inline code has the code family at the size of the text around it, a heading included. The
  // code size setting is for blocks only (`.cm-md-box-code`).
  '.cm-md-code': {
    fontFamily: 'var(--doc-font-code, var(--font-mono))',
    fontSize: '1em',
    color: 'var(--syntax-code)',
    backgroundColor: 'var(--syntax-code-background)',
    borderRadius: 'var(--radius)',
  },
  // Selected code reads as selected text: the span's background would hide the selection behind it.
  '.cm-md-code.cm-md-code-selected': {
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
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
  // The en dash of a bullet (bullet.ts): a hidden en dash gives the box its width, and the drawn
  // dash is laid over it, so the dash never overhangs the space after it.
  '.cm-md-bullet': {
    position: 'relative',
    display: 'inline-block',
    color: 'var(--syntax-marker)',
    fontWeight: '700',
  },
  '.cm-md-bullet-width': { visibility: 'hidden' },
  '.cm-md-bullet-dash': { position: 'absolute', left: '0', top: '0' },
  // The colour square before a hex colour in inline code (swatch.ts). The colour is the custom
  // property its element carries; the border keeps a light colour visible on a light page.
  '.cm-md-swatch': {
    display: 'inline-block',
    boxSizing: 'border-box',
    width: '0.8em',
    height: '0.8em',
    margin: '0 0.3em 0 0',
    verticalAlign: '-0.05em',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--swatch)',
  },
  // The copy button of a fenced block (codeCopy.ts): out of the flow at the block's top right, so it
  // takes no room. A block with no container puts it on its first line, which is then the anchor.
  '.cm-md-copy-host': { position: 'relative' },
  '.cm-md-copy': {
    position: 'absolute',
    top: 'calc(var(--box-gap, 0px) + 0.2em)',
    right: '0.5em',
    zIndex: '1',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: 'var(--radius)',
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
    userSelect: 'none',
  },
  '.cm-md-copy:hover': { color: 'var(--foreground)', backgroundColor: 'var(--accent)' },
  '.cm-md-copy[data-copied="true"]': { color: 'var(--success)' },
  // Bottom edge 0.15em under the baseline: the middle of the box is then 0.35em over it, the middle
  // of a capital letter or a digit, which `vertical-align: middle` (the x-height) put too low.
  '.cm-md-checkbox': {
    width: '1em',
    height: '1em',
    margin: '0 0.35em 0 0',
    verticalAlign: '-0.15em',
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
