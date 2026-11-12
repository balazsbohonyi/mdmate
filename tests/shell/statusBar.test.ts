// @vitest-environment jsdom
/**
 * The status bar shows the active file and messages, and nothing about the operating system (UAT:
 * "windows" in the corner was noise). The OS name is still asked for by the tree, which needs it
 * to compare paths, so only the bar's text is pinned here.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { problem, resetDocuments } from '@/documents/store'
import StatusBar from '@/shell/StatusBar.vue'
import { findCounts } from '@/workbench/find'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'

let mounted: { app: App; root: HTMLElement } | undefined

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  resetDocuments()
  resetWorkbench()
  problem.value = null
  findCounts.clear()
})

describe('the status bar (UAT round 2)', () => {
  async function mountBar(): Promise<HTMLElement> {
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(StatusBar)
    app.mount(root)
    mounted = { app, root }
    await nextTick()
    return root
  }

  it('holds one text and no operating system name', async () => {
    const root = await mountBar()
    expect([...root.querySelectorAll('footer > *')]).toHaveLength(1)
    expect(root.textContent?.toLowerCase()).not.toMatch(/windows|macos|linux|browser/)
  })

  it('no longer names the file: the title bar does, and the status bar is empty with no message', async () => {
    const root = await mountBar()
    expect(root.textContent.trim()).toBe('')
  })

  it('shows the match count of the focused pane, and a message instead when there is one', async () => {
    const root = await mountBar()
    const pane = workbenchLayout.value.activePane
    findCounts.set(pane, '3 of 12')
    findCounts.set('another-pane', '9 results')
    await nextTick()
    expect(root.textContent.trim()).toBe('3 of 12')
    problem.value = 'Could not open x.md'
    await nextTick()
    expect(root.textContent.trim()).toBe('Could not open x.md')
    problem.value = null
    findCounts.clear()
    await nextTick()
    expect(root.textContent.trim()).toBe('')
  })

  it('takes no platform prop', () => {
    const props = (StatusBar as { props?: Record<string, unknown> }).props ?? {}
    expect(Object.keys(props)).not.toContain('platformName')
  })
})
