// @vitest-environment jsdom
/**
 * ISC-289: the status bar shows an Indexing label and a thin percent bar only while a folder is
 * being indexed or reconciled, and names a folder the index had to cut. The percent itself is
 * Rust's (`walk_share` in `workspace/index/reconcile.rs` pins the rule for a first index and for a
 * reconcile); here the page shows what it is told.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { resetDocuments } from '@/documents/store'
import { indexStatus, resetIndexStatus, watchIndexStatus } from '@/features/index/status'
import { setHost } from '@/platform'
import { IDLE_INDEX, parseIndexStatus } from '@/platform/indexStatus'
import { createMockHost } from '@/platform/mock'
import StatusBar from '@/shell/StatusBar.vue'
import { findCounts } from '@/workbench/find'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'

let mounted: { app: App; root: HTMLElement } | undefined

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  resetIndexStatus()
  setHost(undefined)
  resetDocuments()
  resetWorkbench()
  findCounts.clear()
})

async function mountBar(): Promise<HTMLElement> {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(StatusBar)
  app.mount(root)
  mounted = { app, root }
  await nextTick()
  return root
}

const bar = (root: HTMLElement): HTMLElement | null => root.querySelector('[role="progressbar"]')

describe('the indexing label and percent bar', () => {
  it('shows nothing while no folder is being indexed', async () => {
    const root = await mountBar()
    expect(root.querySelector('[data-index-status]')).toBeNull()
    expect(root.textContent).not.toContain('Indexing')
  })

  it('shows the label and a bar at the percent Rust sent, and only while indexing', async () => {
    const root = await mountBar()
    indexStatus.value = { indexing: true, percent: 37, cut: [] }
    await nextTick()
    expect(root.textContent).toContain('Indexing')
    expect(bar(root)?.getAttribute('aria-valuenow')).toBe('37')
    expect(root.querySelector<HTMLElement>('[data-index-bar]')?.style.width).toBe('37%')

    indexStatus.value = { indexing: true, percent: 80, cut: [] }
    await nextTick()
    expect(bar(root)?.getAttribute('aria-valuenow')).toBe('80')

    indexStatus.value = { indexing: false, percent: 0, cut: [] }
    await nextTick()
    expect(root.querySelector('[data-index-status]')).toBeNull()
    expect(bar(root)).toBeNull()
  })

  it('names the folder that was cut at the file limit, until a find count takes the text', async () => {
    const root = await mountBar()
    indexStatus.value = { indexing: false, percent: 0, cut: ['notes', 'big'] }
    await nextTick()
    expect(root.textContent).toContain('notes, big')
    expect(root.textContent).toContain('1,000,000')

    findCounts.set(workbenchLayout.value.activePane, '3 of 12')
    await nextTick()
    expect(root.textContent).toContain('3 of 12')
    expect(root.textContent).not.toContain('notes, big')
  })

  it('keeps the one-text layout when idle, so nothing else sits in the bar', async () => {
    const root = await mountBar()
    expect([...root.querySelectorAll('footer > *')]).toHaveLength(1)
  })
})

describe('listening to Rust', () => {
  it('shows what the host reports from the first status on', async () => {
    const host = createMockHost()
    setHost(host)
    host.setIndexStatus({ indexing: true, percent: 12, cut: [] })
    await watchIndexStatus()
    expect(indexStatus.value).toEqual({ indexing: true, percent: 12, cut: [] })

    host.setIndexStatus({ indexing: false, percent: 0, cut: [] })
    expect(indexStatus.value).toEqual(IDLE_INDEX)
  })

  it('subscribes once however often it is asked', async () => {
    const host = createMockHost()
    setHost(host)
    let heard = 0
    const original = host.watchIndex.bind(host)
    host.watchIndex = (onStatus) => {
      heard += 1
      return original(onStatus)
    }
    await watchIndexStatus()
    await watchIndexStatus()
    expect(heard).toBe(1)
  })
})

describe('parseIndexStatus', () => {
  it('reads what Rust sends', () => {
    expect(parseIndexStatus({ indexing: true, percent: 50, cut: ['a'] })).toEqual({
      indexing: true,
      percent: 50,
      cut: ['a'],
    })
    expect(parseIndexStatus({ indexing: false, percent: 0 })).toEqual(IDLE_INDEX)
  })

  it('rejects anything else', () => {
    for (const bad of [
      null,
      'idle',
      {},
      { indexing: 'yes', percent: 1, cut: [] },
      { indexing: true, percent: 1.5, cut: [] },
      { indexing: true, percent: -1, cut: [] },
      { indexing: true, percent: 101, cut: [] },
      { indexing: true, percent: 1, cut: [3] },
    ]) {
      expect(() => parseIndexStatus(bad), JSON.stringify(bad)).toThrow()
    }
  })
})
