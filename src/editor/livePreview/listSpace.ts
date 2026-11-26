/**
 * The width of one space of the body text, put on the editor as `--md-space`. A code container in
 * a list item starts that many spaces in (box.ts), under the item's text, but its lines are in the
 * code font, so no CSS unit of their own gives the body's space. It is measured from a hidden run of
 * spaces, and again whenever that run changes size: another font or size, or a font that has just
 * loaded.
 */
import { ViewPlugin, type EditorView } from '@codemirror/view'

/** Enough spaces that a fraction of a pixel in each one still shows in the sum. */
const COUNT = 32

export const listSpace = ViewPlugin.fromClass(
  class {
    private readonly view: EditorView
    private readonly probe: HTMLElement
    private readonly observer: ResizeObserver | null

    constructor(view: EditorView) {
      this.view = view
      this.probe = document.createElement('span')
      this.probe.setAttribute('aria-hidden', 'true')
      this.probe.textContent = ' '.repeat(COUNT)
      this.probe.className = 'cm-md-space-probe'
      view.scrollDOM.append(this.probe)
      // A test page has no observer and no layout: the theme's fallback stays.
      this.observer =
        typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.measure())
      this.observer?.observe(this.probe)
    }

    private measure(): void {
      const width = this.probe.getBoundingClientRect().width / COUNT
      // A hidden pane has no width to read; the last one stays.
      if (width <= 0) return
      this.view.dom.style.setProperty('--md-space', `${String(width)}px`)
      this.view.requestMeasure()
    }

    destroy(): void {
      this.observer?.disconnect()
      this.probe.remove()
      this.view.dom.style.removeProperty('--md-space')
    }
  },
)
