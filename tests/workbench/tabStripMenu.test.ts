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

describe('the tab itself (ISC-222)', () => {
  it('shows its file name in the shadcn tooltip on hover, and has no native title', async () => {
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
    const tab = root.querySelector('[role=tab]')
    expect(tab?.hasAttribute('title')).toBe(false)
    tab?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    await flush()
    expect(document.body.querySelector('[data-hover-hint]')?.textContent.trim()).toContain(
      info.title,
    )
  })
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
})
