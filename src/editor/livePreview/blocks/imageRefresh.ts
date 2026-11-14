/**
 * Reads the pictures on screen from disk again when asked (the window got the focus back), so a
 * file deleted or replaced while the user was elsewhere shows as what it is now. See
 * `freshImageSrc` for why a new address is needed.
 *
 * A picture is read under its new address first, off screen, and the one on screen switches to it
 * only once it is in: a picture that is still there does not blink. One that is gone gets the same
 * error the widget gives any picture that cannot be read, which turns it into its label.
 */
import { type Extension } from '@codemirror/state'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import { freshImageSrc, onPicturesRefresh, plainImageSrc } from './image'

function reload(view: EditorView): void {
  for (const img of view.contentDOM.querySelectorAll<HTMLImageElement>('.cm-md-image-frame img')) {
    const next = freshImageSrc(plainImageSrc(img.src))
    // A picture that is not a local file keeps its address, and is not read again.
    if (next === img.src) continue
    const probe = new Image()
    probe.referrerPolicy = 'no-referrer'
    probe.onload = () => {
      if (img.isConnected) img.src = next
    }
    probe.onerror = () => {
      if (img.isConnected) img.dispatchEvent(new Event('error'))
    }
    probe.src = next
  }
}

export function imageRefresh(): Extension {
  return ViewPlugin.fromClass(
    class {
      readonly #stop: () => void
      constructor(view: EditorView) {
        this.#stop = onPicturesRefresh(() => {
          reload(view)
        })
      }
      destroy(): void {
        this.#stop()
      }
    },
  )
}
