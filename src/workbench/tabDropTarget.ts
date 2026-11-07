import type { Edge, PaneId, TabId } from './splitTree'

/**
 * Where a dragged tab would land, worked out from rectangles alone. No DOM and no Vue, so the
 * rules are plain functions that tests drive with numbers. Rectangles are in viewport pixels.
 */

export interface Rect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

export interface TabGeometry {
  readonly id: TabId
  readonly rect: Rect
}

/** The three rectangles of one pane that a drop can hit. */
export interface PaneGeometry {
  readonly paneId: PaneId
  readonly strip: Rect
  readonly body: Rect
  readonly tabs: readonly TabGeometry[]
}

/** The tab being dragged and the pane it comes from. */
export interface DraggedTab {
  readonly id: TabId
  readonly paneId: PaneId
  readonly paneTabCount: number
}

/** Every target carries `preview`, the rectangle to light up while the pointer is there. */
export type DropTarget =
  | {
      readonly kind: 'strip'
      readonly paneId: PaneId
      readonly index: number
      readonly preview: Rect
    }
  | { readonly kind: 'pane'; readonly paneId: PaneId; readonly preview: Rect }
  | { readonly kind: 'edge'; readonly paneId: PaneId; readonly edge: Edge; readonly preview: Rect }

/** How much of a pane body, measured in from each side, counts as that side's edge. */
export const EDGE_FRACTION = 0.25
/** The width of the insertion bar shown in a tab strip. */
export const INSERT_BAR_PX = 2

export function contains(rect: Rect, point: Point): boolean {
  // Left and top are inside, right and bottom are not, so two panes that share a border never both hit.
  return (
    point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom
  )
}

function center(rect: Rect): number {
  return (rect.left + rect.right) / 2
}

function stripTarget(pane: PaneGeometry, point: Point, dragged: DraggedTab): DropTarget {
  const others = pane.tabs.filter((tab) => tab.id !== dragged.id)
  // The position in the strip once the dragged tab has left it, which is what `moveTab` takes.
  const index = others.filter((tab) => center(tab.rect) < point.x).length
  const before = others[index - 1]
  const after = others[index]
  const x = before ? before.rect.right : (after?.rect.left ?? pane.strip.left)
  return {
    kind: 'strip',
    paneId: pane.paneId,
    index,
    preview: {
      left: x - INSERT_BAR_PX / 2,
      right: x + INSERT_BAR_PX / 2,
      top: pane.strip.top,
      bottom: pane.strip.bottom,
    },
  }
}

/** The half of a body that a new pane on `edge` would take. */
function edgePreview(body: Rect, edge: Edge): Rect {
  const midX = (body.left + body.right) / 2
  const midY = (body.top + body.bottom) / 2
  switch (edge) {
    case 'left':
      return { ...body, right: midX }
    case 'right':
      return { ...body, left: midX }
    case 'top':
      return { ...body, bottom: midY }
    case 'bottom':
      return { ...body, top: midY }
  }
}

function bodyTarget(pane: PaneGeometry, point: Point, dragged: DraggedTab): DropTarget | null {
  const { body } = pane
  const width = body.right - body.left
  const height = body.bottom - body.top
  if (width <= 0 || height <= 0) return null
  const distances: readonly (readonly [Edge, number])[] = [
    ['left', (point.x - body.left) / width],
    ['right', (body.right - point.x) / width],
    ['top', (point.y - body.top) / height],
    ['bottom', (body.bottom - point.y) / height],
  ]
  const nearest = distances.reduce((best, current) => (current[1] < best[1] ? current : best))
  const own = pane.paneId === dragged.paneId
  if (nearest[1] < EDGE_FRACTION) {
    // The only tab of a pane dropped on that pane's own edge would leave an empty pane behind.
    if (own && dragged.paneTabCount === 1) return null
    const [edge] = nearest
    return { kind: 'edge', paneId: pane.paneId, edge, preview: edgePreview(body, edge) }
  }
  // Dropping a tab back into the middle of its own pane changes nothing, so it is not a target.
  if (own) return null
  return { kind: 'pane', paneId: pane.paneId, preview: body }
}

/** What a drop at `point` would do, or null when it would do nothing. */
export function resolveDrop(
  point: Point,
  panes: readonly PaneGeometry[],
  dragged: DraggedTab,
): DropTarget | null {
  for (const pane of panes) {
    if (contains(pane.strip, point)) return stripTarget(pane, point, dragged)
    if (contains(pane.body, point)) return bodyTarget(pane, point, dragged)
  }
  return null
}
