import { WidgetType, type EditorView } from '@codemirror/view'
import type { BlockItem, Inline, TableModel } from './scan'

/** Common ground of the block widgets: what kind of block this is, for the field and the tests. */
export abstract class BlockWidget extends WidgetType {
  abstract readonly kind: BlockItem['kind']
}

/** Rough height of one table row in px. CodeMirror measures the real height after the first draw. */
const ROW_HEIGHT = 33
/** The padding above and below a table, in px. */
const TABLE_PADDING = 16

/** Builds `runs` into `parent` as DOM nodes: text nodes and elements only, never markup strings. */
function appendRuns(parent: HTMLElement, runs: readonly Inline[]): void {
  for (const run of runs) {
    if (run.type === 'text') {
      parent.append(document.createTextNode(run.text))
    } else if (run.type === 'code') {
      const code = document.createElement('code')
      code.textContent = run.text
      parent.append(code)
    } else {
      const element = document.createElement(
        run.type === 'strong'
          ? 'strong'
          : run.type === 'em'
            ? 'em'
            : run.type === 'del'
              ? 'del'
              : 'span',
      )
      if (run.type === 'link') element.className = 'cm-md-link'
      appendRuns(element, run.children)
      parent.append(element)
    }
  }
}

/**
 * A GFM table drawn as a read-only HTML table. Pressing a cell puts the caret in that cell's
 * source, which is what makes the table give way to its Markdown.
 */
export class TableWidget extends BlockWidget {
  readonly kind = 'table'
  readonly model: TableModel
  /** The table's own text, which is what makes two widgets for it the same widget. */
  readonly source: string

  constructor(model: TableModel, source: string) {
    super()
    this.model = model
    this.source = source
  }

  /** The same source draws the same table, so CodeMirror keeps the DOM it has. */
  override eq(other: WidgetType): boolean {
    return other instanceof TableWidget && other.source === this.source
  }

  override get estimatedHeight(): number {
    return (this.model.rows.length + 1) * ROW_HEIGHT + TABLE_PADDING
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table-wrap'
    const table = document.createElement('table')
    table.className = 'cm-md-table'

    const row = (parent: HTMLElement, cells: TableModel['head'], tag: 'th' | 'td'): void => {
      const tr = document.createElement('tr')
      cells.forEach((cell, column) => {
        const element = document.createElement(tag)
        const align = this.model.align[column]
        if (align) element.style.textAlign = align
        element.dataset.offset = String(cell.offset)
        appendRuns(element, cell.runs)
        tr.append(element)
      })
      parent.append(tr)
    }
    const head = document.createElement('thead')
    row(head, this.model.head, 'th')
    const body = document.createElement('tbody')
    for (const cells of this.model.rows) row(body, cells, 'td')
    table.append(head, body)
    wrap.append(table)

    wrap.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      const cell =
        event.target instanceof Element ? event.target.closest<HTMLElement>('th, td') : null
      const offset = Number(cell?.dataset.offset ?? 0)
      // Where the widget is now: its DOM can outlive edits that moved the table.
      const start = view.posAtDOM(wrap)
      event.preventDefault()
      view.dispatch({ selection: { anchor: start + offset }, scrollIntoView: true })
      view.focus()
    })
    return wrap
  }
}
