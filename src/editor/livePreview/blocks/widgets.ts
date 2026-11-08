import { WidgetType, type EditorView } from '@codemirror/view'
import { imageSizeOf, rememberImageSize, type ImageSize } from './image'
import type { BlockItem, ImageItem, Inline, TableModel } from './scan'

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

/** The height a block image holds while it loads, and when it fails. A fixed size, so nothing moves. */
const BLOCK_PLACEHOLDER = 160
/** Same, for an image inside a line of text. A badge is about this tall. */
const INLINE_PLACEHOLDER = 20
/** The padding above and below a block image, in px. */
const IMAGE_PADDING = 14

/** Fits `frame` to an image of this size, so it takes the space the image will fill. */
function reserve(frame: HTMLElement, size: ImageSize, block: boolean): void {
  frame.classList.add('cm-md-image-sized')
  frame.style.minHeight = ''
  frame.style.aspectRatio = `${String(size.width)} / ${String(size.height)}`
  if (block) {
    frame.style.width = '100%'
    frame.style.maxWidth = `${String(size.width)}px`
  } else {
    frame.style.width = `${String(size.width)}px`
    frame.style.maxWidth = '100%'
  }
}

/** CodeMirror anchors the scroll position on the block that holds the point this far below the top. */
const ANCHOR_PROBE_PX = 12

/** The first text line that is fully in view, and where it is on the screen. */
function firstVisibleLine(view: EditorView): { line: HTMLElement; top: number } | undefined {
  const edge = view.scrollDOM.getBoundingClientRect().top
  for (const line of view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')) {
    const top = line.getBoundingClientRect().top
    if (top >= edge) return { line, top }
  }
  return undefined
}

/**
 * The line a height change of this block would move, when CodeMirror would not make up for it, or
 * undefined. It makes up for a height change only above the block that holds a point just under
 * the top of the view. A block wholly above that point is covered, and one below the first visible
 * line moves only the text after it. A block in between (the one holding the point itself, or one
 * between it and the first line) is not covered, and the first line moves down by all of the
 * growth (ISC-72).
 *
 * Several images can load in one frame, and the first one to grow can push lines into view that
 * were hidden, so the line is picked here, before any of them has changed.
 */
function lineItWouldMove(view: EditorView, element: HTMLElement): HTMLElement | undefined {
  const box = element.getBoundingClientRect()
  if (box.bottom <= view.scrollDOM.getBoundingClientRect().top + ANCHOR_PROBE_PX) return undefined
  const first = firstVisibleLine(view)
  return first !== undefined && box.bottom <= first.top + 1 ? first.line : undefined
}

/**
 * Runs `change`, then scrolls so `line` is exactly where it was just before. The position is read
 * now, not earlier, so it leaves out whatever other images already did in this same cycle.
 */
function keepLine(view: EditorView, line: HTMLElement, change: () => void): void {
  const top = line.getBoundingClientRect().top
  change()
  if (!line.isConnected) return
  const moved = line.getBoundingClientRect().top - top
  if (Math.abs(moved) >= 0.5) view.scrollDOM.scrollTop += moved
}

/**
 * An image drawn in place of its Markdown, alone on its line (a block) or inside the text. It
 * holds a fixed-size box from the first draw: the remembered size of the image when it has loaded
 * before, otherwise a placeholder. A failed or refused image keeps that box and shows its alt text,
 * so a late load or a failure never moves the text around it (ISC-72, ISC-182).
 */
export class ImageWidget extends BlockWidget {
  readonly kind = 'image'
  readonly src: string | null
  readonly alt: string
  readonly title: string | null
  readonly block: boolean

  constructor(item: ImageItem) {
    super()
    this.src = item.src
    this.alt = item.alt
    this.title = item.title
    this.block = item.block
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof ImageWidget &&
      other.src === this.src &&
      other.alt === this.alt &&
      other.title === this.title &&
      other.block === this.block
    )
  }

  override get estimatedHeight(): number {
    if (!this.block) return -1
    const known = this.src === null ? undefined : imageSizeOf(this.src)
    return (known?.height ?? BLOCK_PLACEHOLDER) + IMAGE_PADDING * 2
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap: HTMLElement = document.createElement(this.block ? 'div' : 'span')
    wrap.className = this.block ? 'cm-md-image cm-md-image-block' : 'cm-md-image'
    const frame: HTMLElement = document.createElement(this.block ? 'div' : 'span')
    frame.className = 'cm-md-image-frame'
    wrap.append(frame)

    const known = this.src === null ? undefined : imageSizeOf(this.src)
    if (known === undefined) {
      frame.style.minHeight = `${String(this.block ? BLOCK_PLACEHOLDER : INLINE_PLACEHOLDER)}px`
    } else {
      reserve(frame, known, this.block)
    }

    const fail = (reason: string): void => {
      frame.classList.add('cm-md-image-failed')
      frame.replaceChildren()
      const label = document.createElement('span')
      label.className = 'cm-md-image-label'
      label.textContent = this.alt === '' ? 'image' : this.alt
      frame.append(label)
      wrap.title = reason
      view.requestMeasure()
    }

    if (this.src === null) {
      fail('Not loaded: only a path inside the document folder, or an https address, can load.')
    } else {
      const src = this.src
      const img = document.createElement('img')
      img.alt = this.alt
      if (this.title !== null) img.title = this.title
      img.decoding = 'async'
      img.draggable = false
      // The address of the document is nobody else's business.
      img.referrerPolicy = 'no-referrer'
      img.addEventListener('load', () => {
        if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
          fail('This image has no size the editor can use.')
          return
        }
        const size = { width: img.naturalWidth, height: img.naturalHeight }
        rememberImageSize(src, size.width, size.height)
        // The size goes in during the view's own measure cycle, where it is known what the
        // scroll position is and where the first line is. Applied here it could land after a
        // scroll that moved the image into the one place nothing makes up for.
        const apply = (): void => {
          reserve(frame, size, this.block)
          frame.classList.add('cm-md-image-loaded')
        }
        view.requestMeasure({
          read: () => (wrap.isConnected ? lineItWouldMove(view, wrap) : undefined),
          write: (line: HTMLElement | undefined) => {
            if (line !== undefined) keepLine(view, line, apply)
            else apply()
            // Have the new height measured in this same cycle. A plain request is ignored while a
            // cycle runs; one with a read of its own makes the loop take another pass.
            view.requestMeasure({ read: () => null })
          },
        })
      })
      img.addEventListener('error', () => {
        fail('This image could not be loaded.')
      })
      frame.append(img)
      img.src = src
    }

    wrap.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      const start = view.posAtDOM(wrap)
      event.preventDefault()
      view.dispatch({ selection: { anchor: start }, scrollIntoView: true })
      view.focus()
    })
    return wrap
  }
}
