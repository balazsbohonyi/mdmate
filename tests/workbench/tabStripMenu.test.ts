// @vitest-environment jsdom
/**
 * The tab strip's context menu as drawn (ISC-220, ISC-221): the Rename item of a file outside every
 * open folder is off and carries a tooltip that says why; the shortcuts shown come from the
 * commands, not from the menu.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { openPath, resetDocuments } from '@/documents/store'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { clearCommands } from '@/workbench/commands'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetSidebar } from '@/workbench/sidebar'
import TabStrip from '@/workbench/TabStrip.vue'
import { RENAME_OUTSIDE_FOLDER } from '@/workbench/tabMenu'
import { resetWorkbench } from '@/workbench/store'
import { tabInfo } from '@/workbench/store'

// Radix measures with these; jsdom has neither.
class FakeObserver {
  observe = (): undefined => undefined
  unobserve = (): undefined => undefined
  disconnect = (): undefined => undefined
}
Object.assign(globalThis, { ResizeObserver: FakeObserver })

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

let mounted: { app: App; root: HTMLElement } | undefined
let removeCommands: (() => void) | undefined

beforeEach(() => {
  resetTree()
  resetWorkbench()
  resetDocuments()
  resetSidebar()
  clearCommands()
  removeCommands = registerDefaultCommands()
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  document.body.replaceChildren()
  removeCommands?.()
  clearCommands()
  setHost(undefined)
  resetTree()
})

/** Opens the menu of the tab with this file name, the way a right-click does. */
async function openMenuOf(file: string, files: readonly string[]): Promise<void> {
  const ids: string[] = []
  for (const path of files) ids.push(await openPath(path))
  const infos = ids.map((id) => tabInfo(id)).filter((info) => info !== undefined)
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(TabStrip, { tabs: infos, activeId: ids[0] ?? null })
  app.mount(root)
  mounted = { app, root }
  await flush()
  const tab = [...root.querySelectorAll('[role=tab]')].find((el) => el.textContent.includes(file))
  if (tab === undefined) throw new Error(`no tab for ${file}`)
  tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
  await flush()
}

async function start(): Promise<void> {
  const host = createMockHost({
    files: { '/work/a.md': 'a\n', '/outside/o.md': 'o\n' },
    roots: ['/work'],
  })
  setHost(host)
  await restoreWorkspace([])
  await flush()
}

const renameWrapper = (): HTMLElement | null => document.body.querySelector('[data-rename-item]')
const renameItem = (): Element | null | undefined =>
  renameWrapper()?.querySelector('[role=menuitem]')
const why = (): string | undefined =>
  document.body.querySelector('[data-rename-why]')?.textContent.trim()

/** A mouse over the wrapper of the Rename item, the way a hover reaches it. */
async function hoverRename(): Promise<void> {
  const wrapper = renameWrapper()
  if (wrapper === null) throw new Error('no Rename item')
  wrapper.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
  await flush()
}

describe('Rename in the tab menu of a file outside every open folder (ISC-220)', () => {
  it('is off and says why in a tooltip on hover, not in a native title', async () => {
    await start()
    await openMenuOf('o.md', ['/outside/o.md'])
    expect(renameItem()?.hasAttribute('data-disabled')).toBe(true)
    expect(why()).toBeUndefined()
    await hoverRename()
    expect(why()).toContain(RENAME_OUTSIDE_FOLDER)
    expect(document.body.querySelector('[data-tab-menu] [title]')).toBeNull()
  })

  it('is on, with no tooltip, for a file in an open folder', async () => {
    await start()
    await openMenuOf('a.md', ['/work/a.md'])
    expect(renameItem()?.hasAttribute('data-disabled')).toBe(false)
    await hoverRename()
    expect(why()).toBeUndefined()
  })
})

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const hint = (): string | undefined =>
  document.body.querySelector('[data-hover-hint]')?.textContent.trim()

/** Draws one tab; `cutOff` makes its label wider than the room it has, as a long name is. */
async function drawTab(
  cutOff: boolean,
): Promise<{ tab: HTMLElement; label: HTMLElement; title: string }> {
  await start()
  const id = await openPath('/work/a.md')
  const info = tabInfo(id)
  if (info === undefined) throw new Error('no tab')
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(TabStrip, { tabs: [info], activeId: id })
  app.mount(root)
  mounted = { app, root }
  await flush()
  const tab = root.querySelector<HTMLElement>('[role=tab]')
  const label = root.querySelector<HTMLElement>('[data-tab-label]')
  if (tab === null || label === null) throw new Error('no tab drawn')
  Object.defineProperty(label, 'scrollWidth', { value: cutOff ? 300 : 80 })
  Object.defineProperty(label, 'clientWidth', { value: 80 })
  return { tab, label, title: info.title }
}
async function hover(label: HTMLElement): Promise<void> {
  label.dispatchEvent(new MouseEvent('pointerenter'))
  label.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
  await flush()
}

describe('the tab itself (ISC-222, ISC-224)', () => {
  it('shows its full name in the shadcn tooltip only after 1 s, and has no native title', async () => {
    const { tab, label, title } = await drawTab(true)
    expect(tab.hasAttribute('title')).toBe(false)
    await hover(label)
    await wait(500)
    expect(hint()).toBeUndefined()
    await wait(700)
    expect(hint()).toContain(title)
  }, 10_000)

  it('shows no tooltip when its name fits', async () => {
    const { label } = await drawTab(false)
    await hover(label)
    await wait(1300)
    expect(hint()).toBeUndefined()
  }, 10_000)
})

describe('a right click on a tab (ISC-223)', () => {
  it('opens the menu while the tooltip of that tab is showing, and closes the tooltip', async () => {
    const { tab, label } = await drawTab(true)
    await hover(label)
    await wait(1200)
    expect(hint()).toBeDefined()
    tab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }))
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
    await flush()
    expect(document.body.querySelector('[data-tab-menu]')).not.toBeNull()
    expect(hint()).toBeUndefined()
  }, 10_000)
})

describe('the shortcuts the menu shows (ISC-221)', () => {
  it('come from the commands: F2 for Rename, Shift+F12 for Find File References', async () => {
    await start()
    await openMenuOf('a.md', ['/work/a.md'])
    const shown = [...document.body.querySelectorAll('[role=menuitem]')].map((item) =>
      item.textContent.replace(/\s+/g, ' ').trim(),
    )
    expect(shown).toContain('Rename... F2')
    expect(shown).toContain('Find File References Shift+F12')
  })

  it('also shows Ctrl+W for Close and Ctrl+Shift+W for Close All (ISC-234)', async () => {
    await start()
    await openMenuOf('a.md', ['/work/a.md'])
    const shown = [...document.body.querySelectorAll('[role=menuitem]')].map((item) =>
      item.textContent.replace(/\s+/g, ' ').trim(),
    )
    expect(shown).toContain('Close Ctrl+W')
    expect(shown).toContain('Close All Ctrl+Shift+W')
    // Close Others has no key, so it shows none.
    expect(shown).toContain('Close Others')
  })

  it('names the file-manager item the same on every system (ISC-230)', async () => {
    await start()
    await openMenuOf('a.md', ['/work/a.md'])
    const shown = [...document.body.querySelectorAll('[role=menuitem]')].map((item) =>
      item.textContent.replace(/\s+/g, ' ').trim(),
    )
    expect(shown).toContain('Open Containing Folder')
    expect(shown.some((text) => text.startsWith('Reveal in File'))).toBe(false)
  })
})
