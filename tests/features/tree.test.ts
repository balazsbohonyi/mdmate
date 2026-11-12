// @vitest-environment jsdom
/**
 * The sidebar tree (P6-T1): ISC-97 (several roots), ISC-99 (a big folder draws few rows), ISC-105
 * (other files dimmed), ISC-132 (a file made elsewhere shows up) and ISC-192 and ISC-193 from the
 * page's side. The files live in the mock host, which keeps what Rust keeps: the roots, and the
 * rule that only a folder inside a root can be listed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { problem, resetDocuments } from '@/documents/store'
import {
  flatten,
  isMarkdownName,
  joinPath,
  keyAction,
  pathKeyer,
  placeKey,
  ROW_HEIGHT,
  visibleWindow,
  type Listing,
  type TreeRow,
} from '@/features/tree/model'
import { newFileIn, renameRow } from '@/features/tree/ops'
import FileTree from '@/features/tree/FileTree.vue'
import {
  cancelNaming,
  expandedFolderPaths,
  expandedPlaces,
  loadFolder,
  openFolderDialog,
  removeRootFolder,
  resetTree,
  restoreWorkspace,
  selectedPath,
  toggleFolder,
  treeRows,
  workspaceRoots,
} from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { findPane } from '@/workbench/splitTree'
import { resetWorkbench, tabRecord, workbenchLayout } from '@/workbench/store'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Lets every pending listing answer and the page draw what they brought. */
async function flush(): Promise<void> {
  for (let round = 0; round < 4; round++) {
    await settle()
    await nextTick()
  }
}

const FILES: Record<string, string> = {
  '/work/notes/a.md': '# a\n',
  '/work/notes/b.md': '# b\n',
  '/work/notes/pic.png': 'png',
  '/work/notes/deep/c.md': '# c\n',
  '/work/readme.md': '# readme\n',
  '/work/Zeta.txt': 'z',
  '/other/x.md': '# x\n',
}

/** What a mouse over an element does to its tooltip trigger. */
async function hover(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('nothing to hover')
  element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
  await flush()
}
const hint = (): string | undefined =>
  document.body.querySelector('[data-hover-hint]')?.textContent?.trim()

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined

function mountTree(): HTMLElement {
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(FileTree)
  app.mount(root)
  mounted = { app, root }
  return root
}

function names(): string[] {
  return treeRows.value.map((row) => `${'  '.repeat(row.depth)}${row.name}`)
}

beforeEach(() => {
  resetTree()
  resetDocuments()
  resetWorkbench()
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  setHost(undefined)
  resetTree()
})

function start(options: Parameters<typeof createMockHost>[0] = {}): MockHost {
  host = createMockHost({ files: FILES, ...options })
  setHost(host)
  return host
}

