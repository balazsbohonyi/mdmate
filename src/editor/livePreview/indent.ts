/**
 * The invisible second copy of a list item's indentation (listLayout.ts). It is the same blanks as
 * the source, hidden, so it is as wide as they are in any font and with any tab size.
 */
import { WidgetType } from '@codemirror/view'

export class IndentWidget extends WidgetType {
  readonly text: string

  constructor(text: string) {
    super()
    this.text = text
  }

  override eq(other: WidgetType): boolean {
    return other instanceof IndentWidget && other.text === this.text
  }

  override toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-md-indent'
    element.setAttribute('aria-hidden', 'true')
    element.textContent = this.text
    return element
  }

  // A press on it is a press in the text: the editor places the caret.
  override ignoreEvent(): boolean {
    return false
  }
}
