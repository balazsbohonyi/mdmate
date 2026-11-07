import { describe, expect, it } from 'vitest'
import {
  EDGE_FRACTION,
  INSERT_BAR_PX,
  contains,
  resolveDrop,
  type DraggedTab,
  type PaneGeometry,
  type Rect,
} from '@/workbench/tabDropTarget'

const STRIP = 34
const TAB = 100

/** A pane at (left, top) of the given size, with a strip of `STRIP` px and tabs 100 px wide. */
function pane(
  paneId: string,
  left: number,
  top: number,
  width: number,
  height: number,
  tabIds: readonly string[],
): PaneGeometry {
  return {
    paneId,
    strip: { left, top, right: left + width, bottom: top + STRIP },
    body: { left, top: top + STRIP, right: left + width, bottom: top + height },
    tabs: tabIds.map((id, index) => ({
      id,
      rect: { left: left + index * TAB, top, right: left + (index + 1) * TAB, bottom: top + STRIP },
    })),
  }
}

// Two panes side by side, each 400 wide and 300 tall: p1 holds a, b, c and p2 holds d.
const p1 = pane('p1', 0, 0, 400, 300, ['a', 'b', 'c'])
const p2 = pane('p2', 400, 0, 400, 300, ['d'])
const panes = [p1, p2]

const fromA: DraggedTab = { id: 'a', paneId: 'p1', paneTabCount: 3 }
const fromD: DraggedTab = { id: 'd', paneId: 'p2', paneTabCount: 1 }

function area(rect: Rect): number {
  return (rect.right - rect.left) * (rect.bottom - rect.top)
}

describe('dropping in a tab strip', () => {
  it('counts the tabs whose middle is left of the pointer', () => {
    // Dragging d over p1: the tabs are a (0-100), b (100-200), c (200-300), with middles 50, 150, 250.
    const at = (x: number) => resolveDrop({ x, y: 10 }, panes, fromD)
    expect(at(10)).toMatchObject({ kind: 'strip', paneId: 'p1', index: 0 })
    expect(at(49)).toMatchObject({ index: 0 })
    expect(at(51)).toMatchObject({ index: 1 })
    expect(at(151)).toMatchObject({ index: 2 })
    expect(at(251)).toMatchObject({ index: 3 })
  })

  it('treats the empty strip past the last tab as the end', () => {
    expect(resolveDrop({ x: 380, y: 10 }, panes, fromD)).toMatchObject({ kind: 'strip', index: 3 })
  })

  it('leaves the dragged tab out, so the index is the position after the move', () => {
    // Dragging a within p1: the others are b (100-200) and c (200-300).
    const at = (x: number) => resolveDrop({ x, y: 10 }, panes, fromA)
    expect(at(10)).toMatchObject({ kind: 'strip', paneId: 'p1', index: 0 })
    expect(at(120)).toMatchObject({ index: 0 })
    expect(at(160)).toMatchObject({ index: 1 })
    expect(at(260)).toMatchObject({ index: 2 })
    expect(at(390)).toMatchObject({ index: 2 })
  })

  it('puts the insertion bar on the border it would create', () => {
    const target = resolveDrop({ x: 160, y: 10 }, panes, fromD)
    expect(target?.kind).toBe('strip')
    // Index 2 sits between b and c, at x = 200.
    expect(target?.preview).toEqual({
      left: 200 - INSERT_BAR_PX / 2,
      right: 200 + INSERT_BAR_PX / 2,
      top: 0,
      bottom: STRIP,
    })
  })

  it('shows the bar at the start of an empty strip', () => {
    const empty = pane('p3', 0, 0, 400, 300, [])
    const target = resolveDrop({ x: 50, y: 10 }, [empty], fromD)
    expect(target).toMatchObject({ kind: 'strip', paneId: 'p3', index: 0 })
    expect(target?.preview.left).toBe(-INSERT_BAR_PX / 2)
  })
})