describe('the rows of the tree', () => {
  const keyOf = pathKeyer(true)
  const entries = (...list: [string, 'file' | 'folder'][]): Listing => ({
    entries: list.map(([name, kind]) => ({ name, kind })),
    error: null,
  })

  it('lists a root, then what is inside each open folder, with depth', () => {
    const open = new Map([
      [placeKey(keyOf, '/w', '/w'), '/w'],
      [placeKey(keyOf, '/w', '/w/sub'), '/w/sub'],
    ])
    const listings = new Map<string, Listing>([
      [keyOf('/w'), entries(['sub', 'folder'], ['a.md', 'file'])],
      [keyOf('/w/sub'), entries(['deep.md', 'file'])],
    ])
    const rows = flatten(['/w'], open, listings, keyOf)
    expect(rows.map((row) => [row.kind, row.name, row.depth])).toEqual([
      ['root', 'w', 0],
      ['folder', 'sub', 1],
      ['file', 'deep.md', 2],
      ['file', 'a.md', 1],
    ])
  })

  it('shows nothing under a folder that is closed', () => {
    const listings = new Map<string, Listing>([[keyOf('/w'), entries(['a.md', 'file'])]])
    const rows = flatten(['/w'], new Map(), listings, keyOf)
    expect(rows.map((row) => row.name)).toEqual(['w'])
    expect(rows[0]).toMatchObject({ kind: 'root', expanded: false })
  })

  it('says loading while an open folder has no listing, and why when it failed', () => {
    const open = new Map([[placeKey(keyOf, '/w', '/w'), '/w']])
    const loading = flatten(['/w'], open, new Map(), keyOf)
    expect(loading[1]).toMatchObject({ kind: 'note', name: 'Loading…', tone: 'muted' })
    const failed = flatten(
      ['/w'],
      open,
      new Map([[keyOf('/w'), { entries: null, error: 'access is not allowed' }]]),
      keyOf,
    )
    expect(failed[1]).toMatchObject({ kind: 'note', name: 'access is not allowed', tone: 'error' })
  })

  it('keeps the entries a folder had when a later listing fails', () => {
    const open = new Map([[placeKey(keyOf, '/w', '/w'), '/w']])
    const kept = flatten(
      ['/w'],
      open,
      new Map([
        [keyOf('/w'), { entries: [{ name: 'a.md', kind: 'file' as const }], error: 'gone' }],
      ]),
      keyOf,
    )
    expect(kept.map((row) => row.kind)).toEqual(['root', 'note', 'file'])
  })

  it('marks Markdown files and nothing else as Markdown', () => {
    for (const name of ['a.md', 'A.MD', 'x.markdown', 'y.mdown', 'z.mkd', 'w.mdx']) {
      expect(isMarkdownName(name), name).toBe(true)
    }
    for (const name of ['a.txt', 'md', '.md', 'a.md.bak', 'pic.png', 'noext']) {
      expect(isMarkdownName(name), name).toBe(false)
    }
  })

  it('joins a name to a folder with the separator the folder uses', () => {
    expect(joinPath('C:\\work', 'a.md')).toBe('C:\\work\\a.md')
    expect(joinPath('/work', 'a.md')).toBe('/work/a.md')
    expect(joinPath('C:\\', 'a.md')).toBe('C:\\a.md')
    expect(joinPath('/', 'a.md')).toBe('/a.md')
  })

  it('draws only the rows in view plus a margin', () => {
    expect(visibleWindow(0, 240, 10_000)).toEqual({ start: 0, end: 19 })
    const middle = visibleWindow(ROW_HEIGHT * 5000, 240, 10_000)
    expect(middle.start).toBe(5000 - 8)
    expect(middle.end - middle.start).toBeLessThan(40)
    expect(visibleWindow(0, 240, 3)).toEqual({ start: 0, end: 3 })
    expect(visibleWindow(-50, 240, 100).start).toBe(0)
  })
})

