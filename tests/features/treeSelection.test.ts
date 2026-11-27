// @vitest-environment jsdom
/**
 * P9.1-T9: several rows selected in the sidebar tree. The rules of a selection (a range, folding a
 * folder's rows into the folder) are pure and tested on the model; the selection itself on the store;
 * the clicks, keys, menu and drag on the drawn tree; the delete question and the batch move on the
 * mock host, which does what Rust does.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { toasts } from '../helpers/toasts'
import { followerOfTab, openPath, resetDocuments } from '@/documents/store'
import { rewriteState, answerRewrite, type RewriteState } from '@/features/links/rewrite'
import DeleteDialog from '@/features/tree/DeleteDialog.vue'
import FileTree from '@/features/tree/FileTree.vue'
import {
  outermost,
  pathKeyer,
  rangeBetween,
  samePlace,
  type Place,
  type TreeRow,
} from '@/features/tree/model'
import {
  cancelDelete,
  confirmDelete,
  deletePrompt,
  deleteSelected,
  moveRows,
  renameSelected,
  selectedTargets,
} from '@/features/tree/ops'
import {
  collapseSelection,
  isSelectedPlace,
  resetTree,
  restoreWorkspace,
  select,
  selectedPath,
  selectedPlaces,
  selectRangeTo,
  toggleFolder,
  toggleSelected,
  treeRows,
  forgetPath,
  remapPaths,
} from '@/features/tree/store'
import { resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'
import { watch as watchRef } from 'vue'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

const keyOf = pathKeyer(true)
const place = (path: string, root = '/work'): Place => ({ root, path })

// ---- the pure rules ----

describe('the rules of a selection (P9.1-T9)', () => {
  const rows: TreeRow[] = [
    { kind: 'root', root: '/w', path: '/w', name: 'w', depth: 0, expanded: true },
    { kind: 'folder', root: '/w', path: '/w/a', name: 'a', depth: 1, expanded: true },
    { kind: 'file', root: '/w', path: '/w/a/1.md', name: '1.md', depth: 2 },
    { kind: 'note', root: '/w', path: '/w/a', name: 'Loading…', depth: 2, tone: 'muted' },
    { kind: 'file', root: '/w', path: '/w/a/2.md', name: '2.md', depth: 2 },
    { kind: 'file', root: '/w', path: '/w/z.md', name: 'z.md', depth: 1 },
  ]

  it('takes the rows between two places in the order on screen, whichever end comes first', () => {
    const down = rangeBetween(rows, place('/w/a', '/w'), place('/w/a/2.md', '/w'), keyOf)
    expect(down.map((one) => one.path)).toEqual(['/w/a', '/w/a/1.md', '/w/a/2.md'])
    const up = rangeBetween(rows, place('/w/z.md', '/w'), place('/w/a/1.md', '/w'), keyOf)
    expect(up.map((one) => one.path)).toEqual(['/w/a/1.md', '/w/a/2.md', '/w/z.md'])
  })

  it('leaves a note out of a range, and gives the one place when an end is not on screen', () => {
    const range = rangeBetween(rows, place('/w/a/1.md', '/w'), place('/w/a/2.md', '/w'), keyOf)
    expect(range.map((one) => one.path)).toEqual(['/w/a/1.md', '/w/a/2.md'])
    expect(rangeBetween(rows, place('/w/gone.md', '/w'), place('/w/z.md', '/w'), keyOf)).toEqual([
      { root: '/w', path: '/w/z.md' },
    ])
  })

  it('tells a row under another root from the same path under this one', () => {
    expect(samePlace(place('/a/x', '/a'), place('/a/x', '/a'), keyOf)).toBe(true)
    expect(samePlace(place('/a/x', '/a'), place('/a/x', '/a/x'), keyOf)).toBe(false)
    expect(samePlace(place('/A/X', '/A'), place('/a/x', '/a'), keyOf)).toBe(true)
  })

  it('lets a selected folder swallow the selected rows inside it, and keeps each path once', () => {
    const picked = [
      place('/w/a/1.md'),
      place('/w/a'),
      place('/w/z.md'),
      place('/w/z.md', '/other'),
      place('/w/ab.md'),
    ]
    // `/w/ab.md` only starts like `/w/a`: it is not inside it.
    expect(outermost(picked, keyOf).map((one) => one.path)).toEqual(['/w/a', '/w/z.md', '/w/ab.md'])
  })
})

// ---- the selection in the store ----

const FILES: Record<string, string> = {
  '/work/a.md': '# a\n',
  '/work/b.md': '# b\n',
  '/work/c.md': '# c\n',
  '/work/d.txt': 'd',
  '/work/dest/x.md': '# x\n',
  '/work/notes/n.md': '# n\n',
  '/work/notes/deep/m.md': '# m\n',
}
/** The rows of FILES with `notes` open, top to bottom. */
const ORDER = [
  '/work',
  '/work/dest',
  '/work/notes',
  '/work/notes/deep',
  '/work/notes/n.md',
  '/work/a.md',
  '/work/b.md',
  '/work/c.md',
  '/work/d.txt',
]

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined

