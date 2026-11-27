import {
  ChangeSet,
  Facet,
  StateEffect,
  StateField,
  type Extension,
  type Text,
} from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { HEADING_SCAN_DELAY_MS } from '@/lib/headingScan'
import { settings } from '@/lib/settings'
import { BUILT_IN_CODE_FAMILY } from './documentFonts'
import {
  buildOutline,
  depthAt,
  EMPTY_OUTLINE,
  mapOutline,
  stackAt,
  type Outline,
} from './stickyOutline'

/**
 * Sticky headings: the headings that lead to the top visible line stay stacked over the top of the
 * editor, one row per level, as their source lines. A click goes to that heading.
 *
 * The headings come from outside (`headingSource`: a scan of the whole text, since the editor's own
 * parser stops partway through a long file). The answer is kept as positions on the state, which
 * edits move along; a new scan follows a pause in typing. The stack lies over the text and moves
 * nothing; `scrollMargins` keeps the caret and the target of a jump below it.
 */

/** A heading as a scan names it: its level and its line, from 1. */
export interface ScannedHeading {
  readonly level: number
  readonly line: number
}

/** Reads the headings of the text the document holds now. */
export type HeadingSource = () => Promise<readonly ScannedHeading[]>

export const headingSource = Facet.define<HeadingSource, HeadingSource | null>({
  combine: (values) => values[0] ?? null,
})

/** The height of a row on a page that cannot measure one (a test). */
export const ROW_FALLBACK = 21

const setOutline = StateEffect.define<Outline>()
/** Says the setting changed. */
const refresh = StateEffect.define<null>()

const outlineField = StateField.define<Outline>({
  create: () => EMPTY_OUTLINE,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setOutline)) return effect.value
    return tr.docChanged ? mapOutline(value, tr.changes) : value
  },
})

const views = new Set<EditorView>()

const asked = (view: EditorView): boolean =>
  settings.editor.stickyHeadings && view.state.facet(headingSource) !== null

interface Row {
  readonly pos: number
  readonly text: string
}

interface Measured {
  readonly rows: readonly Row[]
  readonly rowHeight: number
  /** Where the text of a line starts, from the editor's left edge. */
  readonly textLeft: number
  /** The room the vertical scrollbar takes. */
  readonly right: number
}

class StickyStack {
  /** The height of one row, as last measured. */
  rowHeight = ROW_FALLBACK
  private readonly view: EditorView
  private readonly sourced: boolean
  private readonly dom = document.createElement('div')
  private readonly probe = document.createElement('div')
  private readonly list = document.createElement('div')
  private drawn = ''
  private timer: ReturnType<typeof setTimeout> | undefined
  /** The edits made since the scan that is under way was asked for. */
  private since: ChangeSet | null = null
  private asking = 0
  private readonly onScroll = (): void => {
    this.measure()
  }