describe('roots (ISC-97, ISC-192, ISC-193)', () => {
  it('shows two roots, each with its own files', async () => {
    start({ roots: ['/work', '/other'] })
    await restoreWorkspace([])
    await flush()
    expect(workspaceRoots.value).toEqual(['/work', '/other'])
    expect(names()).toEqual(['work', '  notes', '  readme.md', '  Zeta.txt', 'other', '  x.md'])
  })

  it('draws a folder that is a root and also inside another root once per place, and leaves no row behind when they close', async () => {
    start({ roots: ['/work', '/work/notes'] })
    await restoreWorkspace([])
    await flush()
    const root = mountTree()
    await flush()
    const drawn = (): string[] =>
      [...root.querySelectorAll<HTMLElement>('[role="treeitem"], [data-kind="note"]')].map(
        (row) => `${row.dataset.kind ?? ''}:${row.dataset.rowPath ?? row.textContent ?? ''}`,
      )
    const warnings: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '))
    }
    try {
      // /work/notes shows under /work and as a root of its own; both list a.md, b.md and deep.
      expect(drawn()).toHaveLength(treeRows.value.length)
      await toggleFolder('/work/notes/deep')
      await flush()
      expect(drawn()).toHaveLength(treeRows.value.length)
      // Close the first root, then the second: every row must go with them.
      root.querySelector<HTMLElement>('[data-kind="root"][data-row-path="/work"]')?.click()
      await flush()
      expect(drawn()).toHaveLength(treeRows.value.length)
      root.querySelector<HTMLElement>('[data-kind="root"][data-row-path="/work/notes"]')?.click()
      await flush()
      expect(treeRows.value.map((row) => row.name)).toEqual(['work', 'notes'])
      expect(drawn()).toEqual(['root:/work', 'root:/work/notes'])
    } finally {
      console.warn = warn
    }
    expect(warnings.filter((text) => text.includes('Duplicate keys'))).toEqual([])
  })

  describe('a folder that is a root and also inside another root keeps a state per place', () => {
    const OUTER = '/work'
    const INNER = '/work/notes'
    const place = (root: string, path: string, kind?: string): string =>
      `[data-row-root="${root}"][data-row-path="${path}"]${kind === undefined ? '' : `[data-kind="${kind}"]`}`
    const rowsAt = (root: string, path: string): TreeRow[] =>
      treeRows.value.filter((row) => row.root === root && row.path === path)

    async function mounted2(): Promise<HTMLElement> {
      start({ roots: [OUTER, INNER] })
      await restoreWorkspace([])
      await flush()
      const tree = mountTree()
      await flush()
      return tree
    }

    it('opens a folder under one root and leaves the other copy closed', async () => {
      const tree = await mounted2()
      // Under /work the folder is closed; as a root of its own it is open and lists its files.
      expect(rowsAt(OUTER, INNER)[0]).toMatchObject({ kind: 'folder', expanded: false })
      expect(rowsAt(INNER, INNER)[0]).toMatchObject({ kind: 'root', expanded: true })
      tree.querySelector<HTMLElement>(place(OUTER, INNER, 'folder'))?.click()
      await flush()
      expect(rowsAt(OUTER, `${INNER}/a.md`)).toHaveLength(1)
      // Opening `deep` as a child of the root copy does not open it under /work.
      tree.querySelector<HTMLElement>(place(INNER, `${INNER}/deep`))?.click()
      await flush()
      expect(rowsAt(INNER, `${INNER}/deep/c.md`)).toHaveLength(1)
      expect(rowsAt(OUTER, `${INNER}/deep/c.md`)).toHaveLength(0)
      // Closing it again, and closing the root copy, leaves the /work copy as it was.
      tree.querySelector<HTMLElement>(place(INNER, INNER, 'root'))?.click()
      await flush()
      expect(rowsAt(INNER, `${INNER}/a.md`)).toHaveLength(0)
      expect(rowsAt(OUTER, `${INNER}/a.md`)).toHaveLength(1)
    })

    it('selects one copy only, and no id appears twice', async () => {
      const tree = await mounted2()
      tree.querySelector<HTMLElement>(place(OUTER, INNER, 'folder'))?.click()
      await flush()
      tree.querySelector<HTMLElement>(place(INNER, `${INNER}/a.md`))?.click()
      await flush()
      const selected = [...tree.querySelectorAll<HTMLElement>('[aria-selected="true"]')]
      expect(selected).toHaveLength(1)
      expect(selected[0]?.dataset.rowRoot).toBe(INNER)
      const ids = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')].map((row) => row.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(tree.querySelector('[role="tree"]')?.getAttribute('aria-activedescendant')).toBe(
        selected[0]?.id,
      )
    })

    it('moves from the second copy to the row after it, not after the first copy', async () => {
      await mounted2()
      await toggleFolder(INNER, OUTER)
      await flush()
      const rows = treeRows.value
      const at = rows.findIndex((row) => row.root === INNER && row.path === `${INNER}/a.md`)
      expect(keyAction(rows, `${INNER}/a.md`, 'ArrowDown', INNER)).toMatchObject({
        kind: 'select',
        path: rows[at + 1]?.path,
        root: INNER,
      })
      expect(keyAction(rows, `${INNER}/a.md`, 'ArrowUp', INNER)).toMatchObject({
        kind: 'select',
        path: rows[at - 1]?.path,
        root: INNER,
      })
    })

    it('turns only the row that was chosen into a name box on rename', async () => {
      const tree = await mounted2()
      await toggleFolder(INNER, OUTER)
      await flush()
      await renameRow(`${INNER}/a.md`, INNER)
      await flush()
      expect(tree.querySelectorAll('[data-name-input]')).toHaveLength(1)
      expect(
        tree.querySelector(place(INNER, `${INNER}/a.md`))?.querySelector('[data-name-input]'),
      ).not.toBeNull()
    })

    it('puts the box for a new file under the copy it was asked for', async () => {
      await mounted2()
      await newFileIn(OUTER)
      await flush()
      const boxes = treeRows.value.filter((row) => row.kind === 'new')
      expect(boxes).toHaveLength(1)
      expect(boxes[0]).toMatchObject({ root: OUTER })
      cancelNaming()
      await newFileIn(INNER, INNER)
      await flush()
      const second = treeRows.value.filter((row) => row.kind === 'new')
      expect(second).toHaveLength(1)
      expect(second[0]).toMatchObject({ root: INNER })
    })

    it('remembers which copies are open', async () => {
      await mounted2()
      await toggleFolder(INNER, OUTER)
      await flush()
      expect(expandedPlaces.value).toEqual(
        expect.arrayContaining([
          { root: OUTER, path: OUTER },
          { root: INNER, path: INNER },
          { root: OUTER, path: INNER },
        ]),
      )
      // A session from before places existed lists bare paths; each opens under every root holding it.
      resetTree()
      start({ roots: [OUTER, INNER] })
      await restoreWorkspace([`${INNER}/deep`])
      await flush()
      expect(rowsAt(OUTER, `${INNER}/deep`)).toHaveLength(0)
      expect(expandedPlaces.value).toEqual(
        expect.arrayContaining([
          { root: OUTER, path: `${INNER}/deep` },
          { root: INNER, path: `${INNER}/deep` },
        ]),
      )
      // A session that lists places opens exactly those.
      resetTree()
      start({ roots: [OUTER, INNER] })
      await restoreWorkspace([], [{ root: INNER, path: `${INNER}/deep` }])
      await flush()
      expect(expandedPlaces.value).toContainEqual({ root: INNER, path: `${INNER}/deep` })
      expect(expandedPlaces.value).not.toContainEqual({ root: OUTER, path: `${INNER}/deep` })
    })
  })

  it('adds the folder the dialog returns, open, and does not add it twice', async () => {
    start({ pickFolder: () => '/work' })
    await restoreWorkspace([])
    await openFolderDialog()
    await flush()
    expect(workspaceRoots.value).toEqual(['/work'])
    expect(treeRows.value.map((row) => row.name)).toContain('readme.md')
    await openFolderDialog()
    expect(workspaceRoots.value).toEqual(['/work'])
  })

  it('a cancelled dialog changes nothing', async () => {
    start({ pickFolder: () => null })
    await restoreWorkspace([])
    await openFolderDialog()
    expect(workspaceRoots.value).toEqual([])
    expect(problem.value).toBeNull()
  })

  it('a folder that does not exist is reported, not added', async () => {
    start({ pickFolder: () => '/nowhere' })
    await restoreWorkspace([])
    await openFolderDialog()
    expect(workspaceRoots.value).toEqual([])
    expect(problem.value).toMatch(/does not exist/)
  })

  it('removing a root takes its rows away and revokes the host side', async () => {
    start({ roots: ['/work', '/other'] })
    await restoreWorkspace([])
    await flush()
    await removeRootFolder('/work')
    expect(workspaceRoots.value).toEqual(['/other'])
    expect(names()).toEqual(['other', '  x.md'])
    expect(host.roots).toEqual(['/other'])
    await expect(host.listDir('/work/notes')).rejects.toMatchObject({ kind: 'not-allowed' })
  })

  it('removing a root forgets its open folders and its selection', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await flush()
    await toggleFolder('/work/notes')
    selectedPath.value = '/work/notes/a.md'
    expect(expandedFolderPaths.value).toContain('/work/notes')
    await removeRootFolder('/work')
    expect(expandedFolderPaths.value).toEqual([])
    expect(selectedPath.value).toBeNull()
  })

  it('leaves the roots alone when the host refuses to remove one', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await removeRootFolder('/not-a-root')
    expect(workspaceRoots.value).toEqual(['/work'])
    expect(problem.value).toMatch(/not a workspace folder/)
  })
})

