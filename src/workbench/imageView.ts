/**
 * How an image tab places its picture: fit, zoom about a point, and the limits. Pure numbers, so
 * the rules are testable without a browser.
 */
import type { TabId } from './splitTree'
import { onTabClosed } from './store'

export interface View {
  /** Display scale: 1 shows the picture at its own pixel size. */
  readonly scale: number
  /** Where the picture's top-left corner sits in the pane, in CSS pixels. */
  readonly x: number
  readonly y: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export const MIN_SCALE = 0.02
export const MAX_SCALE = 32

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * The view that fits the whole picture in the pane, centred. A picture smaller than the pane is
 * shown at its own size rather than blown up.
 */
export function fitView(picture: Size, pane: Size): View {
  if (picture.width <= 0 || picture.height <= 0 || pane.width <= 0 || pane.height <= 0) {
    return { scale: 1, x: 0, y: 0 }
  }
  const scale = Math.min(1, pane.width / picture.width, pane.height / picture.height)
  return {
    scale,
    x: (pane.width - picture.width * scale) / 2,
    y: (pane.height - picture.height * scale) / 2,
  }
}

/** The view at the picture's own size, centred (it may overflow the pane; pan to see the rest). */
export function actualView(picture: Size, pane: Size): View {
  return {
    scale: 1,
    x: (pane.width - picture.width) / 2,
    y: (pane.height - picture.height) / 2,
  }
}

/**
 * Zooms by `factor` keeping the point (`cx`, `cy`) of the pane over the same spot of the picture,
 * so a wheel turn zooms toward the pointer.
 */
export function zoomAbout(view: View, factor: number, cx: number, cy: number): View {
  const scale = clampScale(view.scale * factor)
  const ratio = scale / view.scale
  return { scale, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio }
}

/** The view moved by a drag of (`dx`, `dy`). */
export function panBy(view: View, dx: number, dy: number): View {
  return { scale: view.scale, x: view.x + dx, y: view.y + dy }
}

/**
 * What an image tab remembers while another tab is shown: how far in it was zoomed and which spot
 * of the picture was in the middle of the pane. The spot, not the corner's position, is kept so
 * the picture comes back centred on the same place if the pane has a different size by then.
 */
export interface RememberedView {
  readonly scale: number
  /** The point of the picture (in its own pixels) that was at the centre of the pane. */
  readonly cx: number
  readonly cy: number
  /** True when the tab was never zoomed or moved: it fits the pane again, whatever the pane is now. */
  readonly fitted: boolean
}

export function remember(view: View, pane: Size, fitted: boolean): RememberedView {
  return {
    scale: view.scale,
    cx: (pane.width / 2 - view.x) / view.scale,
    cy: (pane.height / 2 - view.y) / view.scale,
    fitted,
  }
}

/** The view that puts the remembered spot at the centre of the pane at the remembered zoom. */
export function recall(saved: RememberedView, pane: Size): View {
  return {
    scale: saved.scale,
    x: pane.width / 2 - saved.cx * saved.scale,
    y: pane.height / 2 - saved.cy * saved.scale,
  }
}

/** One entry per open image tab, kept in memory only: a restart fits every picture again. */
const remembered = new Map<TabId, RememberedView>()

export function rememberedView(tabId: TabId): RememberedView | undefined {
  return remembered.get(tabId)
}

export function rememberView(tabId: TabId, saved: RememberedView): void {
  remembered.set(tabId, saved)
}

/** For tests. */
export function resetRememberedViews(): void {
  remembered.clear()
}

// A closed tab takes its zoom with it.
onTabClosed((tabId) => {
  remembered.delete(tabId)
})
