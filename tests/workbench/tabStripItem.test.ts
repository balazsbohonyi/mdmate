// @vitest-environment jsdom
/**
 * The unsaved dot and the close button share one 20 px slot (ISC-250): the dot sits exactly where
 * the X appears, and the tab is the same width whether or not the pointer is over it. jsdom has no
 * layout, so this pins the structure; the measured positions are checked in the real window.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, type App } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import TabStripItem from '@/workbench/TabStripItem.vue'
import type { TabInfo } from '@/workbench/tabs'

let mounted: { app: App; root: HTMLElement } | undefined

function mount(tab: TabInfo, active = false, handlers: Record<string, unknown> = {}): HTMLElement {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h(TooltipProvider, () => h(TabStripItem, { tab, active, ...handlers })),
  })
  app.mount(root)
  mounted = { app, root }
  const item = root.querySelector<HTMLElement>('[role=tab]')
  if (item === null) throw new Error('no tab')
  return item
}

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
})

const tab = (dirty: boolean): TabInfo => ({ id: 't', kind: 'markdown', title: 'a.md', dirty })

/** The classes of a tab, split on spaces. */
const classesOf = (element: Element | null | undefined): string[] =>
  (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)

describe('the tab look (ISC-565)', () => {
  it('has no top edge: no border classes, whichever the tab and the pane', () => {
    for (const active of [true, false]) {
      const item = mount(tab(false), active)
      expect(
        classesOf(item).filter((name) => /^(border|hover:border|.*:border)/.test(name)),
      ).toEqual([])
      mounted?.app.unmount()
      mounted?.root.remove()
    }
  })

  it('has rounded top corners, and square ones at the bottom', () => {
    const item = mount(tab(false), true)
    expect(classesOf(item)).toContain('rounded-t-md')
    expect(classesOf(item).filter((name) => /^rounded-(?!t-)/.test(name))).toEqual([])
  })

  it('gives the active tab the content color and the others no background, so the strip shows (ISC-565)', () => {
    expect(classesOf(mount(tab(false), true))).toContain('bg-tab-active')
    mounted?.app.unmount()
    mounted?.root.remove()
    const idle = classesOf(mount(tab(false), false))
    // No background class at rest: only the pointer on the tab gives it one.
    expect(idle.filter((name) => name.startsWith('bg-'))).toEqual([])
    expect(idle).toContain('text-tab-foreground')
    expect(idle).toContain('hover:bg-accent')
    expect(idle).toContain('hover:text-accent-foreground')
    expect(idle).not.toContain('bg-tab-inactive')
  })

  it('draws a separator on the left edge of a tab that is not active, and none on the active one', () => {
    const idle = classesOf(mount(tab(false), false))
    expect(idle).toEqual(
      expect.arrayContaining([
        'before:absolute',
        'before:left-0',
        'before:w-px',
        'before:bg-tab-separator',
      ]),
    )
    mounted?.app.unmount()
    mounted?.root.remove()
    expect(classesOf(mount(tab(false), true)).filter((name) => name.includes('before:'))).toEqual(
      [],
    )
  })

  it('has 0.5rem of padding above the tabs, and the sidebar header keeps the strip height', () => {
    const strip = readFileSync('src/workbench/TabStrip.vue', 'utf8')
    expect(strip).toMatch(/data-tab-strip\s+class="[^"]*\bh-tabstrip\b[^"]*\bpt-2\b/)
    expect(strip).not.toMatch(/\bborder-t/)
    // The strip is 2.5rem: 0.5rem of padding, 2rem of tab, and the line below.
    expect(readFileSync('src/styles/tokens.css', 'utf8')).toMatch(/--spacing-tabstrip: 2\.5rem;/)
    expect(readFileSync('src/shell/SidebarFrame.vue', 'utf8')).toContain('h-tabstrip')
  })

  it('hides the separators by CSS alone: first tab, next to the active tab, and beside a hovered one', () => {
    const idle = classesOf(mount(tab(false), false))
    expect(idle).toContain('first:before:hidden')
    expect(idle).toContain('[[aria-selected=true]+&]:before:hidden')
    expect(idle).toContain('hover:before:opacity-0')
    expect(idle).toContain('[:hover+&]:before:opacity-0')
  })
})

describe('the unsaved dot and the close button (ISC-250)', () => {
  it('put both in one 20 px slot at the right end', () => {
    const item = mount(tab(true))
    const slot = item.querySelector<HTMLElement>('[data-tab-slot]')
    expect(slot).not.toBeNull()
    expect(slot?.className).toContain('size-5')
    expect(slot?.className).toContain('place-items-center')
    expect(slot?.className).toContain('ml-auto')
    expect(slot?.querySelector('[data-dirty]')).not.toBeNull()
    expect(slot?.querySelector('[aria-label="Close tab"]')).not.toBeNull()
    // Nothing else of the tab sits after the slot.
    expect(item.lastElementChild).toBe(slot)
  })

  it('swap on hover instead of changing the tab width', () => {
    const item = mount(tab(true))
    const dot = item.querySelector<HTMLElement>('[data-dirty]')
    const close = item.querySelector<HTMLElement>('[aria-label="Close tab"]')
    expect(dot?.className).toContain('group-hover:hidden')
    expect(close?.className).toContain('hidden')
    expect(close?.className).toContain('group-hover:flex')
    // The close button fills the slot; the dot is centred inside it and is smaller.
    expect(close?.className).toContain('size-5')
    expect(dot?.className).toContain('size-2')
    expect(dot?.className).not.toContain('ml-auto')
  })

  it('a tab without changes has no dot and keeps its close button in the same slot', () => {
    const item = mount(tab(false), true)
    expect(item.querySelector('[data-dirty]')).toBeNull()
    const close = item.querySelector<HTMLElement>('[data-tab-slot] [aria-label="Close tab"]')
    expect(close).not.toBeNull()
    expect(close?.className).toContain('opacity-100')
  })
})

describe('the pin of a pinned tab (ISC-571)', () => {
  const pinnedTab = (dirty: boolean): TabInfo => ({
    id: 't',
    kind: 'markdown',
    title: 'a.md',
    dirty,
    pinned: true,
  })

  it('shows a pin in the slot where the X is, and no close button', () => {
    const item = mount(pinnedTab(false))
    const slot = item.querySelector<HTMLElement>('[data-tab-slot]')
    expect(slot?.querySelector('[data-tab-pin]')).not.toBeNull()
    expect(slot?.querySelector('[aria-label="Close tab"]')).toBeNull()
    expect(item.lastElementChild).toBe(slot)
    expect(slot?.className).toContain('size-5')
    expect(item.getAttribute('data-tab-pinned')).toBe('true')
  })

  it('shows no pin, and the X as before, on a tab that is not pinned', () => {
    const item = mount(tab(false))
    expect(item.querySelector('[data-tab-pin]')).toBeNull()
    expect(item.querySelector('[aria-label="Close tab"]')).not.toBeNull()
    expect(item.getAttribute('data-tab-pinned')).toBe('false')
  })

  it('has no dot while nothing is unsaved', () => {
    expect(mount(pinnedTab(false)).querySelector('[data-dirty]')).toBeNull()
  })

  it('puts a smaller dot on the corner of the pin while there are unsaved changes', () => {
    const item = mount(pinnedTab(true))
    const pin = item.querySelector<HTMLElement>('[data-tab-pin]')
    const dot = pin?.querySelector<HTMLElement>('[data-dirty]')
    expect(dot).not.toBeNull()
    expect(dot?.className).toContain('size-1.5')
    expect(dot?.className.split(' ')).toContain('absolute')
    expect(dot?.className).toContain('right-0')
    expect(dot?.className).toContain('bottom-0')
    // The dot of an unpinned tab is the bigger one, and sits beside the X, not on the pin.
    const plain = mount(tab(true)).querySelector<HTMLElement>('[data-dirty]')
    expect(plain?.className).toContain('size-2')
  })

  it('hides the dot while the pointer is on the pin, and swaps the pin for the unpin icon', () => {
    const item = mount(pinnedTab(true))
    const pin = item.querySelector<HTMLElement>('[data-tab-pin]')
    expect(pin?.className).toContain('group/pin')
    expect(pin?.querySelector('[data-dirty]')?.className).toContain('group-hover/pin:hidden')
    const icons = [...(pin?.querySelectorAll('svg') ?? [])]
    expect(icons).toHaveLength(2)
    expect(icons[0]?.getAttribute('class')).toContain('group-hover/pin:hidden')
    expect(icons[1]?.getAttribute('class')).toContain('group-hover/pin:block')
  })

  it('unpins on a click on the pin, also while the tab has unsaved changes, and selects nothing', () => {
    for (const dirty of [false, true]) {
      const calls: string[] = []
      const item = mount(pinnedTab(dirty), false, {
        onUnpin: () => calls.push('unpin'),
        onSelect: () => calls.push('select'),
        onClose: () => calls.push('close'),
      })
      item.querySelector<HTMLElement>('[data-tab-pin]')?.click()
      expect(calls).toEqual(['unpin'])
      mounted?.app.unmount()
      mounted?.root.remove()
    }
  })

  it('does not start a drag from a press on the pin', () => {
    const presses: string[] = []
    const item = mount(pinnedTab(false), false, { onPress: () => presses.push('press') })
    const pin = item.querySelector<HTMLElement>('[data-tab-pin]')
    pin?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(presses).toEqual([])
    item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(presses).toEqual(['press'])
  })
})