async function start(files: Record<string, string> = FILES, open = true): Promise<void> {
  host = createMockHost({ files, roots: ['/work'] })
  setHost(host)
  await restoreWorkspace([])
  if (open) await toggleFolder('/work/notes')
  await flush()
}

function mount(component: Parameters<typeof tooltipApp>[0]): HTMLElement {
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(component)
  app.mount(root)
  mounted = { app, root }
  return root
}

beforeEach(() => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  resetSettings()
  rewriteState.value = null
})

afterEach(() => {
  cancelDelete()
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  setHost(undefined)
  resetTree()
  resetSettings()
  document.body.replaceChildren()
})

const paths = (): string[] => selectedPlaces.value.map((one) => one.path)

describe('the selection (P9.1-T9)', () => {
  it('is one row after a plain select, with that row as the lead', async () => {
    await start()
    select('/work/a.md', '/work')
    expect(paths()).toEqual(['/work/a.md'])
    expect(isSelectedPlace('/work', '/work/a.md')).toBe(true)
    expect(isSelectedPlace('/work', '/work/b.md')).toBe(false)
  })

  it('adds a row and takes it out again with toggle, the last added being the lead', async () => {
    await start()
    select('/work/a.md', '/work')
    toggleSelected('/work/c.md', '/work')
    toggleSelected('/work/d.txt', '/work')
    expect(paths()).toEqual(['/work/a.md', '/work/c.md', '/work/d.txt'])
    expect(selectedPath.value).toBe('/work/d.txt')
    toggleSelected('/work/c.md', '/work')
    expect(paths()).toEqual(['/work/a.md', '/work/d.txt'])
    toggleSelected('/work/d.txt', '/work')
    expect(paths()).toEqual(['/work/a.md'])
    expect(selectedPath.value).toBe('/work/a.md')
    toggleSelected('/work/a.md', '/work')
    expect(paths()).toEqual([])
    expect(selectedPath.value).toBeNull()
  })

  it('selects a range from the anchor, and moves the end without moving the start', async () => {
    await start()
    select('/work/a.md', '/work')
    selectRangeTo(treeRows.value, '/work/c.md', '/work')
    expect(paths()).toEqual(['/work/a.md', '/work/b.md', '/work/c.md'])
    selectRangeTo(treeRows.value, '/work/d.txt', '/work')
    expect(paths()).toEqual(['/work/a.md', '/work/b.md', '/work/c.md', '/work/d.txt'])
    selectRangeTo(treeRows.value, '/work/b.md', '/work')
    expect(paths()).toEqual(['/work/a.md', '/work/b.md'])
    expect(selectedPath.value).toBe('/work/b.md')
  })

  it('selects upwards too, and across a folder that is open', async () => {
    await start()
    select('/work/b.md', '/work')
    selectRangeTo(treeRows.value, '/work/notes', '/work')
    expect(paths().sort()).toEqual(
      ORDER.filter((path) =>
        [
          '/work/notes',
          '/work/notes/deep',
          '/work/notes/n.md',
          '/work/a.md',
          '/work/b.md',
        ].includes(path),
      ).sort(),
    )
  })

  it('goes back to the lead alone on collapse, and a plain select clears the rest', async () => {
    await start()
    select('/work/a.md', '/work')
    toggleSelected('/work/c.md', '/work')
    collapseSelection()
    expect(paths()).toEqual(['/work/c.md'])
    toggleSelected('/work/a.md', '/work')
    select('/work/b.md', '/work')
    expect(paths()).toEqual(['/work/b.md'])
  })

  it('follows a move: the rows that moved are at their new paths, the others stay', async () => {
    await start()
    select('/work/a.md', '/work')
    toggleSelected('/work/b.md', '/work')
    toggleSelected('/work/notes/n.md', '/work')
    remapPaths('/work/notes', '/work/dest/notes')
    expect(paths()).toEqual(['/work/a.md', '/work/b.md', '/work/dest/notes/n.md'])
  })

  it('drops the rows of what is gone, and the lead with them', async () => {
    await start()
    select('/work/a.md', '/work')
    toggleSelected('/work/notes/n.md', '/work')
    toggleSelected('/work/b.md', '/work')
    forgetPath('/work/notes')
    expect(paths()).toEqual(['/work/a.md', '/work/b.md'])
    forgetPath('/work/b.md')
    expect(paths()).toEqual(['/work/a.md'])
    expect(selectedPath.value).toBe('/work/a.md')
  })

  it('has nothing to delete or move in a workspace folder, and folds rows into their folder', async () => {
    await start()
    select('/work', '/work')
    toggleSelected('/work/notes', '/work')
    toggleSelected('/work/notes/n.md', '/work')
    toggleSelected('/work/a.md', '/work')
    expect(selectedTargets()).toEqual({ paths: ['/work/notes', '/work/a.md'], roots: 1 })
  })
})

