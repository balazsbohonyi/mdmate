// @vitest-environment jsdom
/**
 * The toasts that tell the user a thing did not work: the real report functions and the real
 * Toaster, in the shell, against the browser stand-in for the host. (The other tests swap the
 * report functions for a recorder; see tests/helpers/setupToasts.ts.)
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resetDocuments, openPath } from '@/documents/store'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import AppShell from '@/shell/AppShell.vue'
import { resetWorkbench } from '@/workbench/store'

type Toasts = typeof import('@/shell/toasts')
let toasts: Toasts

beforeAll(() => {
  // jsdom has no layout; CodeMirror's mouse handling asks ranges for their boxes.
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

let mounted: { app: App; root: HTMLElement } | undefined

async function flush(): Promise<void> {
  for (let round = 0; round < 4; round++) {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }
}

async function mountShell(): Promise<HTMLElement> {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(TooltipProvider, null, () => h(AppShell)) })
  app.mount(root)
  mounted = { app, root }
  await flush()
  return root
}

/** The toasts on screen, as [type, text], oldest first (the page lists the newest first). */
function shown(): [string | null, string][] {
  return [...document.querySelectorAll('[data-sonner-toast]')]
    .reverse()
    .map((toast) => [
      toast.getAttribute('data-type'),
      toast.querySelector('[data-title]')?.textContent?.trim() ?? '',
    ])
}

beforeEach(async () => {
  vi.useFakeTimers()
  toasts = await vi.importActual<Toasts>('@/shell/toasts')
  setHost(createMockHost({ files: { '/work/a.md': 'a\n', '/work/b.md': 'b\n' } }))
})

afterEach(async () => {
  toasts.dismissAllToasts()
  await vi.advanceTimersByTimeAsync(1000)
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  resetDocuments()
  resetWorkbench()
  vi.useRealTimers()
})

describe('toasts for things that went wrong', () => {
  it('shows an error and a warning, each at its own level', async () => {
    await mountShell()
    toasts.reportError('Could not open x.md: gone')
    toasts.reportWarning('Link target not found: y.md')
    await flush()
    expect(shown()).toEqual([
      ['error', 'Could not open x.md: gone'],
      ['warning', 'Link target not found: y.md'],
    ])
  })

  it('stacks different messages, up to four at a time', async () => {
    await mountShell()
    for (const n of [1, 2, 3, 4, 5]) toasts.reportWarning(`message ${String(n)}`)
    await flush()
    // The fifth is kept but not shown until room is made.
    expect(document.querySelectorAll('[data-sonner-toast][data-visible="true"]')).toHaveLength(4)
  })

  it('shows the same message once, and starts its time again', async () => {
    await mountShell()
    toasts.reportWarning('same thing')
    await flush()
    await vi.advanceTimersByTimeAsync(9000)
    toasts.reportWarning('same thing')
    await flush()
    expect(shown()).toHaveLength(1)
    // Twelve seconds after the first showing it would be gone; the second showing keeps it.
    await vi.advanceTimersByTimeAsync(5000)
    await flush()
    expect(shown()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(8000)
    await flush()
    expect(shown()).toHaveLength(0)
  })

  it('closes a toast by itself after twelve seconds, each on its own time', async () => {
    await mountShell()
    toasts.reportError('first')
    await flush()
    await vi.advanceTimersByTimeAsync(6000)
    toasts.reportError('second')
    await flush()
    await vi.advanceTimersByTimeAsync(5500)
    await flush()
    expect(shown().map(([, text]) => text)).toEqual(['first', 'second'])
    await vi.advanceTimersByTimeAsync(1500)
    await flush()
    expect(shown().map(([, text]) => text)).toEqual(['second'])
    await vi.advanceTimersByTimeAsync(6000)
    await flush()
    expect(shown()).toEqual([])
  })

  it('waits while the pointer is on the stack', async () => {
    await mountShell()
    toasts.reportWarning('hold on')
    await flush()
    const list = document.querySelector('[data-sonner-toaster]')
    expect(list).not.toBeNull()
    list?.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(30_000)
    await flush()
    expect(shown()).toHaveLength(1)
    list?.dispatchEvent(new MouseEvent('mouseleave'))
    await vi.advanceTimersByTimeAsync(13_000)
    await flush()
    expect(shown()).toHaveLength(0)
  })

  it('has a close button on each toast', async () => {
    await mountShell()
    toasts.reportError('close me')
    await flush()
    const button = document.querySelector<HTMLElement>('[data-sonner-toast] [data-close-button]')
    expect(button).not.toBeNull()
    expect(
      document.querySelector('[data-sonner-toaster]')?.getAttribute('data-x-position') ?? 'right',
    ).toBe('right')
    button?.click()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(shown()).toHaveLength(0)
  })

  it('closes every toast when the active tab changes', async () => {
    await mountShell()
    const a = await openPath('/work/a.md')
    await openPath('/work/b.md')
    toasts.reportWarning('about a')
    toasts.reportError('about b')
    await flush()
    expect(shown()).toHaveLength(2)
    const { selectTab } = await import('@/workbench/store')
    selectTab(a)
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(shown()).toEqual([])
  })

  it('closes every toast when the tab shown is closed', async () => {
    await mountShell()
    await openPath('/work/a.md')
    const b = await openPath('/work/b.md')
    toasts.reportError('about b')
    await flush()
    expect(shown()).toHaveLength(1)
    const { closeTabById } = await import('@/workbench/store')
    closeTabById(b)
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(shown()).toEqual([])
  })

  it('closes every toast when another pane takes the focus', async () => {
    await mountShell()
    await openPath('/work/a.md')
    const { splitActivePane, focusPane } = await import('@/workbench/store')
    const { workbenchLayout } = await import('@/workbench/store')
    const first = workbenchLayout.value.activePane
    splitActivePane('row')
    await flush()
    expect(workbenchLayout.value.activePane).not.toBe(first)
    toasts.reportWarning('about the new pane')
    await flush()
    expect(shown()).toHaveLength(1)
    focusPane(first)
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(shown()).toEqual([])
  })

  it('keeps a toast when the active tab stays the same', async () => {
    await mountShell()
    await openPath('/work/a.md')
    toasts.reportWarning('stays')
    await flush()
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(shown()).toHaveLength(1)
  })
})
