// @vitest-environment jsdom
/**
 * The status bar shows the active file and messages, and nothing about the operating system (UAT:
 * "windows" in the corner was noise). The OS name is still asked for by the tree, which needs it
 * to compare paths, so only the bar's text is pinned here.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { resetDocuments } from '@/documents/store'
import StatusBar from '@/shell/StatusBar.vue'
import { resetWorkbench } from '@/workbench/store'

let mounted: { app: App; root: HTMLElement } | undefined

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  resetDocuments()
  resetWorkbench()
})

describe('the status bar (UAT round 2)', () => {
  it('shows the file line and no operating system name', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(StatusBar)
    app.mount(root)
    mounted = { app, root }
    await nextTick()
    const spans = [...root.querySelectorAll('footer > *')]
    expect(spans).toHaveLength(1)
    expect(root.textContent).toContain('No file open')
    expect(root.textContent?.toLowerCase()).not.toMatch(/windows|macos|linux|browser/)
  })

  it('takes no platform prop', () => {
    expect(Object.keys(StatusBar.props ?? {})).not.toContain('platformName')
  })
})
