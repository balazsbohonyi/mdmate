import { type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/**
 * Hints for things drawn inside the editor: a broken link, the frontmatter pill, an image that did
 * not load (ISC-226). The editor is a CodeMirror DOM outside Vue, so the shadcn Tooltip cannot wrap
 * them; instead any element carrying `data-hint="..."` gets a hint drawn here with the same tokens
 * as the shadcn tooltip (popover colors, ring, shadow, arrow; the look is `.editor-hint` in
 * `styles/tokens.css`), so it follows dark and light. It is drawn at the pointer, above it where
 * there is room and below it otherwise, because a hovered thing can be a whole picture. The
 * native `title` attribute is never used.
 */

/** How long a hover waits before the hint shows, as for every other hint in the app. */
export const EDITOR_HINT_DELAY = 300
/** The gap between the pointer and a hint above it, room for the arrow. */
const GAP = 8
/** The gap below the pointer, clear of the pointer glyph itself, room for the arrow. */
const GAP_BELOW = 22

interface Point {
  readonly x: number
  readonly y: number
}

/** The element the pointer is over that has a hint, inside `root`. */
function hinted(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const found = target.closest<HTMLElement>('[data-hint]')
  return found !== null && root.contains(found) && found.dataset.hint !== '' ? found : null
}

function arrowFor(side: 'above' | 'below'): HTMLElement {
  const arrow = document.createElement('div')
  arrow.className = 'editor-hint-arrow'
  arrow.dataset.side = side
  return arrow
}

class HoverHints {
  #current: HTMLElement | null = null
  #timer: ReturnType<typeof setTimeout> | undefined
  #tip: HTMLElement | null = null
  /** Where the pointer last was, which is where the hint goes. */
  #pointer: Point | null = null
  readonly #view: EditorView
  readonly #move = (event: Event): void => {
    this.#remember(event)
  }
  readonly #over = (event: Event): void => {
    this.#remember(event)
    const el = hinted(event.target, this.#view.dom)
    if (el === this.#current) return
    this.#hide()
    if (el !== null) this.#wait(el)
  }
  readonly #out = (event: Event): void => {
    if (this.#current === null) return
    const to = (event as PointerEvent).relatedTarget
    if (to instanceof Node && this.#current.contains(to)) return
    this.#hide()
  }
  readonly #away = (): void => {
    this.#hide()
  }

  constructor(view: EditorView) {
    this.#view = view
    view.dom.addEventListener('pointerover', this.#over)
    view.dom.addEventListener('pointermove', this.#move)
    view.dom.addEventListener('pointerout', this.#out)
    view.dom.addEventListener('pointerdown', this.#away)
    view.dom.addEventListener('keydown', this.#away)
    view.scrollDOM.addEventListener('scroll', this.#away)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.selectionSet) this.#hide()
  }

  destroy(): void {
    this.#hide()
    this.#view.dom.removeEventListener('pointerover', this.#over)
    this.#view.dom.removeEventListener('pointermove', this.#move)
    this.#view.dom.removeEventListener('pointerout', this.#out)
    this.#view.dom.removeEventListener('pointerdown', this.#away)
    this.#view.dom.removeEventListener('keydown', this.#away)
    this.#view.scrollDOM.removeEventListener('scroll', this.#away)
  }

  #remember(event: Event): void {
    if (event instanceof MouseEvent) this.#pointer = { x: event.clientX, y: event.clientY }
  }

  #wait(el: HTMLElement): void {
    this.#current = el
    this.#timer = setTimeout(() => {
      this.#show(el)
    }, EDITOR_HINT_DELAY)
  }

  #hide(): void {
    clearTimeout(this.#timer)
    this.#current = null
    this.#tip?.remove()
    this.#tip = null
  }

  #show(el: HTMLElement): void {
    const text = el.dataset.hint ?? ''
    if (!el.isConnected || text === '') return
    const tip = document.createElement('div')
    tip.className = 'editor-hint'
    tip.setAttribute('data-hover-hint', '')
    tip.setAttribute('role', 'tooltip')
    tip.textContent = text
    document.body.append(tip)
    // At the pointer, not at the hovered thing: a big picture would put the hint far from it. A
    // pointer that was never seen (a synthetic hover) falls back to the middle of the thing.
    const box = tip.getBoundingClientRect()
    const target = el.getBoundingClientRect()
    const at = this.#pointer ?? { x: target.left + target.width / 2, y: target.top }
    const above = at.y - box.height - GAP >= 0
    const side = above ? 'above' : 'below'
    tip.append(arrowFor(side))
    const left = Math.min(Math.max(at.x - box.width / 2, 4), window.innerWidth - box.width - 4)
    tip.style.left = `${String(left)}px`
    tip.style.top = `${String(above ? at.y - box.height - GAP : at.y + GAP_BELOW)}px`
    // The arrow points at the pointer, even when the box was kept on screen.
    const arrow = tip.lastElementChild
    if (arrow instanceof HTMLElement) arrow.style.left = `${String(at.x - left)}px`
    this.#tip = tip
  }
}

/** Hints for `data-hint` elements inside the editor, drawn like the shadcn tooltip. */
export function hoverHints(): Extension {
  return ViewPlugin.fromClass(HoverHints)
}
