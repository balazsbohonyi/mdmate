/**
 * The colour square before an inline code span that is a hex colour, as in an IDE.
 *
 * It is a point widget before the opening backtick, outside the code. It takes no place in the
 * document: the caret and the selection never see it, and a copy is the Markdown text as typed.
 * Only a span whose whole text is a colour gets one: a number sign with too few or too many digits,
 * a colour name and a colour with other text after it get none.
 */
import { WidgetType } from '@codemirror/view'

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, in any case, and nothing else. */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** The text itself when it is a hex colour, else null. */
export function hexColor(text: string): string | null {
  return HEX_COLOR.test(text) ? text : null
}

/**
 * The square for `color`, which the caller has checked with `hexColor`. The colour is on the element
 * twice: as data, for a test and for anything that reads the page, and as the custom property the
 * stylesheet paints with (`.cm-md-swatch` in `theme.ts`), so no colour is ever written as markup.
 */
export function createSwatch(color: string): HTMLElement {
  const swatch = document.createElement('span')
  swatch.className = 'cm-md-swatch'
  swatch.dataset.color = color
  swatch.style.setProperty('--swatch', color)
  swatch.setAttribute('aria-hidden', 'true')
  return swatch
}

/** The square as a CodeMirror widget. */
export class SwatchWidget extends WidgetType {
  readonly color: string

  constructor(color: string) {
    super()
    this.color = color
  }

  override eq(other: WidgetType): boolean {
    return other instanceof SwatchWidget && other.color === this.color
  }

  override toDOM(): HTMLElement {
    return createSwatch(this.color)
  }

  // A press on the square is a press on the text beside it: the editor puts the caret there, as it
  // does for a bullet. (`true` would leave the press to the widget, which does nothing with it.)
  override ignoreEvent(): boolean {
    return false
  }
}
