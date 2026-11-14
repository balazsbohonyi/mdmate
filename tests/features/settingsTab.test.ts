// @vitest-environment jsdom
/**
 * The Settings tab as the user sees it (P8-T1c): drawn by the real pane, lazily, with the five
 * groups, the open one marked, and a click on another one remembered by the tab. The rows of each
 * group are P8-T1d's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resetDocuments } from '@/documents/store'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { openSettingsTab, resetWorkbench, settingsCategoryOf, tabRecord } from '@/workbench/store'
import WorkbenchView from '@/workbench/WorkbenchView.vue'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 8; round++) {
    await settle()
    await nextTick()
  }
}

let mounted: { app: App; root: HTMLElement } | undefined

beforeEach(() => {
  setHost(createMockHost({ files: {} }))
  resetWorkbench()
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  resetDocuments()
  resetWorkbench()
  setHost(undefined)
})

async function mount(): Promise<void> {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h(TooltipProvider, { delayDuration: 0 }, () => h(WorkbenchView)),
  })
  app.mount(root)
  mounted = { app, root }
  await flush()
}

const groups = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-settings-category]'),
]
const heading = (): string =>
  document.querySelector('[data-settings-heading]')?.textContent.trim() ?? ''

describe('the Settings screen in its tab', () => {
  it('is not in the page until the tab is shown, then lists the five groups', async () => {
    await mount()
    expect(document.querySelector('[data-settings-view]')).toBeNull()
    openSettingsTab()
    // The first time the screen is wanted its code is fetched, so wait for it.
    await vi.waitFor(() => {
      expect(document.querySelector('[data-settings-view]')).not.toBeNull()
    })
    expect(groups().map((group) => group.textContent.trim())).toEqual([
      'Appearance',
      'Editor',
      'Files & Workspace',
      'Keyboard',
      'Advanced',
    ])
  })

  it('marks the group the tab is on, and shows its name', async () => {
    await mount()
    openSettingsTab('editor')
    await flush()
    expect(groups().map((group) => group.getAttribute('aria-current'))).toEqual([
      null,
      'page',
      null,
      null,
      null,
    ])
    expect(heading()).toBe('Editor')
  })

  it('remembers the group a click chose in the tab, and shows it', async () => {
    await mount()
    const tab = openSettingsTab()
    await flush()
    expect(heading()).toBe('Appearance')
    groups()
      .find((group) => group.dataset.settingsCategory === 'advanced')
      ?.click()
    await flush()
    expect(settingsCategoryOf(tab)).toBe('advanced')
    expect(tabRecord(tab)).toEqual({ kind: 'settings', category: 'advanced' })
    expect(heading()).toBe('Advanced')
    expect(document.querySelector('[data-settings-category="advanced"]')?.ariaCurrent).toBe('page')
  })

  it('names its tab Settings in the strip', async () => {
    await mount()
    openSettingsTab()
    await flush()
    expect(document.querySelector('[data-tab-label]')?.textContent.trim()).toBe('Settings')
  })
})
