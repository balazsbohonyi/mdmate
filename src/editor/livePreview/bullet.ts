/**
 * The en dash that stands for a bullet list marker (`-`, `*`, `+`).
 *
 * It is drawn in place of the marker while no selection touches it. The marker character stays in
 * the document, so a copy gives the Markdown text and the caret is never inside it. The widget has
 * the width of the en dash in the current font: a hidden dash sets the width, and the drawn dash is
 * laid over it. In a proportional font the dash is wider than the hyphen it stands for, so a box one
 * hyphen wide let it overhang the space after it and the gap to the text looked too small (owner,
 * 2026-11-22); the box is as wide as the dash now. In a monospace font the hyphen and the dash are
 * equally wide, so nothing moves there.
 */
import { WidgetType } from '@codemirror/view'

export class BulletWidget extends WidgetType {
  override eq(other: WidgetType): boolean {
    return other instanceof BulletWidget
  }

  override toDOM(): HTMLElement {
    const bullet = document.createElement('span')
    bullet.className = 'cm-md-bullet'
    const width = document.createElement('span')
    width.className = 'cm-md-bullet-width'
    width.textContent = '\u2013'
    const dash = document.createElement('span')
    dash.className = 'cm-md-bullet-dash'
    dash.textContent = '\u2013'
    bullet.append(width, dash)
    return bullet
  }

  // A press on the dash is a press on the text: it puts the caret by the marker, which shows it.
  override ignoreEvent(): boolean {
    return false
  }
}
