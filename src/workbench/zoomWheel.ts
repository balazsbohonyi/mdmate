import { zoomBy } from '@/features/settings/zoom'

/**
 * How much wheel travel makes one zoom step. A mouse notch is about 100, so it is one step; a
 * touchpad pinch sends many small events, which add up.
 */
export const WHEEL_PER_STEP = 50

/**
 * Ctrl+wheel zooms the window, in or out by a step, wherever the pointer is. A wheel turned toward
 * the user (down) zooms out. Without Ctrl the wheel scrolls as usual. Returns a function that
 * stops listening.
 */
export function installZoomWheel(target: EventTarget): () => void {
  let travelled = 0
  const onWheel = (event: Event): void => {
    if (!(event instanceof WheelEvent) || !event.ctrlKey) return
    // Not the browser's own zoom, and not a scroll.
    event.preventDefault()
    travelled += event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : event.deltaY * 40
    if (Math.abs(travelled) < WHEEL_PER_STEP) return
    const direction = travelled < 0 ? 1 : -1
    travelled = 0
    zoomBy(direction).catch((error: unknown) => {
      console.error('Could not zoom', error)
    })
  }
  // Not a passive listener: a passive one cannot cancel the scroll.
  target.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    target.removeEventListener('wheel', onWheel)
  }
}
