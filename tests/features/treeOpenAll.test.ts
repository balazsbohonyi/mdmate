// @vitest-environment jsdom
/**
 * Open All (ISC-706 to ISC-708): with two or more files selected, the sidebar menu and Enter open
 * them in the active pane, in the order the tree shows them, the first one ending as the active tab.
 * The real tree, the real stores and the browser stand-in for the host.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { toasts } from '../helpers/toasts'
import { allDocuments, resetDocuments } from '@/documents/store'
import FileTree from '@/features/tree/FileTree.vue'
import { resetTree, restoreWorkspace, setSelection, toggleFolder } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetSidebar } from '@/workbench/sidebar'
import { findPane } from '@/workbench/splitTree'
import { resetWorkbench, tabRecord, workbenchLayout } from '@/workbench/store'

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
  resetSidebar()
  removeCommands = registerDefaultCommands()
  host = createMockHost({
    files: {
      '/work/notes/a.md': '# a\n',
      '/work/notes/b.md': '# b\n',
      '/work/notes/c.md': '# c\n',
      '/work/readme.md': '# readme\n',
      '/other/x.md': '# x\n',
    },
    roots: ['/work', '/other'],
  })
  setHost(host)
  await restoreWorkspace(['/work', '/other'])
  await toggleFolder('/work/notes', '/work')
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

const place = (path: string, root = '/work'): { root: string; path: string } => ({ root, path })

const rowEl = (path: string, root = '/work'): HTMLElement => {
  const found = document.body.querySelector<HTMLElement>(
    `[data-row-path="${path}"][data-row-root="${root}"]`,
  )
  if (found === null) throw new Error(`no row ${path}`)
  return found
}

/** Right-clicks the row and returns the labels of the menu items. */
async function menuOn(path: string, root = '/work'): Promise<string[]> {
  rowEl(path, root).dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
  )
  await flush()
  return items().map((item) => label(item))
}
const hasOpenAll = (labels: string[]): boolean => labels.some((text) => text.startsWith('Open All'))
const items = (): HTMLElement[] => [
  ...document.body.querySelectorAll<HTMLElement>('[role=menuitem]'),
]
const label = (item: HTMLElement): string => item.textContent.replace(/\s+/g, ' ').trim()
async function choose(name: string): Promise<void> {
  const item = items().find((candidate) => label(candidate).startsWith(name))
  if (item === undefined) throw new Error(`no item ${name}`)
  item.click()
  await flush()
}

/** The files the tabs of the active pane show, left to right, and which one is active. */
function paneFiles(): { files: string[]; active: string | undefined } {
  const layout = workbenchLayout.value
  const pane = findPane(layout, layout.activePane)
  const pathOf = (id: string): string => {
    const record = tabRecord(id)
    if (record === undefined) return '?'
    if (record.kind === 'image') return record.path
    if (record.kind === 'settings' || record.kind === 'themePreview') return record.kind
    return allDocuments().find((doc) => doc.id === record.docId)?.path ?? '?'
  }
  const tabs = pane?.tabs ?? []
  const active = pane?.activeTab == null ? undefined : pathOf(pane.activeTab)
  return { files: tabs.map(pathOf), active }
}

function pressEnter(): void {
  const scroller = document.body.querySelector<HTMLElement>('[role=tree]')
  if (scroller === null) throw new Error('no tree')
  scroller.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
}

