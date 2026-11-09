import { EditorSelection, StateEffect, StateField } from '@codemirror/state'
import type { EditorState, Extension, TransactionSpec } from '@codemirror/state'
import { EditorView, RectangleMarker, ViewPlugin, layer } from '@codemirror/view'
import type { LayerMarker } from '@codemirror/view'
import { blocksOf } from './livePreview/blocks'

/** True when `pos` is on or inside a block widget that is drawn now. */
export function onDrawnBlock(state: EditorState, pos: number): boolean {
  return blocksOf(state).some((block) => pos >= block.from && pos <= block.to)
}

/**
 * Drag-to-move for selected text, built on pointer events.
 *
 * CodeMirror's own text drag is the browser's HTML5 drag, and Tauri's native file drops swallow
 * that on Windows (P0-T9). So this takes the press itself: pressing on a non-empty selection and
 * moving past a small threshold starts a drag, a thin caret follows the pointer, and releasing
 * moves the text in one transaction. Esc, losing the mouse button, leaving the editor box and
 * dropping inside the selection all cancel or do nothing. A press that never moves is a plain
 * click, so it collapses the selection to a caret as usual.
 *
 * Every editor state has it (`create.ts`, P5-T7). A drawn block widget (a table, a block image,
 * the frontmatter pill) is never a drop target: text dropped on its edge would join the first or
 * last line of its source, so the caret is not shown there and a release there does nothing.
 */

/** How far the pointer must travel before a press becomes a drag. */
const START_PX = 4
/** The band inside the editor's top and bottom edges where holding the pointer scrolls. */
const EDGE_PX = 32
/** The fastest scroll, in pixels per frame, at the very edge. */
const MAX_SCROLL_PX = 20

/** True when a pointer over a character belongs to the selection `from` to `to`. */
export function pointerOnRange(from: number, to: number, pos: number, assoc: -1 | 1): boolean {
  // `assoc` 1 means the pointer is on the left half of the character that starts at `pos`, and
  // -1 means the right half of the one that ends there.
  return assoc === 1 ? pos >= from && pos < to : pos > from && pos <= to
}

/**
 * The transaction that moves the main selection's text to `dropPos`, or null when nothing moves:
 * a read-only editor, no single non-empty selection, or a drop inside or at the edge of the
 * selection. One transaction means one undo step. The moved text ends up selected.
 */
export function moveSelectedText(state: EditorState, dropPos: number): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null
  const { from, to } = state.selection.main
  if (from === to) return null
  if (dropPos >= from && dropPos <= to) return null
  if (dropPos < 0 || dropPos > state.doc.length) return null
  const text = state.sliceDoc(from, to)
  const start = dropPos > to ? dropPos - text.length : dropPos
  return {
    changes: [
      { from, to },
      { from: dropPos, insert: text },
    ],
    selection: EditorSelection.single(start, start + text.length),
    userEvent: 'move.drop',
    scrollIntoView: true,
  }
}

/** Where the drop caret shows, or null when no drag is under way. */
export const setDropCaret = StateEffect.define<number | null>()

const dropCaret = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setDropCaret)) return effect.value
    return transaction.docChanged ? null : value
  },
})

/**
 * The caret is drawn in a layer, not as a widget in the text, so that moving it never changes the
 * DOM the next hit test reads.
 */
const caretLayer = layer({
  above: true,
  class: 'cm-drop-caret-layer',
  update: (update) =>
    update.docChanged ||
    update.geometryChanged ||
    update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setDropCaret))),
  markers(view): readonly LayerMarker[] {
    const pos = view.state.field(dropCaret)
    if (pos === null) return []
    const at = view.coordsAtPos(pos, 1)
    if (!at) return []
    // Layer coordinates are relative to the scrolled content, the same base CodeMirror uses.
    const base = view.scrollDOM.getBoundingClientRect()
    return [
      new RectangleMarker(
        'cm-drop-caret',
        at.left - (base.left - view.scrollDOM.scrollLeft),
        at.top - (base.top - view.scrollDOM.scrollTop),
        2,
        at.bottom - at.top,
      ),
    ]
  },
})

const theme = EditorView.baseTheme({
  '.cm-drop-caret': { backgroundColor: 'var(--primary)', pointerEvents: 'none' },
  '&.cm-text-dragging .cm-content': { cursor: 'grabbing', userSelect: 'none' },
})

class TextDrag {
  private readonly view: EditorView
  private pressed = false
  private dragging = false
  private startX = 0
  private startY = 0
  private x = 0
  private y = 0
  private target: number | null = null
  private frame = 0

  constructor(view: EditorView) {
    this.view = view
  }

