import { WidgetType, type EditorView } from '@codemirror/view'
import { imageSizeOf, rememberImageSize, type ImageSize } from './image'
import { cancelDrag, createHandle } from './imageHandle'
import { selectImage } from './imageSelect'
import type { BlockItem, ImageItem, Inline, TableModel } from './scan'

/** Common ground of the block widgets: what kind of block this is, for the field and the tests. */
export abstract class BlockWidget extends WidgetType {
  abstract readonly kind: BlockItem['kind']
}

/** Rough height of one table row in px. CodeMirror measures the real height after the first draw. */
export const ROW_HEIGHT = 33
/**
 * A table with more body rows than this is drawn in two steps: these rows at once, so the first
 * screen is cheap, and the rest after the frame. Laying out a table of 2,900 cells took about 35 ms
 * of every tab switch to the document that opens on it (ISC-6, decisions.md in phase 4).
 */
export const FIRST_ROWS = 50
/** The deferred fill of a table drawn in two steps, by its DOM, so `destroy` can stop it. */
const filling = new WeakMap<HTMLElement, () => void>()
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

    const row = (cells: TableModel['head'], tag: 'th' | 'td'): HTMLElement => {
      const tr = document.createElement('tr')
      cells.forEach((cell, column) => {
        const element = document.createElement(tag)
        const align = this.model.align[column]
        if (align) element.style.textAlign = align
        element.dataset.offset = String(cell.offset)
        appendRuns(element, cell.runs)
        tr.append(element)
      })
      return tr
    }
    const head = document.createElement('thead')
    head.append(row(this.model.head, 'th'))
    const body = document.createElement('tbody')
    const rows = this.model.rows
    for (const cells of rows.slice(0, FIRST_ROWS)) body.append(row(cells, 'td'))
    table.append(head, body)
    wrap.append(table)

    // The rest of a big table: one spacer row as tall as the rows it stands for, replaced by the
    // real rows in a single step after the frame, so the table is laid out once more, not often.
    const remaining = rows.length - FIRST_ROWS
    let spacer: HTMLElement | undefined
    if (remaining > 0) {
      spacer = document.createElement('tr')
      spacer.className = 'cm-md-table-rest'
      const cell = document.createElement('td')
      cell.colSpan = Math.max(1, this.model.head.length)
      cell.style.cssText = `height: ${String(remaining * ROW_HEIGHT)}px; padding: 0; border: 0`
      spacer.append(cell)
      body.append(spacer)
      const fill = (): void => {
        filling.delete(wrap)
        // The swap happens in CodeMirror's own write phase, so the new heights are measured in the
        // same pass as the DOM change and the scroll position is corrected for them.
        view.requestMeasure({
          // CodeMirror keeps one pending request per key, so each table needs a key of its own.
          key: wrap,
          read: () => undefined,
          write: () => {
            const fragment = document.createDocumentFragment()
            for (const cells of rows.slice(FIRST_ROWS)) fragment.append(row(cells, 'td'))
            spacer?.replaceWith(fragment)
            spacer = undefined
          },
        })
      }
      const idle = (window as { requestIdleCallback?: typeof requestIdleCallback })
        .requestIdleCallback
      if (idle === undefined) {
        const handle = setTimeout(fill, 0)
        filling.set(wrap, () => {
          clearTimeout(handle)
        })
      } else {
        const handle = idle.call(window, fill, { timeout: 300 })
        filling.set(wrap, () => {
          cancelIdleCallback(handle)
        })
      }
    }

    wrap.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      const target = event.target instanceof Element ? event.target : null
      let offset: number
      if (spacer !== undefined && target?.closest('.cm-md-table-rest')) {
        // Rows not drawn yet: the row under the pointer, by how far down the spacer it landed.
        const down = (event.clientY - spacer.getBoundingClientRect().top) / ROW_HEIGHT
        const index = Math.min(remaining - 1, Math.max(0, Math.floor(down)))
        offset = rows[FIRST_ROWS + index]?.[0]?.offset ?? 0
      } else {
        const cell = target?.closest<HTMLElement>('th, td')
        offset = Number(cell?.dataset.offset ?? 0)
      }
      // Where the widget is now: its DOM can outlive edits that moved the table.
      const start = view.posAtDOM(wrap)
      event.preventDefault()
      view.dispatch({ selection: { anchor: start + offset }, scrollIntoView: true })
      view.focus()
    })
    return wrap
  }

  override destroy(dom: HTMLElement): void {
    filling.get(dom)?.()
    filling.delete(dom)
  }
}

/** The height of the frontmatter pill with its padding, in px. */
const PILL_HEIGHT = 44

/**
 * The frontmatter block drawn as a pill that says only "Frontmatter". Pressing it puts
 * the caret at the start of the block, which is what makes the pill give way to the YAML.
 */
export class FrontmatterWidget extends BlockWidget {
  readonly kind = 'frontmatter'
  /** The block's own text, which is what makes two widgets for it the same widget. */
  readonly source: string

  constructor(source: string) {
    super()
    this.source = source
  }