describe('the Open All item (ISC-706)', () => {
  it('shows for two files, and for files with a folder among them', async () => {
    setSelection([place('/work/notes/a.md'), place('/work/notes/b.md')])
    expect(hasOpenAll(await menuOn('/work/notes/b.md'))).toBe(true)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    setSelection([place('/work/notes'), place('/work/notes/a.md'), place('/work/readme.md')])
    expect(hasOpenAll(await menuOn('/work/readme.md'))).toBe(true)
  })

  it('is not there for one file, for a file and a folder, or for folders only', async () => {
    setSelection([place('/work/notes/a.md')])
    expect(hasOpenAll(await menuOn('/work/notes/a.md'))).toBe(false)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    setSelection([place('/work/notes'), place('/work/readme.md')])
    expect(hasOpenAll(await menuOn('/work/readme.md'))).toBe(false)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    setSelection([place('/work/notes'), place('/other', '/other')])
    expect(hasOpenAll(await menuOn('/work/notes'))).toBe(false)
  })

  it('keeps Delete for the whole selection in the same menu', async () => {
    setSelection([place('/work/notes/a.md'), place('/work/notes/b.md')])
    const labels = await menuOn('/work/notes/a.md')
    expect(labels.some((text) => text.startsWith('Delete 2 items'))).toBe(true)
  })
})

describe('what Open All opens (ISC-707)', () => {
  it('opens the files in tree order whatever order they were picked, the first one active', async () => {
    setSelection([place('/work/readme.md'), place('/work/notes/b.md'), place('/work/notes/a.md')])
    await menuOn('/work/notes/a.md')
    await choose('Open All')
    expect(paneFiles()).toEqual({
      files: ['/work/notes/a.md', '/work/notes/b.md', '/work/readme.md'],
      active: '/work/notes/a.md',
    })
  })

  it('leaves the folders alone: they are neither opened nor expanded or collapsed', async () => {
    setSelection([place('/work/notes'), place('/work/notes/c.md'), place('/work/readme.md')])
    await menuOn('/work/readme.md')
    await choose('Open All')
    expect(paneFiles().files).toEqual(['/work/notes/c.md', '/work/readme.md'])
    expect(document.body.querySelector('[data-row-path="/work/notes/a.md"]')).not.toBeNull()
  })

  it('opens a file once when it is selected under two roots, and takes files of two roots', async () => {
    setSelection([place('/work/readme.md'), place('/other/x.md', '/other')])
    await menuOn('/other/x.md', '/other')
    await choose('Open All')
    expect(paneFiles().files).toEqual(['/work/readme.md', '/other/x.md'])
  })

  it('gives no second tab to a file that is already open, and still ends on the first file', async () => {
    rowEl('/work/notes/b.md').click()
    await flush()
    setSelection([place('/work/notes/a.md'), place('/work/notes/b.md'), place('/work/notes/c.md')])
    await menuOn('/work/notes/c.md')
    await choose('Open All')
    const { files, active } = paneFiles()
    expect(files.filter((file) => file === '/work/notes/b.md')).toHaveLength(1)
    expect([...files].sort()).toEqual(['/work/notes/a.md', '/work/notes/b.md', '/work/notes/c.md'])
    expect(active).toBe('/work/notes/a.md')
  })

  it('reports a file that fails and still opens the others', async () => {
    setSelection([place('/work/notes/a.md'), place('/work/notes/b.md'), place('/work/notes/c.md')])
    await menuOn('/work/notes/a.md')
    host.files.remove('/work/notes/b.md')
    await choose('Open All')
    expect(paneFiles().files).toEqual(['/work/notes/a.md', '/work/notes/c.md'])
    expect(toasts.messages.some((message) => message.includes('/work/notes/b.md'))).toBe(true)
    expect(paneFiles().active).toBe('/work/notes/a.md')
  })
})

describe('Enter on a selection of files (ISC-708)', () => {
  it('does what Open All does for two or more files', async () => {
    setSelection([place('/work/notes/b.md'), place('/work/notes/a.md')])
    pressEnter()
    await flush()
    expect(paneFiles()).toEqual({
      files: ['/work/notes/a.md', '/work/notes/b.md'],
      active: '/work/notes/a.md',
    })
  })

  it('opens just the one file for one row, as before', async () => {
    setSelection([place('/work/notes/c.md')])
    pressEnter()
    await flush()
    expect(paneFiles()).toEqual({ files: ['/work/notes/c.md'], active: '/work/notes/c.md' })
  })
})
