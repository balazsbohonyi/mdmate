// @vitest-environment jsdom
/**
 * The sidebar's context menu (ISC-229, ISC-230): which items a file, a folder and a workspace root
 * get, what they copy, and how "Open Containing Folder" differs from "Open Folder".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { problem, resetDocuments } from '@/documents/store'
import { referencesState, resetReferences } from '@/features/references/store'
import { resetSearch, searchOptions, filtersOpen } from '@/features/search/store'
import FileTree from '@/features/tree/FileTree.vue'
import { resetTree, restoreWorkspace, select } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetSidebar, sidebarPanel } from '@/workbench/sidebar'
import { resetWorkbench } from '@/workbench/store'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await settle()
    await nextTick()
  }
}

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined
let removeCommands: (() => void) | undefined

beforeEach(async () => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  resetReferences()
  resetSearch()
  resetSidebar()
  problem.value = null
  removeCommands = registerDefaultCommands()
  host = createMockHost({
    files: { '/work/notes/a.md': '# a\n', '/work/readme.md': '# readme\n' },
    roots: ['/work'],
  })
  setHost(host)
  await restoreWorkspace(['/work/notes'])
  await flush()
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(FileTree)
  app.mount(root)
  mounted = { app, root }
  await flush()
})

afterEach(() => {
  removeCommands?.()
  removeCommands = undefined
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  document.body.replaceChildren()
  setHost(undefined)
  resetTree()
})

/** Right-clicks the row and returns the labels of the menu items, in order. */
async function menuOf(path: string): Promise<string[]> {
  const row = document.body.querySelector<HTMLElement>(`[data-row-path="${path}"]`)
  if (row === null) throw new Error(`no row for ${path}`)
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
  await flush()
  return items().map((item) => label(item))
}

const items = (): HTMLElement[] => [
  ...document.body.querySelectorAll<HTMLElement>('[role=menuitem]'),
]
const label = (item: HTMLElement): string => item.textContent.replace(/\s+/g, ' ').trim()
function choose(name: string): void {
  const item = items().find((candidate) => label(candidate).startsWith(name))
  if (item === undefined) throw new Error(`no item ${name}`)
  item.click()
}

import { setSearchOptions } from '@/features/search/store'
const setSearchQuery = (query: string): void => {
  setSearchOptions({ query })
}

describe('the items of the sidebar menu', () => {
  it('a file gets Copy Path, Copy Relative Path, Open Containing Folder and Find File References', async () => {
    const labels = await menuOf('/work/notes/a.md')
    expect(labels).toEqual([
      'Rename... F2',
      'Delete Delete',
      'Copy Path',
      'Copy Relative Path',
      'Open Containing Folder',
      expect.stringMatching(/^Find File References/),
    ])
  })

  it('a folder gets the two copy items and Open Folder, and no reference search', async () => {
    const labels = await menuOf('/work/notes')
    expect(labels).toEqual([
      'New File',
      'New Folder',
      'Rename... F2',
      'Delete Delete',
      'Copy Path',
      'Copy Relative Path',
      expect.stringMatching(/^Find in Folder\.\.\./),
      'Open Folder',
    ])
  })

  it('a workspace root gets Copy Path and Open Folder only, with no relative path to give', async () => {
    const labels = await menuOf('/work')
    expect(labels).toEqual([
      'New File',
      'New Folder',
      'Copy Path',
      expect.stringMatching(/^Find in Folder\.\.\./),
      'Open Folder',
      'Remove Folder from Workspace',
    ])
  })

  it('shows the reference search with its shortcut', async () => {
    await menuOf('/work/notes/a.md')
    const found = items().find((item) => label(item).startsWith('Find File References'))
    expect(found?.querySelector('[data-slot=context-menu-shortcut]')?.textContent).toBe('Shift+F12')
  })
})