// ---- the drawn tree ----

const rowEl = (root: HTMLElement, path: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(`[data-row-path="${path}"]`)
  if (found === null) throw new Error(`no row ${path}`)
  return found
}
const selectedRows = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>('[aria-selected="true"]')].map(
    (el) => el.dataset.rowPath ?? '',
  )
function click(el: HTMLElement, init: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, ...init }))
}
function keydown(root: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  root.querySelector('[data-file-tree]')?.dispatchEvent(event)
  return event
}

describe('clicks and keys on the tree (P9.1-T9)', () => {
  it('Ctrl+click adds a row without opening it, and Ctrl+click again takes it out', async () => {
    await start()
    const root = mount(FileTree)
    await flush()
    click(rowEl(root, '/work/a.md'))
    await flush()
    click(rowEl(root, '/work/c.md'), { ctrlKey: true })
    click(rowEl(root, '/work/d.txt'), { ctrlKey: true })
    await flush()
    expect(selectedRows(root)).toEqual(['/work/a.md', '/work/c.md', '/work/d.txt'])
    expect(root.querySelector('[data-file-tree]')?.getAttribute('aria-multiselectable')).toBe(
      'true',
    )
    click(rowEl(root, '/work/c.md'), { ctrlKey: true })
    await flush()
    expect(selectedRows(root)).toEqual(['/work/a.md', '/work/d.txt'])
  })

  it('Ctrl+click on a folder selects it and does not open it', async () => {
    await start(FILES, false)
    const root = mount(FileTree)
    await flush()
    click(rowEl(root, '/work/dest'), { ctrlKey: true })
    await flush()
    expect(rowEl(root, '/work/dest').getAttribute('aria-expanded')).toBe('false')
    expect(selectedRows(root)).toEqual(['/work/dest'])
  })

  it('Shift+click selects the rows from the first one clicked', async () => {
    await start()
    const root = mount(FileTree)
    await flush()
    click(rowEl(root, '/work/a.md'))
    await flush()
    click(rowEl(root, '/work/c.md'), { shiftKey: true })
    await flush()
    expect(selectedRows(root)).toEqual(['/work/a.md', '/work/b.md', '/work/c.md'])
  })

  it('a plain click on one of several selected rows goes back to that row alone', async () => {
    await start()
    const root = mount(FileTree)
    await flush()
    click(rowEl(root, '/work/a.md'))
    click(rowEl(root, '/work/b.md'), { ctrlKey: true })
    await flush()
    click(rowEl(root, '/work/b.md'))
    await flush()
    expect(selectedRows(root)).toEqual(['/work/b.md'])
  })

  it('Shift+Down and Shift+Up grow and shrink the range, and Escape goes back to the lead', async () => {
    await start()
    const root = mount(FileTree)
    await flush()
    click(rowEl(root, '/work/a.md'))
    await flush()
    expect(keydown(root, 'ArrowDown', { shiftKey: true }).defaultPrevented).toBe(true)
    keydown(root, 'ArrowDown', { shiftKey: true })
    await flush()
    expect(selectedRows(root)).toEqual(['/work/a.md', '/work/b.md', '/work/c.md'])
    keydown(root, 'ArrowUp', { shiftKey: true })
    await flush()
    expect(selectedRows(root)).toEqual(['/work/a.md', '/work/b.md'])
    expect(keydown(root, 'Escape').defaultPrevented).toBe(true)
    await flush()
    expect(selectedRows(root)).toEqual(['/work/b.md'])
  })

  it('an arrow key with no Shift moves the lead and selects that row alone', async () => {
    await start()
    const root = mount(FileTree)
    await flush()
    click(rowEl(root, '/work/a.md'))
    click(rowEl(root, '/work/b.md'), { ctrlKey: true })
    await flush()
    keydown(root, 'ArrowDown')
    await flush()
    expect(selectedRows(root)).toEqual(['/work/c.md'])
  })

  it('F2 does nothing with several rows selected', async () => {
    await start()
    select('/work/a.md', '/work')
    toggleSelected('/work/b.md', '/work')
    await renameSelected()
    await flush()
    expect(document.querySelector('[data-name-input]')).toBeNull()
  })

  it('the menu of a row inside the selection acts on all of it, and offers Open All and Delete', async () => {
    await start()
    const root = mount(FileTree)
    await flush()
    click(rowEl(root, '/work/a.md'))
    click(rowEl(root, '/work/c.md'), { ctrlKey: true })
    await flush()
    rowEl(root, '/work/c.md').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
    )
    await flush()
    expect(selectedRows(root)).toEqual(['/work/a.md', '/work/c.md'])
    const items = [...document.body.querySelectorAll<HTMLElement>('[role=menuitem]')].map((el) =>
      el.textContent.replace(/\s+/g, ' ').trim(),
    )
    expect(items).toHaveLength(3)
    expect(items[0]).toMatch(/^Open All/)
    expect(items[1]).toMatch(/^Delete 2 items Delete$/)
    expect(items[2]).toBe('Delete 2 items Permanently Shift+Delete')
    ;[...document.body.querySelectorAll<HTMLElement>('[role=menuitem]')][1]?.click()
    await flush()
    expect(deletePrompt.value?.paths).toEqual(['/work/a.md', '/work/c.md'])
  })

  it('the menu of a row outside the selection selects that row alone, with the usual items', async () => {
    await start()
    const root = mount(FileTree)
    await flush()
    click(rowEl(root, '/work/a.md'))
    click(rowEl(root, '/work/c.md'), { ctrlKey: true })
    await flush()
    rowEl(root, '/work/d.txt').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
    )
    await flush()
    expect(selectedRows(root)).toEqual(['/work/d.txt'])
    const items = [...document.body.querySelectorAll<HTMLElement>('[role=menuitem]')].map((el) =>
      el.textContent.replace(/\s+/g, ' ').trim(),
    )
    expect(items.some((item) => item.startsWith('Rename'))).toBe(true)
    expect(items.some((item) => item.startsWith('Delete'))).toBe(true)
  })
})

