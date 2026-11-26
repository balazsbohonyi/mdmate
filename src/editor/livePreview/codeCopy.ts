/**
 * The copy button of a fenced code block: a small icon at the block's top right that puts the code
 * on the clipboard.
 *
 * It is a point widget at the start of the opening fence, drawn out of the flow (`position:
 * absolute`), so it takes no room: the caret and the selection never see it, the block keeps its
 * height, and a copy of a selection is the Markdown text as typed. The text it copies is read from
 * the state when the button is pressed, never kept in the widget, so an edit above or inside the
 * block cannot leave it copying old text.
 *
 * The editor does not know the clipboard or the toasts: the document hands both over through the
 * `codeCopy` facet. A view without one draws no button.
 */
import { syntaxTree } from '@codemirror/language'
import { Facet, type EditorState } from '@codemirror/state'
import { WidgetType, type EditorView } from '@codemirror/view'
import { columnsOf } from './listLayout'

/** What the button needs from the app: a way to write the clipboard and to tell the user it failed. */
export interface CodeCopy {
  readonly write: (text: string) => Promise<void>
  readonly notify: (message: string) => void
}

/** The way a view's code blocks are copied. Without one, no button is drawn. */
export const codeCopy = Facet.define<CodeCopy, CodeCopy | null>({
  combine: (values) => values[0] ?? null,
})

/** How long the check mark shows after a copy. */
export const COPIED_MS = 1500

/**
 * The text of the fenced block that starts at `pos` (the start of its opening fence), without the
 * fence lines and without a final line break, or null when no block starts there. A block in a list
 * item or a quote has the markup of its container taken off the front of every line, as far as the
 * opening fence was indented, so what is copied is what the block says and not how it is nested.
 */
export function codeBlockText(state: EditorState, pos: number): string | null {
  let node = syntaxTree(state).resolveInner(pos, 1)
  while (node.name !== 'FencedCode') {
    if (node.parent === null) return null
    node = node.parent
  }
  const doc = state.doc
  const open = doc.lineAt(node.from)
  const marks = node.getChildren('CodeMark')
  const close = marks.length > 1 ? marks[marks.length - 1] : undefined
  const last = close === undefined ? doc.lineAt(node.to).number : doc.lineAt(close.from).number - 1
  // What the lines of the block start with before their own text: the opening line's own markup up
  // to the fence, with list markers as blanks.
  const lead = open.text.slice(0, node.from - open.from).replace(/[^\s>]/g, ' ')
  const lines: string[] = []
  for (let n = open.number + 1; n <= last; n++)
    lines.push(stripLead(doc.line(n).text, lead, state.tabSize))
  return lines.join('\n')
}

/** `text` without up to as many columns of leading blanks and quote marks as `lead` takes. */
function stripLead(text: string, lead: string, tabSize: number): string {
  const width = columnsOf(lead, tabSize)
  let i = 0
  while (i < text.length && columnsOf(text.slice(0, i), tabSize) < width && /[ \t>]/.test(text[i]!))
    i++
  return text.slice(i)
}

const SVG = 'http://www.w3.org/2000/svg'

/** A 14px line icon from the shapes of Lucide's `copy` and `check`, built node by node. */
function icon(shapes: readonly Record<string, string>[]): SVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  for (const [name, value] of Object.entries({
    width: '14',
    height: '14',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(name, value)
  for (const shape of shapes) {
    const element = document.createElementNS(SVG, shape.tag ?? 'path')
    for (const [name, value] of Object.entries(shape))
      if (name !== 'tag') element.setAttribute(name, value)
    svg.append(element)
  }
  return svg
}

const copyIcon = (): SVGElement =>
  icon([
    { tag: 'rect', x: '8', y: '8', width: '14', height: '14', rx: '2', ry: '2' },
    { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' },
  ])
const checkIcon = (): SVGElement => icon([{ d: 'M20 6 9 17l-5-5' }])

/** The button as a CodeMirror widget. All buttons are alike: the block is found when one is pressed. */
export class CopyWidget extends WidgetType {
  override eq(other: WidgetType): boolean {
    return other instanceof CopyWidget
  }

  override toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('span')
    button.className = 'cm-md-copy'
    button.setAttribute('role', 'button')
    button.setAttribute('aria-label', 'Copy code')
    // Hints in the editor are drawn from this attribute (hoverHints.ts), never from `title`.
    button.dataset.hint = 'Copy code'
    button.append(copyIcon())
    let timer: ReturnType<typeof setTimeout> | undefined
    // A press must not move the caret, start a selection or take the focus from the text.
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      const how = view.state.facet(codeCopy)
      if (how === null || !button.isConnected) return
      const text = codeBlockText(view.state, view.posAtDOM(button))
      if (text === null) return
      how.write(text).then(
        () => {
          button.dataset.copied = 'true'
          button.replaceChildren(checkIcon())
          clearTimeout(timer)
          timer = setTimeout(() => {
            delete button.dataset.copied
            button.replaceChildren(copyIcon())
          }, COPIED_MS)
        },
        (error: unknown) => {
          how.notify(
            `Could not copy the code: ${error instanceof Error ? error.message : String(error)}`,
          )
        },
      )
    })
    return button
  }

  // The widget handles its own presses; the editor leaves them to it.
  override ignoreEvent(): boolean {
    return true
  }
}
