/**
 * The styled container: a bordered, rounded panel that lines of the editor sit in. Fenced code
 * uses it now; a Mermaid block can use it later by calling `boxLines` with its own `kind`.
 *
 * The lines stay real lines (no widget replaces them), so the caret, the selection and the syntax
 * colors work as they always do. Each line draws its own slice of the panel with `::before`, and
 * the slices tile because lines abut. The gap between the panel and the text around it is padding
 * inside the first and last line, with the slice inset by the same amount: CodeMirror cannot
 * measure a vertical margin, so a margin would make the heights it tracks drift.
 *
 * Colors, radius and spacing are CSS custom properties on `.cm-md-box`, defaulting to the theme
 * tokens, so both themes work without a token of their own and a kind can override any of them.
 */
import type { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { BUILT_IN_BODY_FAMILY, BUILT_IN_CODE_FAMILY } from '../documentFonts'
import { LIST_GAP } from './listLayout'
import type { LineItem } from './scan'

/** Where a line sits in its container. */
export type BoxPosition = 'first' | 'mid' | 'last' | 'only'

/** The class names the container puts on the page. The theme and the tests both read them. */
export const box = {
  base: 'cm-md-box',
  /** The element that holds the whole container, for a block widget: all four borders at once. */
  whole: 'cm-md-box cm-md-box-whole',
  kind: (kind: string): string => `cm-md-box-${kind}`,
  position: (position: BoxPosition): string => `cm-md-box-${position}`,
  /** The attribute the first line carries for the label drawn at the top right. */
  label: 'data-box-label',
} as const

export interface BoxOptions {
  /** What is in the container (`code`, later `mermaid`): the hook for tweaks of one kind. */
  readonly kind: string
  /** The text at the top right of the container, if any. */
  readonly label?: string | undefined
}

/**
 * The line items for a container that spans `[from, to]` of `doc`, one for each line that
 * overlaps `visible`. A container of ten thousand lines costs what the screen shows, not what the
 * document holds: the first and last line are told apart by their numbers, not by walking.
 */
export function boxLines(
  doc: Text,
  from: number,
  to: number,
  visible: { readonly from: number; readonly to: number },
  options: BoxOptions,
): LineItem[] {
  const first = doc.lineAt(from).number
  const last = doc.lineAt(to).number
  const start = Math.max(first, doc.lineAt(Math.max(0, visible.from)).number)
  const end = Math.min(last, doc.lineAt(Math.min(doc.length, visible.to)).number)
  const items: LineItem[] = []
  for (let n = start; n <= end; n++) {
    const position: BoxPosition =
      first === last ? 'only' : n === first ? 'first' : n === last ? 'last' : 'mid'
    const className = `${box.base} ${box.kind(options.kind)} ${box.position(position)}`
    const label = n === first ? options.label : undefined
    items.push({
      type: 'line',
      from: doc.line(n).from,
      class: className,
      ...(label === undefined || label === '' ? {} : { attributes: { [box.label]: label } }),
    })
  }
  return items
}

const GAP = 'var(--box-gap)'
/** One line of body text: the gap below a list that ends in a container (listLayout.ts). */
const BELOW_LIST = LIST_GAP
/** How far in a container in a list item starts: the item's columns, in spaces of the body text. */
const BOX_LEFT = 'calc(var(--box-columns, 0) * var(--md-space, calc(var(--doc-size, 16px) * 0.55)))'
/** Where its text starts. In px terms, so it is the same in the code font and in the body font. */
const TEXT_LEFT = 'calc(var(--box-left) + var(--box-inset))'

/** How the container looks. Spacing is padding, never margin (see the module comment). */
export const boxTheme = EditorView.baseTheme({
  '.cm-md-box': {
    '--box-background': 'var(--syntax-code-background)',
    '--box-border': 'var(--border)',
    '--box-radius': 'calc(var(--radius) * 2)',
    '--box-gap': '0.55em',
    '--box-pad': '0.3em',
    position: 'relative',
    paddingLeft: '1em',
    paddingRight: '1em',
  },
  '.cm-md-box::before': {
    content: '""',
    position: 'absolute',
    inset: '0',
    zIndex: '-1',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    backgroundColor: 'var(--box-background)',
    borderLeft: '1px solid var(--box-border)',
    borderRight: '1px solid var(--box-border)',
  },
  '.cm-md-box-first, .cm-md-box-only': { paddingTop: `calc(${GAP} + var(--box-pad))` },
  '.cm-md-box-last, .cm-md-box-only': { paddingBottom: `calc(${GAP} + var(--box-pad))` },
  '.cm-md-box-first::before, .cm-md-box-only::before': {
    top: GAP,
    borderTop: '1px solid var(--box-border)',
    borderTopLeftRadius: 'var(--box-radius)',
    borderTopRightRadius: 'var(--box-radius)',
  },
  '.cm-md-box-last::before, .cm-md-box-only::before': {
    bottom: GAP,
    borderBottom: '1px solid var(--box-border)',
    borderBottomLeftRadius: 'var(--box-radius)',
    borderBottomRightRadius: 'var(--box-radius)',
  },
  // A block widget that holds a whole container (a rendered Mermaid diagram, later) takes the same
  // variables and draws all four borders itself.
  '.cm-md-box-whole': {
    boxSizing: 'border-box',
    padding: 'var(--box-pad) 1em',
    backgroundColor: 'var(--box-background)',
    border: '1px solid var(--box-border)',
    borderRadius: 'var(--box-radius)',
  },
  '.cm-md-box-whole::before': { display: 'none' },
  // The label is a line attribute drawn by CSS, so it is not text: it cannot be selected or copied
  // and takes no room in the line.
  '.cm-md-box-first[data-box-label]::after, .cm-md-box-only[data-box-label]::after': {
    content: 'attr(data-box-label)',
    position: 'absolute',
    top: `calc(${GAP} + 0.35em)`,
    left: '1em',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.8em',
    lineHeight: '1.4',
    color: 'var(--muted-foreground)',
    pointerEvents: 'none',
    userSelect: 'none',
  },
  // The hidden run of body spaces that listSpace.ts measures.
  '.cm-md-space-probe': {
    position: 'absolute',
    top: '0',
    left: '0',
    whiteSpace: 'pre',
    visibility: 'hidden',
    pointerEvents: 'none',
    fontFamily: `var(--doc-font-body, ${BUILT_IN_BODY_FAMILY})`,
    fontSize: 'var(--doc-size, 16px)',
  },
  // A container in a list item starts at the item's indent. The typed blanks before the code stay
  // in the line and are pulled back out of it, so the code starts at the container's own inside edge
  // and a wrapped row starts there too.
  '.cm-line.cm-md-box-nested': {
    '--box-left': BOX_LEFT,
    '--box-inset': 'calc(var(--doc-size, 16px) * 0.875)',
    paddingLeft: TEXT_LEFT,
    textIndent: 'calc(var(--box-lead, 0) * -1ch)',
  },
  '.cm-line.cm-md-box-nested::before': { left: 'var(--box-left)' },
  '.cm-line.cm-md-box-nested.cm-md-box-first[data-box-label]::after, .cm-line.cm-md-box-nested.cm-md-box-only[data-box-label]::after':
    { left: TEXT_LEFT, textIndent: '0' },
  // A fence on the marker line: the marker starts the line, left of the container, in the body text
  // it belongs to, and takes exactly the room up to the code.
  '.cm-line.cm-md-box-nested.cm-md-box-marker': {
    textIndent: 'calc(-1 * (var(--box-left) + var(--box-inset)))',
  },
  '.cm-md-box-marker .cm-md-box-lead': {
    display: 'inline-block',
    minWidth: TEXT_LEFT,
    textIndent: '0',
    whiteSpace: 'pre',
    fontFamily: `var(--doc-font-body, ${BUILT_IN_BODY_FAMILY})`,
    fontSize: 'var(--doc-size, 16px)',
  },
  // A list that ends in a container: one line of body text below the panel, in place of its gap.
  '.cm-line.cm-md-box-last.cm-md-list-end, .cm-line.cm-md-box-only.cm-md-list-end': {
    paddingBottom: `calc(${BELOW_LIST} + var(--box-pad))`,
  },
  '.cm-line.cm-md-box-last.cm-md-list-end::before, .cm-line.cm-md-box-only.cm-md-list-end::before':
    { bottom: BELOW_LIST },
  // Code blocks: monospace at the code size setting (inline code follows the text size instead).
  '.cm-md-box-code': {
    '--box-border': 'var(--syntax-code-border)',
    fontFamily: `var(--doc-font-code, ${BUILT_IN_CODE_FAMILY})`,
    fontSize: 'calc(var(--doc-code-ratio, calc(14 / 16)) * 1em)',
    // Its own line height (`fonts.codeLineHeight`); the label above stays on a fixed 1.4, since it
    // is out of the flow of the lines and only its own height depends on it.
    lineHeight: 'var(--doc-code-line-height, 1.5)',
  },
})
