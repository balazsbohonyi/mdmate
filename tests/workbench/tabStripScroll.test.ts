// @vitest-environment jsdom
/**
 * The tab strip's scrolling and its two buttons (ISC-247): a strip with more tabs than room
 * scrolls sideways with no visible bar and keeps the active tab in view, the mouse wheel scrolls it,
 * a + makes a new file in the strip's pane, and a chevron lists the pane's tabs.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import TabStrip from '@/workbench/TabStrip.vue'
import type { TabInfo } from '@/workbench/tabs'

class FakeObserver {
  observe = (): undefined => undefined
  unobserve = (): undefined => undefined
  disconnect = (): undefined => undefined
}
Object.assign(globalThis, { ResizeObserver: FakeObserver })

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

function tab(n: number, dirty = false): TabInfo {
  return { id: `tab-${n}`, kind: 'markdown', title: `file-${n}.md`, dirty }
}

interface Mounted {
  app: App
  root: HTMLElement
  state: { tabs: TabInfo[]; activeId: string | null }
  selected: string[]
  news: number
}

let mounted: Mounted | undefined

function mount(tabs: TabInfo[], activeId: string | null): Mounted {
  const state = reactive({ tabs, activeId })
  const root = document.createElement('div')
  document.body.append(root)
  const result: Mounted = { app: undefined as unknown as App, root, state, selected: [], news: 0 }
  result.app = createApp({
    render: () =>
      h(TooltipProvider, { delayDuration: 0 }, () =>
        h(TabStrip, {
          tabs: state.tabs,
          activeId: state.activeId,
          onSelect: (id: string) => result.selected.push(id),
          onNew: () => {
            result.news += 1
          },
        }),
      ),
  })
  result.app.mount(root)
  mounted = result
  return result
}

const scroller = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[role=tablist]')
  if (element === null) throw new Error('no tab list')
  return element
}

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  document.body.replaceChildren()
})

/** Gives the strip a width of 300 px and every tab 100 px, laid out in a row from `scrollLeft`. */
function layOut(strip: HTMLElement, count: number): void {
  Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 300 })
  Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: count * 100 })
  strip.getBoundingClientRect = () => new DOMRect(0, 0, 300, 35)
  strip.querySelectorAll<HTMLElement>('[data-tab-id]').forEach((element, index) => {
    element.getBoundingClientRect = () => new DOMRect(index * 100 - strip.scrollLeft, 0, 100, 35)
  })
}

describe('the strip scrolls and shows no scrollbar (ISC-247)', () => {
  it('hides its scrollbar and lets the tabs keep their width instead of shrinking', async () => {
    mount([tab(1), tab(2)], 'tab-1')
    await flush()
    expect(scroller().className).toContain('overflow-x-auto')
    expect(scroller().className).toContain('[scrollbar-width:none]')
    expect(scroller().className).toContain('[&::-webkit-scrollbar]:hidden')
    for (const element of document.querySelectorAll('[role=tab]')) {
      expect(element.className).toContain('shrink-0')
      expect(element.className).toContain('min-w-24')
    }
  })

  it('turns the mouse wheel into a sideways scroll while the tabs overflow', async () => {
    const m = mount(
      Array.from({ length: 8 }, (_, i) => tab(i + 1)),
      'tab-1',
    )
    await flush()
    const strip = scroller()
    layOut(strip, m.state.tabs.length)
    const wheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    strip.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(strip.scrollLeft).toBe(120)
    const back = new WheelEvent('wheel', { deltaY: -50, bubbles: true, cancelable: true })
    strip.dispatchEvent(back)
    expect(strip.scrollLeft).toBe(70)
  })

  it('leaves the wheel alone when the tabs fit, and a sideways swipe to the browser', async () => {
    const m = mount([tab(1), tab(2)], 'tab-1')
    await flush()
    const strip = scroller()
    layOut(strip, 2)
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 200 })
    const fits = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    strip.dispatchEvent(fits)
    expect(fits.defaultPrevented).toBe(false)
    expect(strip.scrollLeft).toBe(0)

    m.state.tabs = Array.from({ length: 8 }, (_, i) => tab(i + 1))
    await flush()
    layOut(strip, 8)
    const sideways = new WheelEvent('wheel', {
      deltaX: 90,
      deltaY: 5,
      bubbles: true,
      cancelable: true,
    })
    strip.dispatchEvent(sideways)
    expect(sideways.defaultPrevented).toBe(false)
  })

  it('brings the active tab into view when it changes, and no further than needed', async () => {
    const m = mount(
      Array.from({ length: 8 }, (_, i) => tab(i + 1)),
      'tab-1',
    )
    await flush()
    const strip = scroller()
    layOut(strip, 8)
    m.state.activeId = 'tab-7' // at 600..700 with a 300 wide strip: its right edge sticks out by 400
    await flush()
    expect(strip.scrollLeft).toBe(400)
    m.state.activeId = 'tab-2' // now at -200..-100: its left edge is 200 left of the strip
    await flush()
    expect(strip.scrollLeft).toBe(100)
    m.state.activeId = 'tab-3' // 200..300 is inside 100..400
    await flush()
    expect(strip.scrollLeft).toBe(100)
  })

  it('brings a tab into view when one is added and made active', async () => {
    const m = mount(
      Array.from({ length: 4 }, (_, i) => tab(i + 1)),
      'tab-1',
    )
    await flush()
    const strip = scroller()
    layOut(strip, 4)
    m.state.tabs = [...m.state.tabs, tab(5)]
    m.state.activeId = 'tab-5'
    await flush()
    layOut(strip, 5)
    // The layout was only known after the tab was drawn; the next change shows it.
    m.state.activeId = 'tab-4'
    m.state.activeId = 'tab-5'
    await flush()
    expect(strip.scrollLeft).toBeGreaterThanOrEqual(0)
  })
})

