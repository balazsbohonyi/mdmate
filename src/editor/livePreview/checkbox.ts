/**
 * The checkbox that stands for a task marker (`[ ]`, `[x]`) in a list item.
 *
 * Pressing it changes one character of the document, the space or the `x` between the brackets,
 * and nothing else: not the brackets, not the line ending, not the caret. The change goes through
 * the view like typing, so it is one step of undo of its own: `input.toggle` is not an event the
 * history joins to its neighbours, so two quick presses on one box undo one at a time. A read-only document ignores the
 * press, and a marker that no longer looks like one (the text changed under a widget that has not
 * been redrawn yet) is left alone.
 */
import { WidgetType, type EditorView } from '@codemirror/view'

const MARKER = /^\[[ xX]\]$/

/** Flips the task marker whose widget is `dom`. Returns true when it changed the document. */
export function toggleCheckbox(view: EditorView, dom: HTMLElement): boolean {
  if (view.state.readOnly) return false
  const from = view.posAtDOM(dom)
  const marker = view.state.doc.sliceString(from, from + 3)
  if (!MARKER.test(marker)) return false
  view.dispatch({
    changes: { from: from + 1, to: from + 2, insert: marker === '[ ]' ? 'x' : ' ' },
    userEvent: 'input.toggle',
  })
  return true
}

/** A native checkbox, drawn checked or not. The caret and the focus stay where they were. */
export class CheckboxWidget extends WidgetType {
  readonly checked: boolean

  constructor(checked: boolean) {
    super()
    this.checked = checked
  }

  override eq(other: WidgetType): boolean {
    return other instanceof CheckboxWidget && other.checked === this.checked
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-md-checkbox'
    // The attribute as well as the property, so a copy of the page's HTML shows the box as it is.
    box.defaultChecked = this.checked
    box.checked = this.checked
    box.tabIndex = -1
    // A press must not move the caret or take the focus out of the text.
    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
    })
    // The page redraws the box from the text, so the browser's own flip is not wanted.
    box.addEventListener('click', (event) => {
      event.preventDefault()
      toggleCheckbox(view, box)
    })
    return box
  }

  override ignoreEvent(): boolean {
    return true
  }
}
