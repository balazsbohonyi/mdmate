// @vitest-environment jsdom
/**
 * The title bar names the shown file, left-aligned, in place of the app's name: its path, or the
 * tab's name for a new file (Untitled-N), or "No file open".
 */
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { openPath, resetDocuments } from '@/documents/store'
import { newUntitledTab } from '@/documents/untitled'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { activeFileLabel } from '@/shell/activeFile'
import TitleBar from '@/shell/TitleBar.vue'
import { clearCommands } from '@/workbench/commands'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetWorkbench, settingsTabId, tabRecord } from '@/workbench/store'
import { tooltipApp } from '../helpers/tooltips'

let mounted: { app: App; root: HTMLElement } | undefined

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  resetDocuments()
  resetWorkbench()
  setHost(undefined)
})

async function mountBar(): Promise<HTMLElement> {
  setHost(createMockHost({ files: { '/w/a.md': 'a' } }))
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(TitleBar, { entries: [] })
  app.mount(root)
  mounted = { app, root }
  await nextTick()
  return root
}

const title = (root: HTMLElement): string =>
  root.querySelector('[data-title-file]')?.textContent.trim() ?? ''

describe('the title bar file name', () => {
  it('says "No file open" and not the app name when nothing is open', async () => {
    const root = await mountBar()
    expect(title(root)).toBe('No file open')
    expect(root.textContent).not.toContain('mdmate')
  })

  it('shows the path of the open file, aligned to the left', async () => {
    const root = await mountBar()
    await openPath('/w/a.md')
    await nextTick()
    expect(title(root)).toBe('/w/a.md')
    expect(root.querySelector('[data-tauri-drag-region]')?.className).toContain('justify-start')
    expect(root.querySelector('[data-tauri-drag-region]')?.className).not.toContain(
      'justify-center',
    )
  })

  it('shows the tab name of a new file', async () => {
    const root = await mountBar()
    await newUntitledTab()
    await nextTick()
    expect(title(root)).toBe(activeFileLabel.value)
    expect(title(root)).toMatch(/^Untitled-\d+$/)
  })
})

describe('the Settings gear (ISC-348)', () => {
  it('opens the Settings tab, and a second click shows that one', async () => {
    const removeCommands = registerDefaultCommands()
    try {
      const root = await mountBar()
      const gear = root.querySelector<HTMLButtonElement>('[data-settings-gear]')
      expect(gear?.getAttribute('aria-label')).toBe('Settings')
      expect(settingsTabId()).toBeUndefined()
      gear?.click()
      await nextTick()
      const tab = settingsTabId()
      expect(tab).toBeDefined()
      expect(tabRecord(tab ?? '')).toEqual({ kind: 'settings', category: 'appearance' })
      // The title bar names the open tab, since it holds no file.
      expect(title(root)).toBe('Settings')
      gear?.click()
      await nextTick()
      expect(settingsTabId()).toBe(tab)
    } finally {
      removeCommands()
      clearCommands()
    }
  })
})
