// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import TabDragLayer from '@/workbench/TabDragLayer.vue'
import { tabDrag } from '@/workbench/tabDrag'
import type { DropTarget } from '@/workbench/tabDropTarget'

/** The drop preview drawn while a tab is dragged (ISC-544, ISC-548). */

const PANE: DropTarget = {
  kind: 'pane',
  paneId: 'p1',
  preview: { left: 0, top: 34, right: 400, bottom: 300 },
}
const BAR: DropTarget = {
  kind: 'strip',
  paneId: 'p1',
  index: 1,
  preview: { left: 99, top: 0, right: 101, bottom: 34 },
}

let app: App | null = null

async function show(target: DropTarget | null): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  tabDrag.value = { tabId: 'a', title: 'a.md', x: 10, y: 10, target }
  app = createApp(TabDragLayer)
  app.mount(host)
  await nextTick()
  return host
}

afterEach(() => {
  app?.unmount()
  app = null
  tabDrag.value = null
  document.body.innerHTML = ''
})

describe('ISC-544: the drop preview', () => {
  it('is a tint with no border over a pane', async () => {
    const host = await show(PANE)
    const preview = host.querySelector<HTMLElement>('[data-drop-preview]')
    expect(preview).not.toBeNull()
    const classes = preview?.className ?? ''
    expect(classes).toContain('bg-drop-preview')
    expect(classes).not.toMatch(/(^|\s)border/)
    expect(classes).not.toContain('border-primary')
    expect(preview?.style.width).toBe('400px')
  })

  it('has no transition: it jumps from one target to the next', async () => {
    const host = await show(PANE)
    const classes = host.querySelector('[data-drop-preview]')?.className ?? ''
    expect(classes).not.toMatch(/transition|duration|ease-|animate/)
  })

  it('keeps the solid insertion bar in a tab strip', async () => {
    const host = await show(BAR)
    const classes = host.querySelector('[data-drop-preview]')?.className ?? ''
    expect(classes).toContain('bg-primary')
    expect(classes).not.toContain('bg-drop-preview')
    expect(classes).not.toMatch(/transition|duration|ease-|animate/)
  })

  it('follows the target when it changes', async () => {
    const host = await show(PANE)
    tabDrag.value = {
      tabId: 'a',
      title: 'a.md',
      x: 300,
      y: 100,
      target: { ...PANE, preview: { left: 200, top: 34, right: 400, bottom: 300 } },
    }
    await nextTick()
    const after = host.querySelector<HTMLElement>('[data-drop-preview]')
    expect(after?.style.left).toBe('200px')
    expect(after?.style.width).toBe('200px')
  })

  it('shows no preview while no target is under the pointer', async () => {
    const host = await show(null)
    expect(host.querySelector('[data-drop-preview]')).toBeNull()
  })
})
