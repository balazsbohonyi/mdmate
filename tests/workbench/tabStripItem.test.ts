// @vitest-environment jsdom
/**
 * The unsaved dot and the close button share one 20 px slot (ISC-250): the dot sits exactly where
 * the X appears, and the tab is the same width whether or not the pointer is over it. jsdom has no
 * layout, so this pins the structure; the measured positions are checked in the real window.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, type App } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import TabStripItem from '@/workbench/TabStripItem.vue'
import type { TabInfo } from '@/workbench/tabs'

let mounted: { app: App; root: HTMLElement } | undefined

function mount(tab: TabInfo, active = false): HTMLElement {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h(TooltipProvider, () => h(TabStripItem, { tab, active })),
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