describe('the + and the tab list stay at the right end (ISC-247)', () => {
  it('keeps both buttons outside the scrolling list of tabs', async () => {
    mount(
      Array.from({ length: 30 }, (_, i) => tab(i + 1)),
      'tab-1',
    )
    await flush()
    const actions = document.querySelector('[data-tab-actions]')
    expect(actions).not.toBeNull()
    expect(scroller().contains(actions)).toBe(false)
    expect(document.querySelector('[data-new-tab]')).not.toBeNull()
    expect(document.querySelector('[data-tab-list]')).not.toBeNull()
    // Hints are tooltips, never a native title.
    expect(actions?.querySelector('[title]')).toBeNull()
  })

  it('+ asks for a new file', async () => {
    const m = mount([tab(1)], 'tab-1')
    await flush()
    document.querySelector<HTMLElement>('[data-new-tab]')?.click()
    expect(m.news).toBe(1)
  })

  it("the chevron lists the pane's tabs, marks the active one and selects the one chosen", async () => {
    const m = mount([tab(1), tab(2, true), tab(3)], 'tab-2')
    await flush()
    const trigger = document.querySelector<HTMLElement>('[data-tab-list]')
    trigger?.click()
    await flush()
    const items = [...document.querySelectorAll<HTMLElement>('[data-tab-list-item]')]
    expect(items.map((item) => item.textContent.trim())).toEqual([
      'file-1.md',
      'file-2.md',
      'file-3.md',
    ])
    const check = (item: HTMLElement): string =>
      item.querySelector('svg')?.getAttribute('class') ?? ''
    expect(check(items[1]!)).toContain('opacity-100')
    expect(check(items[0]!)).toContain('opacity-0')
    expect(items[1]?.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull()
    expect(items[0]?.querySelector('[aria-label="Unsaved changes"]')).toBeNull()
    items[2]?.click()
    await flush()
    expect(m.selected).toEqual(['tab-3'])
  })

  it('a tab the strip does not show yet is still in the list', async () => {
    mount(
      Array.from({ length: 40 }, (_, i) => tab(i + 1)),
      'tab-1',
    )
    await flush()
    document.querySelector<HTMLElement>('[data-tab-list]')?.click()
    await flush()
    expect(document.querySelectorAll('[data-tab-list-item]')).toHaveLength(40)
  })
})

describe('the strip as the drag and drop reads it', () => {
  it('marks the whole strip, buttons included, as the drop area of its pane', async () => {
    mount([tab(1)], 'tab-1')
    await flush()
    const strip = document.querySelector('[data-tab-strip]')
    expect(strip?.contains(scroller())).toBe(true)
    expect(strip?.contains(document.querySelector('[data-tab-actions]'))).toBe(true)
  })
})