describe('open folders and changes (ISC-132)', () => {
  it('lists a folder when it opens and hides its rows when it closes', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await flush()
    expect(names()).not.toContain('    a.md')
    await toggleFolder('/work/notes')
    await flush()
    expect(names()).toContain('    a.md')
    expect(names()).toContain('    deep')
    await toggleFolder('/work/notes')
    expect(names()).not.toContain('    a.md')
  })

  it('shows a file another program created in an open folder', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await flush()
    expect(host.watchedFolders()).toEqual(['/work'])
    host.files.write('/work/fresh.md', '# fresh\n')
    await flush()
    expect(names()).toContain('  fresh.md')
  })

  it('shows a file another program deleted, and a new folder', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await flush()
    host.files.delete('/work/readme.md')
    host.files.mkdir('/work/empty')
    await flush()
    expect(names()).not.toContain('  readme.md')
    expect(names()).toContain('  empty')
  })

  it('does not hear about a folder that is closed, and watches exactly the open ones', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await flush()
    await toggleFolder('/work/notes')
    await flush()
    expect([...host.watchedFolders()].sort()).toEqual(['/work', '/work/notes'])
    await toggleFolder('/work/notes')
    await flush()
    expect(host.watchedFolders()).toEqual(['/work'])
    host.files.write('/work/notes/late.md', 'x')
    await flush()
    expect(names()).not.toContain('    late.md')
    await toggleFolder('/work/notes')
    await flush()
    expect(names()).toContain('    late.md')
  })

  it('lets the newest listing win when two answers cross', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await flush()
    const slow = host.listDir.bind(host)
    let release: (() => void) | undefined
    host.listDir = async (path) => {
      const listed = await slow(path)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return listed
    }
    const first = loadFolder('/work')
    await settle()
    const stale = release
    host.listDir = slow
    host.files.write('/work/newer.md', 'x')
    await loadFolder('/work')
    stale?.()
    await first
    await flush()
    expect(names()).toContain('  newer.md')
  })

  it('shows the reason when a folder cannot be listed, and keeps what it showed', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await flush()
    await toggleFolder('/work/notes')
    await flush()
    expect(names()).toContain('    a.md')
    host.listDir = () => Promise.reject(new Error('the folder is locked'))
    await loadFolder('/work/notes')
    await flush()
    expect(names()).toContain('    a.md')
    const note = treeRows.value.find((row) => row.kind === 'note')
    expect(note?.name).toContain('the folder is locked')
    expect(note).toMatchObject({ tone: 'error' })
  })

  it('restores the open folders it is told about, only inside roots', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace(['/work/notes', '/other/elsewhere', '/etc'])
    await flush()
    expect(expandedFolderPaths.value).toEqual(['/work', '/work/notes'])
    expect(names()).toContain('    a.md')
  })
})

