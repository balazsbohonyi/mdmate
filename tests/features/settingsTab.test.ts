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

  it('sets --accent-foreground wherever it fills a category with --accent (ISC-532)', async () => {
    await mount()
    openSettingsTab('editor')
    await flush()
    const current = groups().find((group) => group.dataset.settingsCategory === 'editor')
    const others = groups().filter((group) => group.dataset.settingsCategory !== 'editor')
    if (current === undefined) throw new Error('no current category')
    expect(current.classList.contains('bg-accent')).toBe(true)
    expect(current.classList.contains('text-accent-foreground')).toBe(true)
    expect(current.classList.contains('text-foreground')).toBe(false)
    for (const group of others) {
      expect(group.classList.contains('text-muted-foreground')).toBe(true)
      expect(group.classList.contains('bg-accent')).toBe(false)
    }
    // Hover and keyboard focus fill the button too, so they set the text as well.
    for (const group of groups()) {
      expect(group.classList.contains('hover:bg-accent')).toBe(true)
      expect(group.classList.contains('hover:text-accent-foreground')).toBe(true)
      expect(group.classList.contains('focus-visible:bg-accent')).toBe(true)
      expect(group.classList.contains('focus-visible:text-accent-foreground')).toBe(true)
    }
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
