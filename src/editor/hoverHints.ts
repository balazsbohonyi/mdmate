import { type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/**
 * Hints for things drawn inside the editor: a broken link, the frontmatter pill, an image that did
 * not load (ISC-226). The editor is a CodeMirror DOM outside Vue, so the shadcn Tooltip cannot wrap
 * them; instead any element carrying `data-hint="..."` gets a hint drawn here with the same tokens
 * as the shadcn tooltip (popover colors, ring, shadow, arrow; the look is `.editor-hint` in
 * `styles/tokens.css`), so it follows dark and light. The
 * native `title` attribute is never used.
 */

/** How long a hover waits before the hint shows, as for every other hint in the app. */
export const EDITOR_HINT_DELAY = 300
/** The gap between the hovered thing and the hint, room for the arrow. */
const GAP = 8

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
  readonly #view: EditorView
  readonly #over = (event: Event): void => {
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
    this.#view.dom.removeEventListener('pointerout', this.#out)
    this.#view.dom.removeEventListener('pointerdown', this.#away)
    this.#view.dom.removeEventListener('keydown', this.#away)
    this.#view.scrollDOM.removeEventListener('scroll', this.#away)
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
    const target = el.getBoundingClientRect()
    const box = tip.getBoundingClientRect()
    const above = target.top - box.height - GAP >= 0
    const side = above ? 'above' : 'below'
    tip.append(arrowFor(side))
    const centre = target.left + target.width / 2
    const left = Math.min(Math.max(centre - box.width / 2, 4), window.innerWidth - box.width - 4)
    tip.style.left = `${String(left)}px`
    tip.style.top = `${String(above ? target.top - box.height - GAP : target.bottom + GAP)}px`
    // The arrow points at the middle of the hovered thing, even when the box was kept on screen.
    const arrow = tip.lastElementChild
    if (arrow instanceof HTMLElement) arrow.style.left = `${String(centre - left)}px`
    this.#tip = tip
  }
}

/** Hints for `data-hint` elements inside the editor, drawn like the shadcn tooltip. */
export function hoverHints(): Extension {
  return ViewPlugin.fromClass(HoverHints)
}