  constructor(view: EditorView) {
    this.view = view
    this.dom.className = 'cm-md-sticky'
    this.probe.className = 'cm-md-sticky-row cm-md-sticky-probe'
    this.probe.setAttribute('aria-hidden', 'true')
    this.probe.textContent = '#'
    this.dom.append(this.probe, this.list)
    // The stack lies beside the scroller, not in it, so it passes the wheel on.
    this.dom.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey) view.scrollDOM.scrollTop += event.deltaY
      },
      { passive: true },
    )
    this.sourced = view.state.facet(headingSource) !== null
    // A view with no headings to show (a code file, the theme preview) gets nothing.
    if (!this.sourced) return
    view.dom.append(this.dom)
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
    views.add(view)
    if (asked(view)) this.scanIn(0)
    this.measure()
  }

  update(update: ViewUpdate): void {
    if (!this.sourced) return
    const toggled = update.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))
    if (update.docChanged) {
      this.since = this.since?.compose(update.changes) ?? null
      if (asked(update.view)) this.scanIn(HEADING_SCAN_DELAY_MS)
    } else if (toggled && asked(update.view)) this.scanIn(0)
    if (
      toggled ||
      update.docChanged ||
      update.geometryChanged ||
      update.viewportChanged ||
      update.startState.field(outlineField) !== update.state.field(outlineField)
    )
      this.measure()
  }

  destroy(): void {
    clearTimeout(this.timer)
    this.asking += 1
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
    this.dom.remove()
    views.delete(this.view)
  }

  private scanIn(delay: number): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.scan(), delay)
  }

  private async scan(): Promise<void> {
    const source = this.view.state.facet(headingSource)
    if (source === null) return
    const mine = ++this.asking
    const text: Text = this.view.state.doc
    this.since = ChangeSet.empty(text.length)
    let headings: readonly ScannedHeading[]
    try {
      headings = await source()
    } catch {
      // The last answer stays; the next pause in typing asks again.
      return
    }
    if (mine !== this.asking) return
    // The line numbers are those of the text that was scanned; edits since then move them.
    const outline = mapOutline(buildOutline(text, headings), this.since)
    this.since = null
    this.view.dispatch({ effects: setOutline.of(outline) })
  }

  private measure(): void {
    this.view.requestMeasure({
      key: this,
      read: (view): Measured => this.read(view),
      write: (measured) => {
        this.write(measured)
      },
    })
  }

  private read(view: EditorView): Measured {
    const rowHeight = this.probe.offsetHeight || ROW_FALLBACK
    const outline = view.state.field(outlineField)
    // The top of what is visible, as a height in the document.
    const top = view.scrollDOM.getBoundingClientRect().top - view.documentTop
    const stack = asked(view)
      ? stackAt(outline, top, rowHeight, (pos) => view.lineBlockAt(pos))
      : []
    const editor = view.dom.getBoundingClientRect()
    const content = view.contentDOM.getBoundingClientRect()
    const line = view.contentDOM.querySelector('.cm-line')
    const padding = line === null ? 0 : Number.parseFloat(getComputedStyle(line).paddingLeft) || 0
    return {
      rows: stack.map((index) => {
        const at = view.state.doc.lineAt(outline.positions[index] ?? 0)
        return { pos: at.from, text: at.text }
      }),
      rowHeight,
      textLeft: content.left - editor.left + padding,
      right: view.scrollDOM.offsetWidth - view.scrollDOM.clientWidth,
    }
  }

  private write(measured: Measured): void {
    this.rowHeight = measured.rowHeight
    this.dom.style.setProperty('--sticky-text-left', `${String(measured.textLeft)}px`)
    this.dom.style.right = `${String(measured.right)}px`
    const wanted = JSON.stringify(measured.rows)
    if (wanted === this.drawn) return
    this.drawn = wanted
    this.dom.classList.toggle('cm-md-sticky-shown', measured.rows.length > 0)
    this.list.replaceChildren(...measured.rows.map((row) => this.rowOf(row)))
  }

  private rowOf(row: Row): HTMLElement {
    const element = document.createElement('div')
    element.className = 'cm-md-sticky-row'
    element.textContent = row.text
    // Taken on the press, so the editor keeps its focus and no text under the row is touched.
    element.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      const pos = Math.min(row.pos, this.view.state.doc.length)
      // Focus first: taking it can read the page's old selection back into the editor.
      this.view.focus()
      this.view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'start' }),
      })
    })
    return element
  }
}

const stack = ViewPlugin.fromClass(StickyStack)

/** Room above the caret for the headings that can stand over it, so a jump lands below them. */
const margins = EditorView.scrollMargins.of((view) => {
  const plugin = view.plugin(stack)
  if (plugin === null || !asked(view)) return null
  const { doc, selection } = view.state
  const line = doc.lineAt(selection.main.head)
  const depth = depthAt(view.state.field(outlineField), line.from, line.to)
  return depth === 0 ? null : { top: depth * plugin.rowHeight }
})

const theme = EditorView.baseTheme({
  '.cm-md-sticky': {
    position: 'absolute',
    top: '0',
    left: '0',
    // Above the text and the gutter (CodeMirror puts the gutter at 200).
    zIndex: '210',
    overflow: 'hidden',
    backgroundColor: 'var(--sticky-background)',
    fontFamily: `var(--doc-font-code, ${BUILT_IN_CODE_FAMILY})`,
    fontSize: 'calc(var(--doc-code-ratio, calc(14 / 16)) * var(--doc-size, 16px))',
    userSelect: 'none',
  },
  '.cm-md-sticky.cm-md-sticky-shown': { borderBottom: '1px solid var(--border)' },
  '.cm-md-sticky-row': {
    position: 'relative',
    whiteSpace: 'pre',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    paddingLeft: 'var(--sticky-text-left, 0px)',
    color: 'var(--foreground)',
    cursor: 'pointer',
  },
  '.cm-md-sticky-row:hover': { backgroundColor: 'var(--accent)' },
  // Measures a row's height while none is shown.
  '.cm-md-sticky-row.cm-md-sticky-probe': {
    position: 'absolute',
    visibility: 'hidden',
    pointerEvents: 'none',
  },
})

export const stickyHeadings: Extension = [outlineField, stack, margins, theme]

/** Gives every view that is showing one update, so it asks the setting again. */
export function refreshStickyHeadings(): void {
  for (const view of views) view.dispatch({ effects: refresh.of(null) })
}