describe('the drawn tree (ISC-99, ISC-105)', () => {
  it('draws fewer than 200 rows for a folder of 10,000 files, and other rows as you scroll', async () => {
    const many: Record<string, string> = {}
    for (let index = 0; index < 10_000; index++)
      many[`/big/note-${String(index).padStart(5, '0')}.md`] = ''
    start({ files: many, roots: ['/big'] })
    await restoreWorkspace([])
    await flush()
    expect(treeRows.value).toHaveLength(10_001)
    const root = mountTree()
    await flush()
    const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')]
    expect(rows().length).toBeGreaterThan(0)
    expect(rows().length).toBeLessThan(200)
    expect(rows()[0]?.textContent).toContain('big')

    const scroller = root.querySelector<HTMLElement>('[data-file-tree]')
    if (scroller === null) throw new Error('no tree')
    scroller.scrollTop = ROW_HEIGHT * 7000
    scroller.dispatchEvent(new Event('scroll'))
    await flush()
    expect(rows().length).toBeLessThan(200)
    expect(rows().some((row) => row.textContent?.includes('note-07000.md'))).toBe(true)
    expect(rows().some((row) => row.textContent?.includes('note-00001.md'))).toBe(false)
  })

  it('draws a row per entry for a small folder, in the listing order', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await flush()
    const root = mountTree()
    await flush()
    const shown = [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')].map((row) =>
      row.textContent?.trim(),
    )
    expect(shown).toEqual(['work', 'notes', 'readme.md', 'Zeta.txt'])
  })

  it("shows a row's path in the shadcn tooltip, and no native title (ISC-222)", async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await flush()
    const root = mountTree()
    await flush()
    const row = [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
      (el) => el.textContent?.trim() === 'readme.md',
    )
    expect(row?.hasAttribute('title')).toBe(false)
    expect(hint()).toBeUndefined()
    await hover(row)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(hint()).toBeUndefined() // a tree row waits 1 s (ISC-224)
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(hint()).toContain('/work/readme.md')
  }, 10_000)

  it('draws files that are not Markdown dimmed, and Markdown not', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await toggleFolder('/work/notes')
    await flush()
    const root = mountTree()
    await flush()
    const rowFor = (text: string): HTMLElement => {
      const found = [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
        (row) => row.textContent?.trim() === text,
      )
      if (found === undefined) throw new Error(`no row ${text}`)
      return found
    }
    expect(rowFor('a.md').className).not.toContain('text-muted-foreground')
    expect(rowFor('pic.png').className).toContain('text-muted-foreground')
    expect(rowFor('Zeta.txt').className).toContain('text-muted-foreground')
    // Folders are never dimmed like a stray file.
    expect(rowFor('notes').className).not.toContain('opacity')
  })

  it('opens a file in a tab when its row is clicked: Markdown, text and image alike (ISC-106, ISC-107)', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await toggleFolder('/work/notes')
    await flush()
    const root = mountTree()
    await flush()
    const click = async (path: string): Promise<void> => {
      root.querySelector<HTMLElement>(`[data-row-path="${path}"]`)?.click()
      await flush()
    }
    const kinds = (): string[] => {
      const layout = workbenchLayout.value
      return (findPane(layout, layout.activePane)?.tabs ?? []).map(
        (tab) => tabRecord(tab)?.kind ?? 'none',
      )
    }
    await click('/work/notes/a.md')
    await click('/work/Zeta.txt')
    await click('/work/notes/pic.png')
    expect(kinds()).toEqual(['markdown', 'text', 'image'])
  })

  it('opens a folder when its row is clicked', async () => {
    start({ roots: ['/work'] })
    await restoreWorkspace([])
    await flush()
    const root = mountTree()
    await flush()
    const notes = root.querySelector<HTMLElement>('[data-row-path="/work/notes"]')
    notes?.click()
    await flush()
    expect(root.querySelector('[data-row-path="/work/notes/a.md"]')).not.toBeNull()
    expect(selectedPath.value).toBe('/work/notes')
  })
})
