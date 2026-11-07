import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  START_PX,
  beginTabDrag,
  tabDrag,
  type DragHost,
  type DragSource,
} from '@/workbench/tabDrag'
import type { DropTarget, PaneGeometry } from '@/workbench/tabDropTarget'

/** p1 on the left (tabs a and b) and p2 on the right (tab c), each 400 by 300 with a 34 px strip. */
const geometry: readonly PaneGeometry[] = [
  {
    paneId: 'p1',
    strip: { left: 0, top: 0, right: 400, bottom: 34 },
    body: { left: 0, top: 34, right: 400, bottom: 300 },
    tabs: [
      { id: 'a', rect: { left: 0, top: 0, right: 100, bottom: 34 } },
      { id: 'b', rect: { left: 100, top: 0, right: 200, bottom: 34 } },
    ],
  },
  {
    paneId: 'p2',
    strip: { left: 400, top: 0, right: 800, bottom: 34 },
    body: { left: 400, top: 34, right: 800, bottom: 300 },
    tabs: [{ id: 'c', rect: { left: 400, top: 0, right: 500, bottom: 34 } }],
  },
]

const source: DragSource = { id: 'a', title: 'a.md', paneId: 'p1', paneTabCount: 2 }

interface Drop {
  readonly tabId: string
  readonly target: DropTarget
}

let events: EventTarget
let drops: Drop[]
let geometryReads: number
let host: DragHost

function fire(type: string, props: Record<string, unknown> = {}): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), props)
  events.dispatchEvent(event)
  return event
}

const move = (x: number, y: number, buttons = 1) =>
  fire('pointermove', { clientX: x, clientY: y, buttons })
const up = (x: number, y: number) => fire('pointerup', { clientX: x, clientY: y, buttons: 0 })

beforeEach(() => {
  events = new EventTarget()
  drops = []
  geometryReads = 0
  host = {
    events,
    geometry: () => {
      geometryReads++
      return geometry
    },
    drop: (tabId, target) => {
      drops.push({ tabId, target })
    },
  }
})

afterEach(() => {
  // A session left open by a test would still listen on its own event target, which is dropped here.
  tabDrag.value = null
})

describe('a press that never moves far', () => {
  it('is a click: nothing is shown and nothing is dropped', () => {
    beginTabDrag({ clientX: 50, clientY: 10 }, source, host)
    move(50 + START_PX - 1, 10)
    expect(tabDrag.value).toBeNull()
    up(50 + START_PX - 1, 10)
    expect(drops).toEqual([])
    expect(geometryReads).toBe(0)
  })
})

describe('a drag', () => {
  it('starts once the pointer has moved the threshold, and reads the geometry once', () => {
    beginTabDrag({ clientX: 50, clientY: 10 }, source, host)
    move(50 + START_PX, 10)
    expect(tabDrag.value).not.toBeNull()
    move(300, 100)
    move(500, 100)
    expect(geometryReads).toBe(1)
  })

  it('follows the pointer and aims at what is under it', () => {
    beginTabDrag({ clientX: 50, clientY: 10 }, source, host)
    move(600, 150)
    expect(tabDrag.value).toMatchObject({
      tabId: 'a',
      title: 'a.md',
      x: 600,
      y: 150,
      target: { kind: 'pane', paneId: 'p2' },
    })
    move(790, 150)
    expect(tabDrag.value?.target).toMatchObject({ kind: 'edge', paneId: 'p2', edge: 'right' })
    move(200, 150)
    expect(tabDrag.value?.target).toBeNull()
  })

  it('applies the drop on release and clears the state', () => {
    beginTabDrag({ clientX: 50, clientY: 10 }, source, host)
    move(600, 150)
    up(600, 150)
    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatchObject({ tabId: 'a', target: { kind: 'pane', paneId: 'p2' } })
    expect(tabDrag.value).toBeNull()
  })

  it('works the target out again from the release position, not the last move', () => {
    beginTabDrag({ clientX: 50, clientY: 10 }, source, host)
    move(600, 150)
    up(390, 150)
    expect(drops).toHaveLength(1)
    expect(drops[0]?.target).toMatchObject({ kind: 'edge', paneId: 'p1', edge: 'right' })
  })

  it('applies nothing when released over no target', () => {
    beginTabDrag({ clientX: 50, clientY: 10 }, source, host)
    move(200, 150)
    up(200, 150)
    expect(drops).toEqual([])
    expect(tabDrag.value).toBeNull()
  })

  it('takes the move event away from the page while dragging', () => {
    beginTabDrag({ clientX: 50, clientY: 10 }, source, host)
    expect(move(51, 10).defaultPrevented).toBe(false)
    expect(move(300, 10).defaultPrevented).toBe(true)
  })

  it('stops listening after it ends', () => {
    beginTabDrag({ clientX: 50, clientY: 10 }, source, host)
    move(600, 150)
    up(600, 150)
    move(500, 150)
    up(500, 150)
    expect(drops).toHaveLength(1)
    expect(tabDrag.value).toBeNull()
  })
})

describe('cancelling', () => {
  function startDragging(): void {
    beginTabDrag({ clientX: 50, clientY: 10 }, source, host)
    move(600, 150)
    expect(tabDrag.value).not.toBeNull()
  }

  it('on Escape, and keeps Escape from reaching anything else', () => {
    startDragging()
    const key = fire('keydown', { key: 'Escape' })
    expect(key.defaultPrevented).toBe(true)
    expect(tabDrag.value).toBeNull()
    up(600, 150)
    expect(drops).toEqual([])
  })

  it('ignores other keys', () => {
    startDragging()
    const key = fire('keydown', { key: 'a' })
    expect(key.defaultPrevented).toBe(false)
    expect(tabDrag.value).not.toBeNull()
  })

  it('when the window loses focus', () => {
    startDragging()
    fire('blur')
    expect(tabDrag.value).toBeNull()
    up(600, 150)
    expect(drops).toEqual([])
  })

  it('when the pointer is cancelled', () => {
    startDragging()
    fire('pointercancel')
    expect(tabDrag.value).toBeNull()
    up(600, 150)
    expect(drops).toEqual([])
  })

  it('when a move arrives with no button held, because the release was missed', () => {
    startDragging()
    move(610, 150, 0)
    expect(tabDrag.value).toBeNull()
    up(610, 150)
    expect(drops).toEqual([])
  })

  it('when another drag begins', () => {
    startDragging()
    beginTabDrag(
      { clientX: 450, clientY: 10 },
      { id: 'c', title: 'c.md', paneId: 'p2', paneTabCount: 1 },
      host,
    )
    expect(tabDrag.value).toBeNull()
    move(100, 150)
    expect(tabDrag.value).toMatchObject({ tabId: 'c' })
  })
})