// ---- delete ----

describe('deleting the selection (P9.1-T9)', () => {
  it('asks once for all of it, with how many files and folders and how many tabs close', async () => {
    await start()
    const a = await openPath('/work/a.md')
    await openPath('/work/notes/n.md')
    followerOfTab(a)?.dispatch({ changes: { from: 0, insert: 'x' } })
    select('/work/a.md', '/work')
    toggleSelected('/work/notes', '/work')
    toggleSelected('/work/d.txt', '/work')
    await deleteSelected()
    expect(deletePrompt.value).toMatchObject({
      paths: ['/work/a.md', '/work/notes', '/work/d.txt'],
      name: '3 items',
      files: 2,
      folders: 1,
      tabs: 2,
      unsaved: 1,
    })
  })

  it('folds a selected row into its selected folder, so nothing is asked twice', async () => {
    await start()
    select('/work/notes', '/work')
    toggleSelected('/work/notes/n.md', '/work')
    toggleSelected('/work/a.md', '/work')
    await deleteSelected()
    expect(deletePrompt.value?.paths).toEqual(['/work/notes', '/work/a.md'])
  })

  it('asks the old way for one row, and for several that fold into one', async () => {
    await start()
    select('/work/a.md', '/work')
    await deleteSelected()
    expect(deletePrompt.value).toMatchObject({
      path: '/work/a.md',
      name: 'a.md',
      paths: ['/work/a.md'],
    })
    cancelDelete()
    select('/work/notes', '/work')
    toggleSelected('/work/notes/n.md', '/work')
    await deleteSelected()
    expect(deletePrompt.value).toMatchObject({
      name: 'notes',
      folder: true,
      paths: ['/work/notes'],
    })
  })

  it('leaves a workspace folder out, says so, and asks about the rest', async () => {
    await start()
    select('/work', '/work')
    toggleSelected('/work/a.md', '/work')
    toggleSelected('/work/b.md', '/work')
    await deleteSelected()
    expect(deletePrompt.value?.paths).toEqual(['/work/a.md', '/work/b.md'])
    expect(toasts.last).toContain('left out')
  })

  it('sends every row to the Recycle Bin once the question is answered yes, and forgets them', async () => {
    await start()
    select('/work/a.md', '/work')
    toggleSelected('/work/b.md', '/work')
    toggleSelected('/work/notes', '/work')
    await deleteSelected()
    expect(host.recycled).toEqual([])
    await confirmDelete()
    await flush()
    expect(host.recycled.map((file) => file.path).sort()).toEqual(
      // The mock lists the files of a folder one by one; Rust moves the folder whole.
      ['/work/a.md', '/work/b.md', '/work/notes/deep/m.md', '/work/notes/n.md'].sort(),
    )
    expect(host.files.has('/work/a.md')).toBe(false)
    expect(host.files.has('/work/notes/n.md')).toBe(false)
    expect(host.files.has('/work/c.md')).toBe(true)
    expect(treeRows.value.some((row) => row.kind !== 'note' && row.path === '/work/a.md')).toBe(
      false,
    )
    expect(selectedPlaces.value).toEqual([])
  })

  it('closes the tabs of every deleted file', async () => {
    await start()
    await openPath('/work/a.md')
    await openPath('/work/b.md')
    await openPath('/work/c.md')
    select('/work/a.md', '/work')
    toggleSelected('/work/b.md', '/work')
    await deleteSelected()
    await confirmDelete()
    await flush()
    const { allDocuments } = await import('@/documents/store')
    expect(allDocuments().map((doc) => doc.path)).toEqual(['/work/c.md'])
  })

  it('the Delete key asks, and the question is one dialog for all of it', async () => {
    await start()
    const root = mount(FileTree)
    await flush()
    click(rowEl(root, '/work/a.md'))
    click(rowEl(root, '/work/b.md'), { ctrlKey: true })
    await flush()
    keydown(root, 'Delete')
    await flush()
    expect(deletePrompt.value?.paths).toEqual(['/work/a.md', '/work/b.md'])
    expect(host.recycled).toEqual([])
  })
})