  /** Takes the press when it lands on selected text; everything else is CodeMirror's. */
  press(event: MouseEvent): boolean {
    const { view } = this
    const { state } = view
    if (event.button !== 0 || event.detail !== 1) return false
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
    if (state.readOnly || view.composing || state.selection.ranges.length !== 1) return false
    const { from, to } = state.selection.main
    if (from === to) return false
    const hit = view.posAndSideAtCoords({ x: event.clientX, y: event.clientY })
    if (!hit || !pointerOnRange(from, to, hit.pos, hit.assoc)) return false

    // CodeMirror skips this on purpose when pressing inside a selection, so the browser's own
    // drag can start. Preventing it here is what keeps that drag, and its native-drop trouble,
    // out of the picture. It also blocks focus, so ask for it.
    event.preventDefault()
    view.focus()
    this.pressed = true
    this.dragging = false
    this.startX = this.x = event.clientX
    this.startY = this.y = event.clientY
    window.addEventListener('pointermove', this.onMove, true)
    window.addEventListener('pointerup', this.onUp, true)
    window.addEventListener('pointercancel', this.onCancel, true)
    window.addEventListener('keydown', this.onKey, true)
    window.addEventListener('blur', this.onCancel)
    return true
  }

  private readonly onMove = (event: PointerEvent): void => {
    // The button came up where this page could not see it, such as outside the window.
    if ((event.buttons & 1) === 0) {
      this.finish(false)
      return
    }
    this.x = event.clientX
    this.y = event.clientY
    if (!this.dragging) {
      if (Math.hypot(this.x - this.startX, this.y - this.startY) < START_PX) return
      this.dragging = true
      this.view.dom.classList.add('cm-text-dragging')
      this.frame = requestAnimationFrame(this.tick)
    }
    event.preventDefault()
    this.aim()
  }

  private readonly onUp = (event: PointerEvent): void => {
    this.x = event.clientX
    this.y = event.clientY
    if (this.dragging) this.aim()
    this.finish(true)
  }

  private readonly onCancel = (): void => {
    this.finish(false)
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    this.finish(false)
  }

  /** Scrolls while the pointer rests in the top or bottom band, then re-aims under the pointer. */
  private readonly tick = (): void => {
    if (!this.dragging) return
    const { scrollDOM } = this.view
    const box = scrollDOM.getBoundingClientRect()
    const top = box.top + EDGE_PX
    const bottom = box.bottom - EDGE_PX
    const reach = this.y < top ? this.y - top : this.y > bottom ? this.y - bottom : 0
    if (reach !== 0 && this.x >= box.left && this.x <= box.right) {
      const step = Math.max(1, Math.min(MAX_SCROLL_PX, (Math.abs(reach) / EDGE_PX) * MAX_SCROLL_PX))
      scrollDOM.scrollTop += Math.sign(reach) * step
      this.aim()
    }
    this.frame = requestAnimationFrame(this.tick)
  }

  /** Works out where a drop here would land, and moves the drop caret there. */
  private aim(): void {
    const { view } = this
    const box = view.scrollDOM.getBoundingClientRect()
    const inside =
      this.x >= box.left && this.x <= box.right && this.y >= box.top && this.y <= box.bottom
    let target: number | null = null
    if (inside) {
      const pos = view.posAtCoords({ x: this.x, y: this.y }, false)
      const { from, to } = view.state.selection.main
      target = (pos >= from && pos <= to) || onDrawnBlock(view.state, pos) ? null : pos
    }
    this.target = target
    if (view.state.field(dropCaret) !== target) view.dispatch({ effects: setDropCaret.of(target) })
  }

  private finish(drop: boolean): void {
    if (!this.pressed) return
    const { view } = this
    const wasDragging = this.dragging
    const target = this.target
    this.stop()

    let spec: TransactionSpec | null = null
    if (drop && wasDragging) {
      if (target !== null) spec = moveSelectedText(view.state, target)
    } else if (drop) {
      // A press on the selection that never moved is a click: put the caret there.
      const pos = view.posAtCoords({ x: this.x, y: this.y }, false)
      spec = { selection: EditorSelection.cursor(pos), userEvent: 'select.pointer' }
    }
    const clear = setDropCaret.of(null)
    if (spec) {
      const effects = spec.effects ? [spec.effects, clear].flat() : [clear]
      view.dispatch({ ...spec, effects })
    } else if (view.state.field(dropCaret) !== null) {
      view.dispatch({ effects: clear })
    }
  }

  private stop(): void {
    window.removeEventListener('pointermove', this.onMove, true)
    window.removeEventListener('pointerup', this.onUp, true)
    window.removeEventListener('pointercancel', this.onCancel, true)
    window.removeEventListener('keydown', this.onKey, true)
    window.removeEventListener('blur', this.onCancel)
    cancelAnimationFrame(this.frame)
    this.view.dom.classList.remove('cm-text-dragging')
    this.pressed = false
    this.dragging = false
    this.target = null
  }

  destroy(): void {
    this.stop()
  }
}

/** Drag-to-move for selected text. Add it to an editor's extensions to turn the feature on. */
export function textDrag(): Extension {
  return [
    dropCaret,
    caretLayer,
    theme,
    ViewPlugin.fromClass(TextDrag, {
      eventHandlers: {
        mousedown(event) {
          return this.press(event)
        },
      },
    }),
  ]
}
