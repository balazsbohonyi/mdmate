import { syntaxTree } from '@codemirror/language'
import { type EditorState, StateEffect, type Extension } from '@codemirror/state'
import {
  EditorView,
  GutterMarker,
  gutter,
  highlightActiveLineGutter,
  ViewPlugin,
} from '@codemirror/view'
import { DEFAULT_HEADING_SCALE, settings } from '@/lib/settings'
import { FrontmatterWidget } from './livePreview/blocks/widgets'
import { frontmatterEnd } from './livePreview/frontmatter'

/**
 * The line-number gutter, from `editor.lineNumbers` in settings.json (off by default; P9.1-T16).
 *
 * Every state carries the gutter, like word wrap, so a change of the setting reaches the tabs that
 * are open with no restart: the editor gets a class while the setting is on (the theme hides the
 * gutter without it) and the numbers are drawn only then. A view that is not shown has nothing to
 * update; it asks the setting when it is.
 *
 * The numbers are source line numbers. A wrapped line has one number, on its first row. A block
 * widget that replaces lines (a table, a picture) shows the number of its first source line and the
 * lines it hides have none. The frontmatter pill has no number of its own, so the first line after a
 * five-line frontmatter is 6; with the caret inside it the pill goes and its lines show 1 to 5.
 *
 * A heading line is taller than body text and its text sits lower (a heading has top padding), so the
 * gutter element of a heading line carries its level (`cm-gutter-hN`) and the theme moves the number
 * down to the middle of the heading's first row (`headingGutterRules`).
 */

const views = new Set<EditorView>()

/** Says the setting changed, so the gutter draws its markers again. */
const refresh = StateEffect.define<null>()

/** Tracks the views that show a state with this extension, so a change of the setting reaches them. */
const tracker = ViewPlugin.define((view) => {
  views.add(view)
  return {
    destroy() {
      views.delete(view)
    },
  }
})

class NumberMarker extends GutterMarker {
  readonly text: string
  /** The heading level of the line (1 to 6), or 0 for any other line. */
  readonly level: number

  constructor(text: string, level = 0) {
    super()
    this.text = text
    this.level = level
    if (level > 0) this.elementClass = `cm-gutter-h${String(level)}`
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof NumberMarker && other.text === this.text && other.level === this.level
  }

  override toDOM(): Node {
    return document.createTextNode(this.text)
  }
}

/**
 * The heading level of the line that starts at `from`, as live preview gives it (`cm-md-hN`): an ATX
 * heading on that line, also one in a quote or a list item, or a line of a Setext heading other than
 * its underline. 0 for any other line, and for the lines of the frontmatter.
 */
function headingLevel(state: EditorState, from: number): number {
  const doc = state.doc
  const frontmatter = frontmatterEnd(doc)
  if (frontmatter !== null && from < frontmatter) return 0
  const line = doc.lineAt(from)
  let level = 0
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (level > 0) return false
      const atx = /^ATXHeading(\d)$/.exec(node.name)
      if (atx !== null) {
        if (doc.lineAt(node.from).number === line.number) level = Math.min(6, Number(atx[1]) || 1)
        return false
      }
      const setext = /^SetextHeading(\d)$/.exec(node.name)
      if (setext !== null) {
        // The last line of the node is the underline, which is not a heading line.
        if (line.number >= doc.lineAt(node.from).number && line.number < doc.lineAt(node.to).number)
          level = Number(setext[1]) === 2 ? 2 : 1
        return false
      }
      return undefined
    },
  })
  return level
}

/** The widest number the document can reach, so the gutter keeps one width while it is edited. */
const widest = (lines: number): string => '9'.repeat(Math.max(2, String(lines).length))

const numberOf = (view: EditorView, pos: number): NumberMarker =>
  new NumberMarker(String(view.state.doc.lineAt(pos).number), headingLevel(view.state, pos))

const numbers = gutter({
  class: 'cm-lineNumbers',
  lineMarker(view, line) {
    return settings.editor.lineNumbers ? numberOf(view, line.from) : null
  },
  // A block widget (a table, a picture) shows the number of its first source line. The frontmatter
  // pill has none.
  widgetMarker(view, widget, block) {
    return settings.editor.lineNumbers && !(widget instanceof FrontmatterWidget)
      ? numberOf(view, block.from)
      : null
  },
  // The tree can grow with no edit (a long document parses in steps), and a heading is read from it.
  lineMarkerChange: (update) =>
    syntaxTree(update.startState) !== syntaxTree(update.state) ||
    update.transactions.some((transaction) => transaction.effects.some((e) => e.is(refresh))),
  initialSpacer: (view) => new NumberMarker(widest(view.state.doc.lines)),
  updateSpacer(spacer, update) {
    const text = widest(update.state.doc.lines)
    return spacer instanceof NumberMarker && spacer.text === text ? spacer : new NumberMarker(text)
  },
})

export const lineNumbers: Extension = [
  numbers,
  highlightActiveLineGutter(),
  // The class the theme keys the gutter's place and its visibility on.
  EditorView.editorAttributes.of(() =>
    settings.editor.lineNumbers ? { class: 'cm-lineNumbersOn' } : null,
  ),
  tracker,
]

/** Gives every view that is showing one update, so it asks the setting again. */
export function refreshLineNumbers(): void {
  for (const view of views) view.dispatch({ effects: refresh.of(null) })
}

/** The top padding of a heading line in live preview, in em of the heading's own size (theme.ts). */
const HEADING_PADDING_TOP = [0.3, 0.25, 0.2, 0, 0, 0] as const

/**
 * Theme rules that move the number of a heading line to the middle of the heading's first row. The
 * heading row starts after its top padding (P of its own size S times the text size) and is S times
 * as high as a body row, while the number is drawn in a body row high box: it moves down by
 * P*S*text + (S - 1)*line height*text / 2.
 */
export function headingGutterRules(): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {}
  HEADING_PADDING_TOP.forEach((padding, index) => {
    const scale = `var(--doc-heading-${String(index + 1)}, ${String(DEFAULT_HEADING_SCALE[index])})`
    const text = 'var(--doc-size, 15px)'
    rules[`&.cm-lineNumbersOn .cm-lineNumbers .cm-gutterElement.cm-gutter-h${String(index + 1)}`] =
      {
        paddingTop: `calc(${String(padding)} * ${scale} * ${text} + (${scale} - 1) * var(--doc-line-height, 1.4) * ${text} / 2)`,
      }
  })
  return rules
}
