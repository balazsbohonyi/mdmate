/**
 * The en dash that stands for a bullet list marker (`-`, `*`, `+`).
 *
 * It is drawn in place of the marker while no selection touches it. The marker character stays in
 * the document, so a copy gives the Markdown text and the caret is never inside it. The widget has
 * the width of a hyphen in the current font, so the text of the item stays where the hyphen left it
 * and the lines of a wrapped item still line up: a hidden hyphen sets the width, and the dash is
 * laid over it. In a monospace font the two glyphs are equally wide and nothing overhangs.
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
    width.textContent = '-'
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
