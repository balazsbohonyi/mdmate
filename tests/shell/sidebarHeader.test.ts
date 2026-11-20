// @vitest-environment jsdom
/**
 * The sidebar header (P9.1 review): its labels sit on the same line as the tab labels beside them,
 * and the selected one is marked by more than a small change of text color. Computed layout is not
 * available in jsdom, so the line-up is proven on the classes that make it, and the real pixel
 * positions were measured in `pnpm dev` (see the ISA, Verification).
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resetTree } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import SidebarFrame from '@/shell/SidebarFrame.vue'
import { resetSidebar, showSidebar } from '@/workbench/sidebar'

class FakeObserver {
  observe = (): undefined => undefined
  unobserve = (): undefined => undefined
  disconnect = (): undefined => undefined
}
Object.assign(globalThis, { ResizeObserver: FakeObserver })

let mounted: { app: App; root: HTMLElement } | undefined

beforeEach(() => {
  setHost(createMockHost({ files: {}, roots: [] }))
  resetSidebar()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h(TooltipProvider, { delayDuration: 0 }, () => [h(SidebarFrame)]),
  })
  app.mount(root)
  mounted = { app, root }
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  resetTree()
  resetSidebar()
  document.body.innerHTML = ''
})

const TABS = ['folders', 'search', 'outline'] as const

function button(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-sidebar-tab="${id}"]`)
  if (found === null) throw new Error(`no ${id} label in the header`)
  return found
}

describe('the sidebar header labels', () => {
  it('are padded from the top by a little more than the tab strip, so the text shares its baseline', () => {
    const header = button('folders').parentElement
    expect(header).not.toBeNull()
    const classes = header?.className.split(/\s+/) ?? []
    expect(classes).toContain('h-tabstrip')
    expect(classes).toContain('items-center')
    // The strip pads its tabs by pt-2. The labels are 12 px against the tabs' 13 px, so centered in
    // the same space their baseline would sit a pixel high; 2 px more padding puts it level.
    expect(readFileSync('src/workbench/TabStrip.vue', 'utf8')).toMatch(/\bpt-2\b/)
    expect(classes).toContain('pt-2.5')
  })

  it('fill the height of the header below the padding, so the mark reaches its bottom edge', () => {
    for (const id of TABS) {
      const classes = button(id).className.split(/\s+/)
      expect(classes).toContain('h-full')
      expect(classes).toContain('items-center')
      expect(classes).toContain('relative')
    }
  })

  it('mark the selected label with a primary underline and the strong text color, and no other', async () => {
    for (const selected of TABS) {
      showSidebar(selected)
      await nextTick()
      for (const id of TABS) {
        const classes = button(id).className.split(/\s+/)
        const marked =
          classes.includes('text-foreground') &&
          classes.includes('after:bg-primary') &&
          classes.includes('after:h-0.5') &&
          classes.includes('after:bottom-0') &&
          classes.includes('after:inset-x-0')
        expect(marked, `${id} while ${selected} is selected`).toBe(id === selected)
        expect(button(id).getAttribute('aria-pressed')).toBe(String(id === selected))
        if (id !== selected) {
          expect(classes.some((name) => name.startsWith('after:'))).toBe(false)
        }
      }
    }
  })

  it('keep the same weight and size selected or not, so switching never moves a label', async () => {
    showSidebar('folders')
    await nextTick()
    const widthClasses = (id: string): string[] =>
      button(id)
        .className.split(/\s+/)
        .filter((name) => /^(font-|text-(xs|sm|chrome|base)|tracking-|px-|gap-)/.test(name))
    const before = TABS.map(widthClasses)
    showSidebar('search')
    await nextTick()
    expect(TABS.map(widthClasses)).toEqual(before)
  })
})
