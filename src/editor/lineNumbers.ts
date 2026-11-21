import { StateEffect, type Extension } from '@codemirror/state'
import {
  EditorView,
  GutterMarker,
  gutter,
  highlightActiveLineGutter,
  ViewPlugin,
} from '@codemirror/view'
import { settings } from '@/lib/settings'
import { FrontmatterWidget } from './livePreview/blocks/widgets'

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

  constructor(text: string) {
    super()
    this.text = text
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof NumberMarker && other.text === this.text
  }

  override toDOM(): Node {
    return document.createTextNode(this.text)
  }
}

/** The widest number the document can reach, so the gutter keeps one width while it is edited. */
const widest = (lines: number): string => '9'.repeat(Math.max(2, String(lines).length))

const numberOf = (view: EditorView, pos: number): NumberMarker =>
  new NumberMarker(String(view.state.doc.lineAt(pos).number))

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
  lineMarkerChange: (update) =>
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