describe('dropping on a pane body', () => {
  // p2's body spans x 400-800 and y 34-300, so its edge bands are 100 px wide and 66.5 px tall.
  const at = (x: number, y: number, dragged: DraggedTab = fromA) =>
    resolveDrop({ x, y }, panes, dragged)

  it('splits the pane when the pointer is near an edge', () => {
    expect(at(410, 170)).toMatchObject({ kind: 'edge', paneId: 'p2', edge: 'left' })
    expect(at(790, 170)).toMatchObject({ kind: 'edge', paneId: 'p2', edge: 'right' })
    expect(at(600, 40)).toMatchObject({ kind: 'edge', paneId: 'p2', edge: 'top' })
    expect(at(600, 295)).toMatchObject({ kind: 'edge', paneId: 'p2', edge: 'bottom' })
  })

  it('moves the tab into the pane when the pointer is in the middle', () => {
    expect(at(600, 170)).toMatchObject({ kind: 'pane', paneId: 'p2' })
    expect(at(600, 170)?.preview).toEqual(p2.body)
  })

  it('picks the nearest edge in a corner', () => {
    // 10 px from the left (2.5%) and 40 px from the top (15%): left is nearer.
    expect(at(410, 74)).toMatchObject({ kind: 'edge', edge: 'left' })
    // 90 px from the left (22.5%) and 4 px from the top (1.5%): top is nearer.
    expect(at(490, 38)).toMatchObject({ kind: 'edge', edge: 'top' })
  })

  it('draws an edge drop as the half of the pane the new pane would take', () => {
    const left = at(410, 170)
    expect(left?.preview).toEqual({ ...p2.body, right: 600 })
    const bottom = at(600, 295)
    expect(bottom?.preview).toEqual({ ...p2.body, top: 167 })
    expect(area(left?.preview ?? p2.body)).toBeCloseTo(area(p2.body) / 2)
  })

  it('starts an edge band exactly at the fraction', () => {
    const width = 400
    const justInside = 400 + width * EDGE_FRACTION - 1
    const justOutside = 400 + width * EDGE_FRACTION
    expect(at(justInside, 170)).toMatchObject({ kind: 'edge', edge: 'left' })
    expect(at(justOutside, 170)).toMatchObject({ kind: 'pane' })
  })
})

describe('drops that would change nothing', () => {
  it('is no target in the middle of the dragged tab’s own pane', () => {
    expect(resolveDrop({ x: 200, y: 170 }, panes, fromA)).toBeNull()
  })

  it('still splits the own pane from an edge when it has other tabs', () => {
    expect(resolveDrop({ x: 390, y: 170 }, panes, fromA)).toMatchObject({
      kind: 'edge',
      paneId: 'p1',
      edge: 'right',
    })
  })

  it('is no target on the own edge of a pane with only that tab', () => {
    expect(resolveDrop({ x: 410, y: 170 }, panes, fromD)).toBeNull()
    expect(resolveDrop({ x: 600, y: 40 }, panes, fromD)).toBeNull()
  })

  it('is no target outside every pane', () => {
    expect(resolveDrop({ x: -5, y: 10 }, panes, fromA)).toBeNull()
    expect(resolveDrop({ x: 200, y: 400 }, panes, fromA)).toBeNull()
    expect(resolveDrop({ x: 900, y: 100 }, panes, fromA)).toBeNull()
  })

  it('ignores a pane with an empty body', () => {
    const flat = { ...p2, body: { left: 400, top: 34, right: 400, bottom: 34 } }
    expect(resolveDrop({ x: 400, y: 100 }, [flat], fromA)).toBeNull()
  })
})

describe('borders between panes', () => {
  it('gives a point on a shared border to exactly one pane', () => {
    const left = contains(p1.strip, { x: 400, y: 10 })
    const right = contains(p2.strip, { x: 400, y: 10 })
    expect(left).toBe(false)
    expect(right).toBe(true)
    expect(resolveDrop({ x: 400, y: 10 }, panes, fromA)).toMatchObject({ paneId: 'p2' })
  })

  it('takes the last pixel before a border for the pane before it', () => {
    expect(resolveDrop({ x: 399.99, y: 10 }, panes, fromD)).toMatchObject({ paneId: 'p1' })
  })

  it('treats the line between a strip and its body as the body', () => {
    expect(resolveDrop({ x: 600, y: STRIP }, panes, fromA)).toMatchObject({ paneId: 'p2' })
    expect(resolveDrop({ x: 600, y: STRIP }, panes, fromA)?.kind).not.toBe('strip')
  })
})

/** A small seeded generator, so a failing point can be replayed from its seed. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('random pointer positions', () => {
  it('give a preview inside the pane they land in, and never two different panes for one point', () => {
    const random = mulberry32(7)
    const outer = (geometry: PaneGeometry): Rect => ({
      left: geometry.strip.left,
      top: geometry.strip.top,
      right: geometry.strip.right,
      bottom: geometry.body.bottom,
    })
    for (let i = 0; i < 2000; i++) {
      const point = { x: random() * 820 - 10, y: random() * 330 - 10 }
      const dragged = random() < 0.5 ? fromA : fromD
      const target = resolveDrop(point, panes, dragged)
      const hit = panes.filter((geometry) => contains(outer(geometry), point))
      expect(hit.length, `point ${JSON.stringify(point)}`).toBeLessThanOrEqual(1)
      if (!target) continue
      const home = hit[0]
      expect(home?.paneId, `point ${JSON.stringify(point)}`).toBe(target.paneId)
      if (!home) continue
      const box = outer(home)
      const { preview } = target
      // The bar may overhang its own strip by half its width at the very start.
      expect(preview.left).toBeGreaterThanOrEqual(box.left - INSERT_BAR_PX)
      expect(preview.right).toBeLessThanOrEqual(box.right + INSERT_BAR_PX)
      expect(preview.top).toBeGreaterThanOrEqual(box.top)
      expect(preview.bottom).toBeLessThanOrEqual(box.bottom)
      if (target.kind === 'edge') {
        expect(area(preview)).toBeCloseTo(area(home.body) / 2)
      }
    }
  })
})
