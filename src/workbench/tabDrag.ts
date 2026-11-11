import { shallowRef } from 'vue'
import type { TabId } from './splitTree'
import { dropTabOnEdge, moveTabTo } from './store'
import {
  resolveDrop,
  type DraggedTab,
  type DropTarget,
  type PaneGeometry,
  type Rect,
} from './tabDropTarget'

/**
 * Tab dragging, built on pointer events.
 *
 * The browser's own drag cannot be used: Tauri's native file drops swallow it on Windows (P0-T9),
 * so `dragDropEnabled` stays on and tabs, like selected text, are moved by taking the press
 * ourselves. A press that moves past a small threshold becomes a drag, a drop preview follows the
 * pointer, and releasing applies the move. Esc, losing focus, a cancelled pointer and a mouse
 * button released where this page could not see it all cancel, and a press that never moves is a
 * plain click, which the tab handles itself.
 */

/** How far the pointer must travel before a press becomes a drag. */
export const START_PX = 4

/** The options form, because Node's EventTarget (the tests' stand-in for the window) ignores a bare `true` when removing. */
const CAPTURE = { capture: true } as const

/** What the drag layer draws. Null while no drag is under way, and for a press that is still a click. */
export interface TabDragState {
  readonly tabId: TabId
  readonly title: string
  readonly x: number
  readonly y: number
  readonly target: DropTarget | null
}

export const tabDrag = shallowRef<TabDragState | null>(null)

/** The parts of the world a drag touches, so tests can stand in for the browser. */
export interface DragHost {
  /** Where pointer, key and blur events are listened for: the window. */
  readonly events: EventTarget
  geometry(): readonly PaneGeometry[]
  drop(tabId: TabId, target: DropTarget): void
}

export interface DragSource extends DraggedTab {
  readonly title: string
}

interface PointerLike {
  readonly clientX: number
  readonly clientY: number
  readonly buttons: number
}

function isPointer(event: Event): event is Event & PointerLike {
  return 'clientX' in event && 'clientY' in event && 'buttons' in event
}

function isKey(event: Event): event is Event & { readonly key: string } {
  return 'key' in event
}

class TabDragSession {
  private readonly host: DragHost
  private readonly tab: DragSource
  private readonly startX: number
  private readonly startY: number
  private readonly onEnd: (session: TabDragSession) => void
  private dragging = false
  private panes: readonly PaneGeometry[] = []
  private target: DropTarget | null = null
  private x: number
  private y: number

  constructor(
    host: DragHost,
    tab: DragSource,
    startX: number,
    startY: number,
    onEnd: (session: TabDragSession) => void,
  ) {
    this.host = host
    this.tab = tab
    this.startX = this.x = startX
    this.startY = this.y = startY
    this.onEnd = onEnd
    const { events } = host
    events.addEventListener('pointermove', this.onMove, CAPTURE)
    events.addEventListener('pointerup', this.onUp, CAPTURE)
    events.addEventListener('pointercancel', this.onCancel, CAPTURE)
    events.addEventListener('keydown', this.onKey, CAPTURE)
    events.addEventListener('blur', this.onCancel)
  }

  private readonly onMove = (event: Event): void => {
    if (!isPointer(event)) return
    // The button came up where this page could not see it, such as outside the window.
    if ((event.buttons & 1) === 0) {
      this.finish(false)
      return
    }
    this.x = event.clientX
    this.y = event.clientY
    if (!this.dragging) {
      if (Math.hypot(this.x - this.startX, this.y - this.startY) < START_PX) return
      this.dragging = true
      this.panes = this.host.geometry()
    }
    event.preventDefault()
    this.aim()
  }

  private readonly onUp = (event: Event): void => {
    // Work the target out again from where the pointer is now, not from the last move.
    if (isPointer(event)) {
      this.x = event.clientX
      this.y = event.clientY
    }
    if (this.dragging) this.aim()
    this.finish(true)
  }

  private readonly onCancel = (): void => {
    this.finish(false)
  }

  private readonly onKey = (event: Event): void => {
    if (!isKey(event) || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    this.finish(false)
  }

  private aim(): void {
    this.target = resolveDrop({ x: this.x, y: this.y }, this.panes, this.tab)
    tabDrag.value = {
      tabId: this.tab.id,
      title: this.tab.title,
      x: this.x,
      y: this.y,
      target: this.target,
    }
  }

  private finish(drop: boolean): void {
    const { target, dragging } = this
    this.stop()
    if (drop && dragging && target) this.host.drop(this.tab.id, target)
  }

  /** Ends the session without applying anything. */
  cancel(): void {
    this.finish(false)
  }

  private stop(): void {
    const { events } = this.host
    events.removeEventListener('pointermove', this.onMove, CAPTURE)
    events.removeEventListener('pointerup', this.onUp, CAPTURE)
    events.removeEventListener('pointercancel', this.onCancel, CAPTURE)
    events.removeEventListener('keydown', this.onKey, CAPTURE)
    events.removeEventListener('blur', this.onCancel)
    tabDrag.value = null
    this.dragging = false
    this.target = null
    this.onEnd(this)
  }
}

let current: TabDragSession | null = null

/**
 * Starts tracking a press on a tab. Call it from the tab's pointer-down handler with the press
 * position. The host defaults to the real window and the rendered panes.
 */
export function beginTabDrag(
  press: { readonly clientX: number; readonly clientY: number },
  tab: DragSource,
  host: DragHost = domHost(),
): void {
  current?.cancel()
  current = new TabDragSession(host, tab, press.clientX, press.clientY, (session) => {
    if (current === session) current = null
  })
}

function rectOf(element: Element): Rect {
  const { left, top, right, bottom } = element.getBoundingClientRect()
  return { left, top, right, bottom }
}

/** Reads every pane's strip, body and tabs from the page. */
function readGeometry(): readonly PaneGeometry[] {
  const panes: PaneGeometry[] = []
  for (const section of document.querySelectorAll<HTMLElement>('section[data-pane-id]')) {
    const strip = section.querySelector('[data-tab-strip]')
    const body = section.querySelector('[data-pane-body]')
    const paneId = section.dataset.paneId
    if (!strip || !body || !paneId) continue
    const tabs = [...strip.querySelectorAll<HTMLElement>('[data-tab-id]')].flatMap((element) =>
      element.dataset.tabId ? [{ id: element.dataset.tabId, rect: rectOf(element) }] : [],
    )
    panes.push({ paneId, strip: rectOf(strip), body: rectOf(body), tabs })
  }
  return panes
}

/** Applies a drop to the live workbench. */
export function applyDrop(tabId: TabId, target: DropTarget): void {
  switch (target.kind) {
    case 'strip':
      moveTabTo(tabId, target.paneId, target.index)
      return
    case 'pane':
      moveTabTo(tabId, target.paneId)
      return
    case 'edge':
      dropTabOnEdge(tabId, target.paneId, target.edge)
      return
  }
}

function domHost(): DragHost {
  return { events: window, geometry: readGeometry, drop: applyDrop }
}