describe('the delete dialog for several rows (P9.1-T9)', () => {
  const dialogText = (): string =>
    document.body.querySelector('[data-delete-dialog]')?.textContent.replace(/\s+/g, ' ').trim() ??
    ''

  it('says how many items, of what kind, and that a folder takes what is in it', async () => {
    await start()
    mount(DeleteDialog)
    select('/work/a.md', '/work')
    toggleSelected('/work/notes', '/work')
    toggleSelected('/work/d.txt', '/work')
    await deleteSelected()
    await flush()
    expect(dialogText()).toContain('Delete 3 items?')
    expect(dialogText()).toMatch(/2 files and 1 folder move to the (Recycle Bin|Trash)\./)
    expect(dialogText()).toContain('A folder takes everything in it.')
  })

  it('counts the tabs and the unsaved files of all the rows together', async () => {
    await start()
    mount(DeleteDialog)
    const a = await openPath('/work/a.md')
    const b = await openPath('/work/b.md')
    await openPath('/work/c.md')
    followerOfTab(a)?.dispatch({ changes: { from: 0, insert: 'x' } })
    followerOfTab(b)?.dispatch({ changes: { from: 0, insert: 'y' } })
    select('/work/a.md', '/work')
    toggleSelected('/work/b.md', '/work')
    await deleteSelected()
    await flush()
    expect(dialogText()).toContain('Delete 2 items?')
    expect(dialogText()).toContain('2 open tabs close.')
    expect(dialogText()).toContain('2 files have unsaved changes, and they are lost.')
    expect(dialogText()).not.toContain('folder')
  })

  it('still reads as before for one row', async () => {
    await start()
    mount(DeleteDialog)
    select('/work/d.txt', '/work')
    await deleteSelected()
    await flush()
    expect(dialogText()).toContain('Delete "d.txt"?')
    expect(dialogText()).toMatch(/The file moves to the (Recycle Bin|Trash)\./)
  })
})