describe('Find in Folder (ISC-300)', () => {
  it('shows Alt+Shift+F beside the item on a folder and a root, and not on a file', async () => {
    for (const path of ['/work/notes', '/work']) {
      await menuOf(path)
      const found = items().find((item) => label(item).startsWith('Find in Folder...'))
      expect(found?.querySelector('[data-slot=context-menu-shortcut]')?.textContent).toBe(
        'Alt+Shift+F',
      )
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flush()
    }
    const labels = await menuOf('/work/notes/a.md')
    expect(labels.some((item) => item.startsWith('Find in Folder'))).toBe(false)
  })

  it('the item shows the Search panel with the folder in "files to include" and nothing else changed', async () => {
    setSearchQuery('needle')
    await menuOf('/work/notes')
    choose('Find in Folder...')
    await flush()
    expect(sidebarPanel.value).toBe('search')
    expect(searchOptions.value.include).toBe('./notes')
    expect(searchOptions.value.query).toBe('needle')
    expect(searchOptions.value.exclude).toBe('')
    expect(filtersOpen.value).toBe(true)
  })

  it('on the one root it fills nothing, since the root is already the whole search', async () => {
    await menuOf('/work')
    choose('Find in Folder...')
    await flush()
    expect(sidebarPanel.value).toBe('search')
    expect(searchOptions.value.include).toBe('')
  })

  it('Alt+Shift+F with the tree focused does the same for the selected folder, and nothing for a file', async () => {
    const tree = document.body.querySelector<HTMLElement>('[role=tree]') ?? document.body
    const press = async (): Promise<KeyboardEvent> => {
      const event = new KeyboardEvent('keydown', {
        key: 'F',
        code: 'KeyF',
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      tree.dispatchEvent(event)
      await flush()
      return event
    }
    select('/work/notes/a.md', '/work')
    await flush()
    expect((await press()).defaultPrevented).toBe(false)
    expect(searchOptions.value.include).toBe('')
    select('/work/notes', '/work')
    await flush()
    expect((await press()).defaultPrevented).toBe(true)
    expect(sidebarPanel.value).toBe('search')
    expect(searchOptions.value.include).toBe('./notes')
  })
})

describe('the keys the items show (ISC-234)', () => {
  it('Rename shows F2 and Delete shows the Delete key, on a file and on a folder', async () => {
    for (const path of ['/work/notes/a.md', '/work/notes']) {
      const labels = await menuOf(path)
      expect(labels).toContain('Rename... F2')
      expect(labels).toContain('Delete Delete')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flush()
    }
  })

  it('a workspace folder shows neither, since it has neither item', async () => {
    const labels = await menuOf('/work')
    expect(labels.some((label) => label.startsWith('Rename'))).toBe(false)
    expect(labels.some((label) => label.startsWith('Delete'))).toBe(false)
  })

  it('shows the same name and key for Rename and Find File References as the tab menu', async () => {
    const labels = await menuOf('/work/notes/a.md')
    expect(labels).toContain('Rename... F2')
    expect(labels).toContain('Find File References Shift+F12')
  })
})

describe('what the items do', () => {
  it('Copy Path puts the full path on the clipboard, Copy Relative Path the one from its folder', async () => {
    await menuOf('/work/notes/a.md')
    choose('Copy Path')
    await flush()
    await menuOf('/work/notes/a.md')
    choose('Copy Relative Path')
    await flush()
    await menuOf('/work/notes')
    choose('Copy Relative Path')
    await flush()
    expect(host.clipboard).toEqual(['/work/notes/a.md', 'notes/a.md', 'notes'])
  })

  it('Open Containing Folder shows the file, and Open Folder opens the folder itself', async () => {
    await menuOf('/work/notes/a.md')
    choose('Open Containing Folder')
    await flush()
    expect(host.revealed).toEqual(['/work/notes/a.md'])
    expect(host.openedFolders).toEqual([])

    await menuOf('/work/notes')
    choose('Open Folder')
    await flush()
    await menuOf('/work')
    choose('Open Folder')
    await flush()
    expect(host.openedFolders).toEqual(['/work/notes', '/work'])
    expect(host.revealed).toEqual(['/work/notes/a.md'])
  })

  it('Find File References searches for the file and shows the references panel', async () => {
    await menuOf('/work/notes/a.md')
    choose('Find File References')
    await flush()
    expect(referencesState.value?.target).toBe('/work/notes/a.md')
  })

  it('says so when the folder cannot be opened', async () => {
    await menuOf('/work/notes')
    host.files.remove('/work/notes/a.md')
    host.files.remove('/work/notes')
    choose('Open Folder')
    await flush()
    expect(problem.value).toContain('Could not open notes')
  })
})
