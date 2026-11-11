// @vitest-environment jsdom
/**
 * An image tab keeps its zoom and pan while other tabs are shown (ISC-233), and a tab the owner
 * never zoomed still fits. The numbers first, then the tab drawn, switched away from and back to.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import ImageView from '@/workbench/ImageView.vue'
import {
  actualView,
  fitView,
  recall,
  remember,
  rememberedView,
  rememberView,
  resetRememberedViews,
  zoomAbout,
} from '@/workbench/imageView'
import { closeTabById, openTabFor, resetWorkbench } from '@/workbench/store'

const PANE = { width: 800, height: 600 }
const PICTURE = { width: 2400, height: 1600 }

describe('remembering a place in a picture', () => {
  it('comes back to the same view in the same pane', () => {
    const view = zoomAbout(fitView(PICTURE, PANE), 6, 123, 456)
    const back = recall(remember(view, PANE, false), PANE)
    expect(back.scale).toBeCloseTo(view.scale)
    expect(back.x).toBeCloseTo(view.x)
    expect(back.y).toBeCloseTo(view.y)
  })

  it('keeps the same spot at the centre when the pane has another size', () => {
    const view = actualView(PICTURE, PANE)
    const saved = remember(view, PANE, false)
    const bigger = { width: 1200, height: 900 }
    const back = recall(saved, bigger)
    expect(back.scale).toBe(1)
    // The spot that was in the middle of the old pane is in the middle of the new one.
    expect(bigger.width / 2 - back.x).toBeCloseTo(PANE.width / 2 - view.x)
    expect(bigger.height / 2 - back.y).toBeCloseTo(PANE.height / 2 - view.y)
  })
})

describe('the image tab drawn', () => {
  let app: App | undefined
  let root: HTMLElement | undefined

  beforeEach(() => {
    resetWorkbench()
    resetRememberedViews()
    setHost(createMockHost({ files: { '/a.png': 'x' }, roots: ['/'] }))
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 })
    if (!('ResizeObserver' in globalThis)) {
      Object.assign(globalThis, {
        ResizeObserver: class {
          observe(): void {
            // the pane never resizes in these tests
          }
          disconnect(): void {
            // nothing was observed
          }
        },
      })
    }
  })

  afterEach(() => {
    app?.unmount()
    root?.remove()
    app = undefined
    setHost(undefined)
    resetWorkbench()
    resetRememberedViews()
  })

  /** Mounts the tab as the pane does, before its picture has loaded. */
  async function mountTab(tabId: string): Promise<HTMLElement> {
    root = document.createElement('div')
    document.body.append(root)
    app = createApp(ImageView, { tabId, path: '/a.png', size: 10 })
    app.mount(root)
    await nextTick()
    await nextTick()
    return root
  }

  /** Shows the tab as the pane does, and lets its picture "load" at 2400 x 1600. */
  async function show(tabId: string): Promise<HTMLElement> {
    root = await mountTab(tabId)
    const img = root.querySelector<HTMLImageElement>('[data-image]')
    if (img === null) throw new Error('no picture')
    Object.defineProperty(img, 'naturalWidth', { value: PICTURE.width })
    Object.defineProperty(img, 'naturalHeight', { value: PICTURE.height })
    img.dispatchEvent(new Event('load'))
    await nextTick()
    await nextTick()
    return root
  }

  const scaleOf = (view: HTMLElement): number =>
    Number(view.querySelector('[data-image]')?.getAttribute('data-scale'))

  async function leave(): Promise<void> {
    app?.unmount()
    root?.remove()
    app = undefined
    await nextTick()
  }

  it('fits a tab nobody zoomed, every time it is shown', async () => {
    const tab = openTabFor({ kind: 'image', path: '/a.png', size: 10 })
    const first = await show(tab)
    expect(scaleOf(first)).toBeCloseTo(1 / 3)
    await leave()
    const second = await show(tab)
    expect(scaleOf(second)).toBeCloseTo(1 / 3)
    expect(rememberedView(tab)?.fitted).toBe(true)
  })

  it('keeps the zoom of a tab the owner zoomed, after switching away and back', async () => {
    const tab = openTabFor({ kind: 'image', path: '/a.png', size: 10 })
    const first = await show(tab)
    first
      .querySelector('[data-image-info] button:nth-of-type(2)')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    first
      .querySelector('[data-image-info] button:nth-of-type(2)')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    const zoomed = scaleOf(first)
    expect(zoomed).toBeGreaterThan(1 / 3)
    const x = first.querySelector('[data-image]')?.getAttribute('data-x')
    await leave()
    const back = await show(tab)
    expect(scaleOf(back)).toBeCloseTo(zoomed)
    expect(back.querySelector('[data-image]')?.getAttribute('data-x')).toBe(x)
    expect(rememberedView(tab)?.fitted).toBe(false)
  })

  it('keeps the 100% view too, and gives each tab its own', async () => {
    const one = openTabFor({ kind: 'image', path: '/a.png', size: 10 })
    const two = openTabFor({ kind: 'image', path: '/a.png', size: 10 })
    const first = await show(one)
    first
      .querySelector('[data-image-info] button:nth-of-type(4)')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(scaleOf(first)).toBe(1)
    await leave()
    const other = await show(two)
    expect(scaleOf(other)).toBeCloseTo(1 / 3)
    await leave()
    expect(scaleOf(await show(one))).toBe(1)
  })

  it('does not let a press on the buttons before the picture has loaded replace what it remembers', async () => {
    const tab = openTabFor({ kind: 'image', path: '/a.png', size: 10 })
    rememberView(tab, { scale: 4, cx: 1200, cy: 800, fitted: false })
    const mounted = await mountTab(tab)
    mounted
      .querySelector('[data-image-info] button:nth-of-type(2)')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(rememberedView(tab)).toMatchObject({ scale: 4, cx: 1200, cy: 800 })
  })

  it('forgets a tab that is closed, so a new one starts fitted', () => {
    const tab = openTabFor({ kind: 'image', path: '/a.png', size: 10 })
    rememberView(tab, { scale: 4, cx: 10, cy: 10, fitted: false })
    closeTabById(tab)
    expect(rememberedView(tab)).toBeUndefined()
  })
})