  override eq(other: WidgetType): boolean {
    return other instanceof FrontmatterWidget && other.source === this.source
  }

  override get estimatedHeight(): number {
    return PILL_HEIGHT
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-frontmatter'
    const pill = document.createElement('span')
    pill.className = 'cm-md-frontmatter-pill'
    pill.dataset.hint = 'Show the frontmatter'
    const label = document.createElement('span')
    label.className = 'cm-md-frontmatter-label'
    label.textContent = 'Frontmatter'
    pill.append(label)
    wrap.append(pill)
    wrap.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      // Where the widget is now: its DOM can outlive edits that moved it.
      const start = view.posAtDOM(wrap)
      event.preventDefault()
      view.dispatch({ selection: { anchor: start }, scrollIntoView: true })
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

/**
 * The size an image is shown at: an `<img>` tag's `width` and `height` where it has them, with the
 * other side following the picture's own proportions when only one is given. Both given means
 * exactly that box, as a browser draws it.
 */
export function shownSize(
  natural: ImageSize,
  width: number | null,
  height: number | null,
): ImageSize {
  if (width !== null && height !== null) return { width, height }
  if (width !== null) return { width, height: (width * natural.height) / natural.width }
  if (height !== null) return { width: (height * natural.width) / natural.height, height }
  return natural
}

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
  readonly width: number | null
  readonly height: number | null
  readonly html: boolean
  readonly address: string
  /** The image's own text, which a resize is written against. */
  readonly source: string
  /** True while this is the selected image: outlined, with a resize handle once it has loaded. */
  readonly selected: boolean

  constructor(item: ImageItem, selected = false) {
    super()
    this.src = item.src
    this.alt = item.alt
    this.title = item.title
    this.block = item.block
    this.width = item.width
    this.height = item.height
    this.html = item.html
    this.address = item.address
    this.source = item.source
    this.selected = selected
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof ImageWidget &&
      other.src === this.src &&
      other.alt === this.alt &&
      other.title === this.title &&
      other.block === this.block &&
      other.width === this.width &&
      other.height === this.height &&
      other.source === this.source &&
      other.selected === this.selected
    )
  }

  override get estimatedHeight(): number {
    if (!this.block) return -1
    const known = this.src === null ? undefined : imageSizeOf(this.src)
    const shown = known === undefined ? undefined : shownSize(known, this.width, this.height)
    return (shown?.height ?? BLOCK_PLACEHOLDER) + IMAGE_PADDING * 2
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap: HTMLElement = document.createElement(this.block ? 'div' : 'span')
    wrap.className = this.block ? 'cm-md-image cm-md-image-block' : 'cm-md-image'
    if (this.selected) wrap.classList.add('cm-md-image-selected')
    const frame: HTMLElement = document.createElement(this.block ? 'div' : 'span')
    frame.className = 'cm-md-image-frame'
    wrap.append(frame)

    const known = this.src === null ? undefined : imageSizeOf(this.src)
    if (known === undefined) {
      frame.style.minHeight = `${String(this.block ? BLOCK_PLACEHOLDER : INLINE_PLACEHOLDER)}px`
    } else {
      reserve(frame, shownSize(known, this.width, this.height), this.block)
    }

    const fail = (reason: string): void => {
      frame.classList.add('cm-md-image-failed')
      frame.replaceChildren()
      const label = document.createElement('span')
      label.className = 'cm-md-image-label'
      label.textContent = this.alt === '' ? 'image' : this.alt
      frame.append(label)
      // The reason is the more useful hint on a picture that did not load; the title waits.
      delete frame.dataset.hint
      wrap.dataset.hint = reason
      view.requestMeasure()
    }

    if (this.src === null) {
      fail(
        'Not loaded: only a path inside the document folder or its workspace folder, or an https address, can load.',
      )
    } else {
      const src = this.src
      const img = document.createElement('img')
      img.alt = this.alt
      // The picture's own title is a hint drawn by the editor like the shadcn tooltip, never a
      // native `title` attribute (ISC-226). It sits on the frame, which is as wide as the picture.
      if (this.title !== null) frame.dataset.hint = this.title
      img.decoding = 'async'
      img.draggable = false
      // A tag with both sizes is that box exactly, as a browser draws it; the frame's own rule
      // would letterbox it.
      if (this.width !== null && this.height !== null) img.style.objectFit = 'fill'
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
          reserve(frame, shownSize(size, this.width, this.height), this.block)
          frame.classList.add('cm-md-image-loaded')
          // Only a picture that has loaded can be resized.
          if (this.selected && frame.querySelector('.cm-md-image-handle') === null) {
            frame.append(createHandle(view, wrap, frame, this))
          }
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
      event.preventDefault()
      // The caret stays where it was; the click selects the image (outline, handle, keys).
      const start = view.posAtDOM(wrap)
      view.dispatch({ effects: selectImage.of({ from: start, to: start + this.source.length }) })
      view.focus()
    })
    return wrap
  }

  override destroy(dom: HTMLElement): void {
    cancelDrag(dom)
  }
}
