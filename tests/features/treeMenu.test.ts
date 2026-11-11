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
import FileTree from '@/features/tree/FileTree.vue'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
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
      'Open Folder',
    ])
  })

  it('a workspace root gets Copy Path and Open Folder only, with no relative path to give', async () => {
    const labels = await menuOf('/work')
    expect(labels).toEqual([
      'New File',
      'New Folder',
      'Copy Path',
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