// ---- move ----

describe('moving the selection (P9.1-T9)', () => {
  it('moves every row into the folder, and selects them where they went', async () => {
    await start()
    select('/work/a.md', '/work')
    toggleSelected('/work/b.md', '/work')
    toggleSelected('/work/notes', '/work')
    await moveRows(selectedTargets().paths, '/work/dest')
    await flush()
    expect(host.files.has('/work/dest/a.md')).toBe(true)
    expect(host.files.has('/work/dest/b.md')).toBe(true)
    expect(host.files.has('/work/dest/notes/n.md')).toBe(true)
    expect(host.files.has('/work/a.md')).toBe(false)
    expect(paths().sort()).toEqual(
      ['/work/dest/a.md', '/work/dest/b.md', '/work/dest/notes'].sort(),
    )
  })

  it('skips a row that is already there or would go into itself, and says so once', async () => {
    await start()
    toasts.clear()
    await moveRows(['/work/notes', '/work/dest/x.md', '/work/a.md'], '/work/dest')
    await flush()
    // `/work/dest/x.md` is already in dest; the other two move.
    expect(host.files.has('/work/dest/a.md')).toBe(true)
    expect(host.files.has('/work/dest/notes/n.md')).toBe(true)
    expect(host.files.has('/work/dest/x.md')).toBe(true)
    expect(toasts.messages).toHaveLength(1)
    expect(toasts.last).toContain('Moved 2 of 3')
    expect(toasts.last).toContain('x.md: It is already in that folder.')
  })

  it('says nothing was moved when no row can go there', async () => {
    await start()
    toasts.clear()
    await moveRows(['/work/dest/x.md'], '/work/dest')
    expect(toasts.last).toContain('already in that folder')
    await moveRows(['/work/notes'], '/work/notes/deep')
    expect(toasts.last).toContain('into itself')
  })

  it('goes on past a row Rust refuses (a name that is taken there), and lists it', async () => {
    await start({ ...FILES, '/work/dest/b.md': 'taken' })
    toasts.clear()
    await moveRows(['/work/a.md', '/work/b.md', '/work/c.md'], '/work/dest')
    await flush()
    expect(host.files.has('/work/dest/a.md')).toBe(true)
    expect(host.files.has('/work/dest/c.md')).toBe(true)
    expect(host.files.read('/work/dest/b.md')).toBe('taken')
    expect(host.files.has('/work/b.md')).toBe(true)
    expect(toasts.last).toContain('Moved 2 of 3')
    expect(toasts.last).toContain('b.md')
  })

  describe('with links.onRename set to ask', () => {
    const LINKED: Record<string, string> = {
      '/work/index.md': '[b](b.md) and [c](c.md)\n',
      '/work/b.md': '# b\n',
      '/work/c.md': '# c\n',
      '/work/dest/x.md': '# x\n',
    }
    let phases: string[] = []
    let stop: (() => void) | undefined
    beforeEach(() => {
      phases = []
      stop = watchRef(
        rewriteState,
        (state: RewriteState | null) => {
          if (state !== null && phases.at(-1) !== state.phase) phases.push(state.phase)
        },
        { flush: 'sync' },
      )
      settings.links.onRename = 'ask'
    })
    afterEach(() => stop?.())

    it('asks once for the whole batch, and says how many more it covers', async () => {
      await start(LINKED, false)
      const running = moveRows(['/work/b.md', '/work/c.md'], '/work/dest')
      await flush()
      expect(rewriteState.value).toMatchObject({ phase: 'asking', more: 1 })
      answerRewrite('update')
      await running
      await flush()
      expect(phases.filter((phase) => phase === 'asking')).toHaveLength(1)
      expect(host.files.has('/work/dest/b.md')).toBe(true)
      expect(host.files.has('/work/dest/c.md')).toBe(true)
      expect(host.files.read('/work/index.md')).toBe('[b](dest/b.md) and [c](dest/c.md)\n')
    })

    it('No moves every row plainly, with the links left alone and no second question', async () => {
      await start(LINKED, false)
      const running = moveRows(['/work/b.md', '/work/c.md'], '/work/dest')
      await flush()
      answerRewrite('move-only')
      await running
      await flush()
      expect(phases.filter((phase) => phase === 'asking')).toHaveLength(1)
      expect(host.files.has('/work/dest/b.md')).toBe(true)
      expect(host.files.has('/work/dest/c.md')).toBe(true)
      expect(host.files.read('/work/index.md')).toBe(LINKED['/work/index.md'])
    })

    it('Cancel stops the batch, and nothing is moved', async () => {
      await start(LINKED, false)
      toasts.clear()
      const running = moveRows(['/work/b.md', '/work/c.md'], '/work/dest')
      await flush()
      answerRewrite('cancel')
      await running
      await flush()
      expect(host.files.has('/work/b.md')).toBe(true)
      expect(host.files.has('/work/c.md')).toBe(true)
      expect(host.files.has('/work/dest/b.md')).toBe(false)
      expect(toasts.messages).toEqual([])
    })
  })
})

