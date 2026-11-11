// @vitest-environment jsdom
/**
 * The sidebar's width (ISC-231): dragged from its right edge, held between 12rem and half the
 * window, kept while it is hidden and shown, reset by a double click.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import SidebarFrame from '@/shell/SidebarFrame.vue'
import { createMockHost } from '@/platform/mock'
import { setHost } from '@/platform'
import {
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
  resetSidebar,
  setSidebarWidth,
  sidebarMax,
  sidebarWidth,
  toggleSidebar,
} from '@/workbench/sidebar'

const WINDOW = 1200

describe('the width rules', () => {
  beforeEach(resetSidebar)

  it('starts at the default, which the stylesheet gives', () => {
    expect(sidebarWidth.value).toBeNull()
  })

  it('holds a width between 12rem and half the window', () => {
    setSidebarWidth(100, WINDOW)
    expect(sidebarWidth.value).toBe(SIDEBAR_MIN)
    setSidebarWidth(5000, WINDOW)
    expect(sidebarWidth.value).toBe(WINDOW / 2)
    setSidebarWidth(333.4, WINDOW)
    expect(sidebarWidth.value).toBe(333)
  })

  it('never goes below the narrowest, even in a window too small for half of it', () => {
    expect(sidebarMax(200)).toBe(SIDEBAR_MIN)
    setSidebarWidth(400, 200)
    expect(sidebarWidth.value).toBe(SIDEBAR_MIN)
  })

  it('goes back to the default for null and for a width that is not a number', () => {
    setSidebarWidth(300, WINDOW)
    setSidebarWidth(null, WINDOW)
    expect(sidebarWidth.value).toBeNull()
    setSidebarWidth(300, WINDOW)
    setSidebarWidth(Number.NaN, WINDOW)
    expect(sidebarWidth.value).toBeNull()
  })

  it('keeps the width while the sidebar is hidden and shown again', () => {
    setSidebarWidth(310, WINDOW)
    toggleSidebar()
    toggleSidebar()
    expect(sidebarWidth.value).toBe(310)
  })
})

describe('the handle on the edge', () => {
  let app: App | undefined
  let root: HTMLElement | undefined

  beforeEach(async () => {
    resetSidebar()
    setHost(createMockHost({ files: {}, roots: [] }))
    Object.defineProperty(window, 'innerWidth', { value: WINDOW, configurable: true })
    root = document.createElement('div')
    document.body.append(root)
    app = createApp(SidebarFrame)
    app.mount(root)
    await nextTick()
    // jsdom has no layout, so the frame reports the width the page gave it.
    const aside = root.querySelector('aside')
    if (aside === null) throw new Error('no sidebar')
    aside.getBoundingClientRect = () =>
      ({ width: sidebarWidth.value ?? SIDEBAR_DEFAULT }) as unknown as DOMRect
  })

  afterEach(() => {
    app?.unmount()
    root?.remove()
    app = undefined
    setHost(undefined)
    resetSidebar()
  })

  const handle = (): HTMLElement => {
    const found = root?.querySelector<HTMLElement>('[data-sidebar-handle]')
    if (found === null || found === undefined) throw new Error('no handle')
    return found
  }
  const asideEl = (): HTMLElement => {
    const found = root?.querySelector('aside')
    if (found === null || found === undefined) throw new Error('no sidebar')
    return found
  }

  /** A pointer event with the fields the handle reads. */
  function pointer(type: string, x: number, button = 0): PointerEvent {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button })
    Object.assign(event, { pointerId: 1 })
    return event as PointerEvent
  }

  async function dragBy(delta: number): Promise<void> {
    const edge = handle()
    edge.setPointerCapture = () => undefined
    edge.dispatchEvent(pointer('pointerdown', 240))
    edge.dispatchEvent(pointer('pointermove', 240 + delta))
    edge.dispatchEvent(pointer('pointerup', 240 + delta))
    await nextTick()
  }

  it('is a vertical separator a keyboard can reach', () => {
    expect(handle().getAttribute('role')).toBe('separator')
    expect(handle().getAttribute('aria-orientation')).toBe('vertical')
    expect(handle().tabIndex).toBe(0)
  })

  it('dragging the edge sets the width by how far the pointer went', async () => {
    await dragBy(100)
    expect(sidebarWidth.value).toBe(340)
    expect(asideEl().style.width).toBe('340px')
  })

  it('does not go under 12rem or over half the window however far it is dragged', async () => {
    await dragBy(-500)
    expect(sidebarWidth.value).toBe(SIDEBAR_MIN)
    await dragBy(2000)
    expect(sidebarWidth.value).toBe(WINDOW / 2)
  })

  it('a move with no button down changes nothing, and so does a right-button press', async () => {
    const edge = handle()
    edge.setPointerCapture = () => undefined
    edge.dispatchEvent(pointer('pointermove', 400))
    edge.dispatchEvent(pointer('pointerdown', 240, 2))
    edge.dispatchEvent(pointer('pointermove', 400))
    await nextTick()
    expect(sidebarWidth.value).toBeNull()
  })

  it('the arrow keys move it 16 px at a time', async () => {
    handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    expect(sidebarWidth.value).toBe(256)
    handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await nextTick()
    expect(sidebarWidth.value).toBe(224)
  })

  it('a double click puts it back to the default', async () => {
    await dragBy(150)
    expect(sidebarWidth.value).toBe(390)
    handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await nextTick()
    expect(sidebarWidth.value).toBeNull()
    expect(asideEl().style.width).toBe('')
  })
})
