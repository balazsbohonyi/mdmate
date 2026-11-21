// @vitest-environment jsdom
/**
 * The sidebar cannot be narrower than its tab strip (P9.1-T23, ISC-636, ISC-637). jsdom has no
 * layout, so the widths of the tabs and the strip's padding and gap are stubbed with the numbers
 * measured in `pnpm dev` (Folders 56.6, Search 50.8, Outline 54.4, References 80.2, the close button
 * 20, padding 12 each side, gap 12), and the frame's own reading of them is what is tested.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { closeReferences, referencesState, resetReferences } from '@/features/references/store'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import SidebarFrame from '@/shell/SidebarFrame.vue'
import {
  SIDEBAR_DEFAULT,
  resetSidebar,
  setSidebarWidth,
  sidebarMinimum,
  sidebarWidth,
} from '@/workbench/sidebar'

const WINDOW = 1200

const WIDTHS = {
  folders: 56.6,
  search: 50.8,
  outline: 54.4,
  references: 80.2,
  close: 20,
}
/** Padding, then the tabs, then the gaps between them, then the border of the frame. */
const THREE = 12 + 12 + (56.6 + 50.8 + 54.4) + 2 * 12 + 1
const FOUR = 12 + 12 + (56.6 + 50.8 + 54.4 + 80.2 + 20) + 4 * 12 + 1

class FakeObserver {
  observe = (): undefined => undefined
  unobserve = (): undefined => undefined
  disconnect = (): undefined => undefined
}
Object.assign(globalThis, { ResizeObserver: FakeObserver })

let app: App | undefined
let root: HTMLElement | undefined

function widthOf(element: Element): number {
  const tab = element.getAttribute('data-sidebar-tab')
  if (tab !== null) return WIDTHS[tab as keyof typeof WIDTHS]
  if (element.getAttribute('aria-label') === 'Close references') return WIDTHS.close
  return 0
}

beforeEach(async () => {
  resetSidebar()
  resetReferences()
  setHost(createMockHost({ files: {}, roots: [] }))
  Object.defineProperty(window, 'innerWidth', { value: WINDOW, configurable: true })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const width = this.tagName === 'ASIDE' ? (sidebarWidth.value ?? SIDEBAR_DEFAULT) : widthOf(this)
    return { width, height: 0, left: 0, right: width, top: 0, bottom: 0, x: 0, y: 0 } as DOMRect
  })
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () =>
      ({
        paddingLeft: '12px',
        paddingRight: '12px',
        columnGap: '12px',
        borderLeftWidth: '0px',
        borderRightWidth: '1px',
      }) as unknown as CSSStyleDeclaration,
  )
  root = document.createElement('div')
  document.body.append(root)
  app = createApp(SidebarFrame)
  app.mount(root)
  await nextTick()
})

afterEach(() => {
  app?.unmount()
  root?.remove()
  app = undefined
  vi.restoreAllMocks()
  setHost(undefined)
  resetSidebar()
  resetReferences()
  document.body.innerHTML = ''
})

const aside = (): HTMLElement => {
  const found = root?.querySelector('aside')
  if (found === null || found === undefined) throw new Error('no sidebar')
  return found
}
const handle = (): HTMLElement => {
  const found = root?.querySelector<HTMLElement>('[data-sidebar-handle]')
  if (found === null || found === undefined) throw new Error('no handle')
  return found
}

function pointer(type: string, x: number): PointerEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 })
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

async function arrow(key: string): Promise<void> {
  handle().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  await nextTick()
}

/** Waits for the frame to render a change, measure the strip, and render the minimum it found. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 4; tick++) await nextTick()
}

/** Shows the References tab, and waits for the frame to measure the longer strip. */
async function showReferences(): Promise<void> {
  referencesState.value = { phase: 'searching', target: 'a.md' }
  await settle()
}

describe('the tab strip sets the minimum width (ISC-636)', () => {
  it('measures the three tabs, the strip padding, the gaps and the border', () => {
    expect(sidebarMinimum.value).toBe(Math.ceil(THREE))
    expect(Math.ceil(THREE)).toBe(211)
  })

  it('holds the frame at that width as a minimum, in place of the old 12rem class', () => {
    expect(aside().style.minWidth).toBe('211px')
    expect(aside().className).not.toContain('min-w-48')
  })

  it('does not let a drag go under it', async () => {
    await dragBy(-500)
    expect(sidebarWidth.value).toBe(211)
    expect(aside().style.width).toBe('211px')
  })

  it('does not let the arrow keys go under it, and reports it as the least the handle takes', async () => {
    await arrow('ArrowLeft')
    expect(sidebarWidth.value).toBe(224)
    await arrow('ArrowLeft')
    expect(sidebarWidth.value).toBe(211)
    await arrow('ArrowLeft')
    expect(sidebarWidth.value).toBe(211)
    expect(handle().getAttribute('aria-valuemin')).toBe('211')
  })

  it('raises a width restored from the session to it', () => {
    setSidebarWidth(150, WINDOW)
    expect(sidebarWidth.value).toBe(211)
  })
})

describe('the References tab is part of the strip while it is shown (ISC-637)', () => {
  it('adds the tab, its close button and their gaps to the minimum, and takes them away again', async () => {
    await showReferences()
    expect(sidebarMinimum.value).toBe(Math.ceil(FOUR))
    expect(Math.ceil(FOUR)).toBe(335)
    expect(aside().style.minWidth).toBe('335px')
    // The default width is 240, under the new minimum the page holds it at: the handle reports what
    // is drawn, never a value under its own minimum.
    expect(handle().getAttribute('aria-valuemin')).toBe('335')
    expect(handle().getAttribute('aria-valuenow')).toBe('335')
    closeReferences()
    await settle()
    expect(sidebarMinimum.value).toBe(211)
    expect(aside().style.minWidth).toBe('211px')
  })

  it('lifts a width the user set below the new minimum, and gives no more back on close', async () => {
    await dragBy(10)
    expect(sidebarWidth.value).toBe(250)
    await showReferences()
    expect(sidebarWidth.value).toBe(335)
    closeReferences()
    await settle()
    expect(sidebarWidth.value).toBe(335)
  })

  it('does not let a drag go under the longer strip', async () => {
    await showReferences()
    await dragBy(-500)
    expect(sidebarWidth.value).toBe(335)
  })
})

describe('the minimum follows the strip', () => {
  it('is measured again when the window is resized, so a change of font or zoom reaches it', async () => {
    WIDTHS.outline = 70
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(sidebarMinimum.value).toBe(Math.ceil(12 + 12 + (56.6 + 50.8 + 70) + 24 + 1))
    WIDTHS.outline = 54.4
  })

  it('goes back to the 12rem fallback when the sidebar is unmounted', () => {
    app?.unmount()
    app = undefined
    expect(sidebarMinimum.value).toBe(192)
  })
})
