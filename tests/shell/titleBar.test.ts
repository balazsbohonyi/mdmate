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
import { clearCommands, setKeybindingOverrides } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetSidebar, sidebarVisible, toggleSidebar } from '@/workbench/sidebar'
import { resetWorkbench, settingsTabId, tabRecord } from '@/workbench/store'
import { tooltipApp } from '../helpers/tooltips'

let mounted: { app: App; root: HTMLElement } | undefined

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  resetDocuments()
  resetWorkbench()
  resetSidebar()
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

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

/** What a mouse over an element does to its tooltip trigger. */
async function hover(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('nothing to hover')
  element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
  await flush()
}

/** The tooltip's visible text: Radix adds a hidden copy for screen readers (`role=tooltip`), left out here. */
function hint(): string | undefined {
  const box = document.body.querySelector('[data-hover-hint]')
  if (!box) return undefined
  const hidden = box.querySelector('[role="tooltip"]')?.textContent ?? ''
  return box.textContent.slice(0, box.textContent.length - hidden.length).trim()
}

describe('the sidebar button (ISC-562)', () => {
  it('sits right after the menu button and before the file name', async () => {
    const root = await mountBar()
    const buttons = [...root.querySelectorAll('button')]
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Menu')
    expect(buttons[1]?.hasAttribute('data-sidebar-toggle')).toBe(true)
    expect(buttons[1]?.getAttribute('aria-label')).toBe('Toggle Sidebar')
    expect(buttons[1]?.compareDocumentPosition(root.querySelector('[data-title-file]')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('toggles the sidebar on a click, and its pressed state and icon follow', async () => {
    const removeCommands = registerDefaultCommands()
    try {
      const root = await mountBar()
      const button = root.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')
      expect(sidebarVisible.value).toBe(true)
      expect(button?.getAttribute('aria-pressed')).toBe('true')
      const openIcon = button?.innerHTML
      button?.click()
      await flush()
      expect(sidebarVisible.value).toBe(false)
      expect(button?.getAttribute('aria-pressed')).toBe('false')
      expect(button?.innerHTML).not.toBe(openIcon)
      button?.click()
      await flush()
      expect(sidebarVisible.value).toBe(true)
      expect(button?.innerHTML).toBe(openIcon)
    } finally {
      removeCommands()
      clearCommands()
    }
  })

  it('names the action and the current shortcut in the shadcn tooltip, never a title', async () => {
    const removeCommands = registerDefaultCommands()
    try {
      const root = await mountBar()
      const button = root.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')
      expect(button?.hasAttribute('title')).toBe(false)
      await hover(button)
      expect(hint()).toBe('Hide Sidebar (Ctrl+Shift+B)')
      toggleSidebar()
      await flush()
      expect(hint()).toBe('Show Sidebar (Ctrl+Shift+B)')
    } finally {
      removeCommands()
      clearCommands()
    }
  })

  it('follows a rebound shortcut, and shows the action alone when none is set', async () => {
    const removeCommands = registerDefaultCommands()
    try {
      const root = await mountBar()
      const button = root.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')
      setKeybindingOverrides({ [COMMAND_IDS.toggleSidebar]: 'Mod+Alt+B' })
      await hover(button)
      expect(hint()).toBe('Hide Sidebar (Ctrl+Alt+B)')
      setKeybindingOverrides({ [COMMAND_IDS.toggleSidebar]: null })
      await flush()
      expect(hint()).toBe('Hide Sidebar')
    } finally {
      setKeybindingOverrides({})
      removeCommands()
      clearCommands()
    }
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