// ---- the drag ----

describe('dragging the selection (P9.1-T9)', () => {
  function pointer(type: string, x: number, y: number): MouseEvent {
    return new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
  }
  async function drag(root: HTMLElement, from: string, onto: string): Promise<void> {
    document.elementFromPoint = () => rowEl(root, onto)
    try {
      rowEl(root, from).dispatchEvent(pointer('pointerdown', 10, 10))
      window.dispatchEvent(pointer('pointermove', 40, 60))
      await flush()
      window.dispatchEvent(pointer('pointerup', 40, 60))
      await flush()
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint')
    }
  }

  it('carries every selected row when the pressed one is selected', async () => {
    await start()
    const root = mount(FileTree)
    await flush()
    click(rowEl(root, '/work/a.md'))
    click(rowEl(root, '/work/b.md'), { ctrlKey: true })
    click(rowEl(root, '/work/c.md'), { ctrlKey: true })
    await flush()
    document.elementFromPoint = () => rowEl(root, '/work/dest')
    try {
      rowEl(root, '/work/b.md').dispatchEvent(pointer('pointerdown', 10, 10))
      window.dispatchEvent(pointer('pointermove', 40, 60))
      await flush()
      const dragging = [...root.querySelectorAll<HTMLElement>('[data-dragging]')].map(
        (el) => el.dataset.rowPath,
      )
      expect(dragging).toEqual(['/work/a.md', '/work/b.md', '/work/c.md'])
      expect(rowEl(root, '/work/dest').dataset.dropTarget).toBeDefined()
      window.dispatchEvent(pointer('pointerup', 40, 60))
      await flush()
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint')
    }
    for (const name of ['a', 'b', 'c']) {
      expect(host.files.has(`/work/dest/${name}.md`), name).toBe(true)
      expect(host.files.has(`/work/${name}.md`), name).toBe(false)
    }
    expect(host.files.has('/work/d.txt')).toBe(true)
  })

  it('takes only the pressed row when it is not selected, and selects it', async () => {
    await start()
    const root = mount(FileTree)
    await flush()
    click(rowEl(root, '/work/a.md'))
    click(rowEl(root, '/work/b.md'), { ctrlKey: true })
    await flush()
    await drag(root, '/work/d.txt', '/work/dest')
    expect(host.files.has('/work/dest/d.txt')).toBe(true)
    expect(host.files.has('/work/a.md')).toBe(true)
    expect(host.files.has('/work/b.md')).toBe(true)
    expect(host.files.has('/work/dest/a.md')).toBe(false)
  })

  it('a press that does not travel only clicks, and keeps the selection until the click', async () => {
    await start()
    const root = mount(FileTree)
    await flush()
    click(rowEl(root, '/work/a.md'))
    click(rowEl(root, '/work/b.md'), { ctrlKey: true })
    await flush()
    rowEl(root, '/work/b.md').dispatchEvent(pointer('pointerdown', 10, 10))
    window.dispatchEvent(pointer('pointermove', 11, 11))
    window.dispatchEvent(pointer('pointerup', 11, 11))
    await flush()
    expect(selectedRows(root)).toEqual(['/work/a.md', '/work/b.md'])
    expect(host.files.has('/work/a.md')).toBe(true)
  })

  it('moves one row for a drag of one, as before', async () => {
    await start()
    const root = mount(FileTree)
    await flush()
    await drag(root, '/work/a.md', '/work/dest')
    expect(host.files.has('/work/dest/a.md')).toBe(true)
    expect(host.files.has('/work/b.md')).toBe(true)
  })
})
