/**
 * The resize handle of a selected, loaded image (P9-T4): a small square at the bottom-right corner.
 * Dragging it changes the width only (the frame keeps the picture's ratio), between
 * `MIN_IMAGE_WIDTH` and the width of the editor's text. The frame follows the pointer through its
 * style alone, so a drag is no history and no text until the pointer is released; then the text
 * is written once (`commitResize`), which is one step of undo.
 */
import type { EditorView } from '@codemirror/view'
import { clampWidth, MIN_IMAGE_WIDTH, type ResizeTarget } from './imageEdit'
import { commitResize } from './imageSelect'

type Target = Omit<ResizeTarget, 'joinsNext' | 'lineBreak'> & { readonly block: boolean }

/** The drags in progress, so a widget that is redrawn or removed can end its own. */
const drags = new WeakMap<HTMLElement, () => void>()

/** Ends the drag of the widget `wrap`, if there is one, with the frame as it was. */
export function cancelDrag(wrap: HTMLElement): void {
  drags.get(wrap)?.()
}

/** The width of the text column of the editor, which is as wide as a picture may be made. */
export function contentWidth(view: EditorView): number {
  const style = getComputedStyle(view.contentDOM)
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
  return view.contentDOM.getBoundingClientRect().width - padding
}

/** Builds the handle for `frame`, the picture box of the widget `wrap`. */
export function createHandle(
  view: EditorView,
  wrap: HTMLElement,
  frame: HTMLElement,
  target: Target,
): HTMLElement {
  const handle = document.createElement('span')
  handle.className = 'cm-md-image-handle'
  handle.setAttribute('role', 'slider')
  handle.setAttribute('aria-label', 'Resize image')

  handle.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0 || drags.has(wrap)) return
    event.preventDefault()
    event.stopPropagation()
    // The rendered width, which a max-width of 100% may have made less than the picture's own.
    const startWidth = frame.getBoundingClientRect().width
    const startX = event.clientX
    const limit = Math.max(MIN_IMAGE_WIDTH, contentWidth(view))
    const was = { width: frame.style.width, maxWidth: frame.style.maxWidth }
    let width = startWidth
    // A real pointer is captured, so the drag goes on outside the handle; a synthetic event has no id.
    if (typeof event.pointerId === 'number' && 'setPointerCapture' in handle) {
      handle.setPointerCapture(event.pointerId)
    }

    const show = (value: number): void => {
      // A block frame is as wide as its column up to max-width; an inline one has its width.
      if (target.block) frame.style.maxWidth = `${String(value)}px`
      else frame.style.width = `${String(value)}px`
      // The frame's height follows its width, and CodeMirror must measure it again.
      view.requestMeasure()
    }
    const end = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', cancel)
      drags.delete(wrap)
    }
    const restore = (): void => {
      frame.style.width = was.width
      frame.style.maxWidth = was.maxWidth
      view.requestMeasure()
    }
    const move = (e: PointerEvent): void => {
      width = clampWidth(startWidth + e.clientX - startX, MIN_IMAGE_WIDTH, limit)
      show(width)
    }
    const up = (): void => {
      end()
      const written = Math.round(width)
      if (written === Math.round(startWidth) || !commitResize(view, wrap, target, written))
        restore()
    }
    const cancel = (): void => {
      end()
      restore()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', cancel)
    drags.set(wrap, cancel)
  })
  // A click on the handle is not a click on the picture.
  handle.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  return handle
}
