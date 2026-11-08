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
    right: '1em',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.8em',
    lineHeight: '1.4',
    color: 'var(--muted-foreground)',
    pointerEvents: 'none',
    userSelect: 'none',
  },
  // Code: monospace, a little smaller than the prose around it, like inline code.
  '.cm-md-box-code': { fontFamily: 'var(--font-mono)', fontSize: '0.92em' },
})
