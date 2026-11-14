// @vitest-environment jsdom
/**
 * File operations in the tree (P6-T2): ISC-100 (new file), ISC-101 (rename), ISC-102 (move),
 * ISC-103 (delete to the Recycle Bin), ISC-104 (reveal), ISC-196 (new folder) and ISC-219 (open
 * documents follow a rename or move), from the page's side. The mock host does what Rust does:
 * only paths inside a root, never a root itself, and a document that stays open moves with its file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { docMeta } from '@/documents/meta'
import {
  allDocuments,
  documentOfTab,
  followerOfTab,
  openPath,
  resetDocuments,
} from '@/documents/store'
import FileTree from '@/features/tree/FileTree.vue'
import {
  cancelDelete,
  commitNaming,
  confirmDelete,
  deletePrompt,
  deleteRow,
  moveRow,
  newFileIn,
  newFolderIn,
  renameRow,
  requestDelete,
  revealInFileManager,
} from '@/features/tree/ops'
import {
  expandedFolderPaths,
  naming,
  resetTree,
  restoreWorkspace,
  selectedPath,
  toggleFolder,
  treeRows,
} from '@/features/tree/store'
import { LF, type Endings } from '@/lib/endings'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { imageTabs, resetWorkbench } from '@/workbench/store'
import { toasts } from '../helpers/toasts'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Lets every pending host call answer and the page draw what they brought. */
async function flush(): Promise<void> {
  for (let round = 0; round < 4; round++) {
    await settle()
    await nextTick()
  }
}

const FILES: Record<string, string> = {
  '/work/notes/a.md': '# a\n',
  '/work/notes/b.md': '# b\n',
  '/work/notes/deep/c.md': '# c\n',
  '/work/readme.md': '# readme\n',
  '/work/Zeta.txt': 'z',
  '/outside/o.md': '# o\n',
}

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

async function start(open: readonly string[] = []): Promise<void> {
  host = createMockHost({ files: FILES, roots: ['/work'] })
  mkdirEmpty()
  setHost(host)
  await restoreWorkspace(open)
  await flush()
}

function mkdirEmpty(): void {
  host.files.mkdir('/work/empty')
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
  vi.restoreAllMocks()
})

/** The id the host gave the document at a path. */
function idAt(path: string): number {
  const found = [...host.openDocuments()].find(([, at]) => at === path)
  if (found === undefined) throw new Error(`${path} is not open`)
  return found[0]
}

describe('a new file (ISC-100)', () => {
  it('shows a box first under its folder and makes the file when the name is entered', async () => {
    await start()
    await newFileIn('/work')
    expect(treeRows.value[1]).toMatchObject({
      kind: 'new',
      path: '/work',
      depth: 1,
      creates: 'file',
    })
    await commitNaming('fresh.md')
    await flush()
    expect(host.files.read('/work/fresh.md')).toBe('')
    expect(naming.value).toBeNull()
    expect(names()).toContain('  fresh.md')
    expect(selectedPath.value).toBe('/work/fresh.md')
  })

  it('opens a closed folder so its box shows', async () => {
    await start()
    expect(names()).not.toContain('    a.md')
    await newFileIn('/work/notes')
    expect(treeRows.value.some((row) => row.kind === 'new')).toBe(true)
    expect(expandedFolderPaths.value).toContain('/work/notes')
  })

  it('keeps the box open with the reason when the name is taken, and touches nothing', async () => {
    await start()
    await newFileIn('/work')
    await commitNaming('readme.md')
    expect(naming.value?.error).toContain('already exists')
    expect(host.files.read('/work/readme.md')).toBe('# readme\n')
    await commitNaming('README.MD')
    expect(naming.value?.error).toContain('already exists')
    expect(host.files.read('/work/readme.md')).toBe('# readme\n')
  })

  it('refuses a bad name without asking the host', async () => {
    await start()
    const create = vi.spyOn(host, 'createFile')
    await newFileIn('/work')
    for (const bad of ['', 'a/b', 'con.md', 'x.', '..']) {
      await commitNaming(bad)
      expect(naming.value?.error).toEqual(expect.any(String))
    }
    expect(create).not.toHaveBeenCalled()
  })

  it('makes nothing when the box is dropped', async () => {
    await start()
    const create = vi.spyOn(host, 'createFile')
    await newFileIn('/work')
    const { cancelNaming } = await import('@/features/tree/store')
    cancelNaming()
    await flush()
    expect(naming.value).toBeNull()
    expect(treeRows.value.some((row) => row.kind === 'new')).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
})

describe('a new folder (ISC-196)', () => {
  it('makes the folder and selects it', async () => {
    await start()
    await newFolderIn('/work')
    expect(treeRows.value[1]).toMatchObject({ kind: 'new', creates: 'folder' })
    await commitNaming('ideas')
    await flush()
    expect(host.files.isFolder('/work/ideas')).toBe(true)
    expect(names()).toContain('  ideas')
    expect(selectedPath.value).toBe('/work/ideas')
  })

  it('makes a folder inside a folder, and refuses a taken name', async () => {
    await start()
    await newFolderIn('/work/notes')
    await commitNaming('inner')
    await flush()
    expect(host.files.isFolder('/work/notes/inner')).toBe(true)
    await newFolderIn('/work/notes')
    await commitNaming('inner')
    expect(naming.value?.error).toContain('already exists')
  })
})

describe('renaming (ISC-101)', () => {
  it('turns the row into a box and renames the file', async () => {
    await start()
    await renameRow('/work/readme.md')
    expect(naming.value).toMatchObject({ kind: 'rename', path: '/work/readme.md' })
    await commitNaming('intro.md')
    await flush()
    expect(host.files.has('/work/readme.md')).toBe(false)
    expect(host.files.read('/work/intro.md')).toBe('# readme\n')
    expect(names()).toContain('  intro.md')
    expect(names()).not.toContain('  readme.md')
    expect(selectedPath.value).toBe('/work/intro.md')
    expect(naming.value).toBeNull()
  })

  it('does nothing for an unchanged name', async () => {
    await start()
    const rename = vi.spyOn(host, 'renameEntry')
    await renameRow('/work/readme.md')
    await commitNaming('readme.md')
    expect(rename).not.toHaveBeenCalled()
    expect(naming.value).toBeNull()
  })

  it('keeps the box open when the name is taken, and both files stay', async () => {
    await start()
    await renameRow('/work/notes/a.md')
    await commitNaming('b.md')
    expect(naming.value?.error).toContain('already exists')
    expect(host.files.read('/work/notes/a.md')).toBe('# a\n')
    expect(host.files.read('/work/notes/b.md')).toBe('# b\n')
  })

  it('allows a change of case alone', async () => {
    await start()
    await renameRow('/work/readme.md')
    await commitNaming('README.md')
    await flush()
    expect(host.files.paths().filter((path) => path.toLowerCase() === '/work/readme.md')).toEqual([
      '/work/README.md',
    ])
    expect(naming.value).toBeNull()
  })

  it('does not rename a workspace root', async () => {
    await start()
    await renameRow('/work')
    expect(naming.value).toBeNull()
  })

  it('keeps a renamed folder open, with its open folders, at the new place', async () => {
    await start(['/work/notes', '/work/notes/deep'])
    expect(names()).toContain('      c.md')
    await renameRow('/work/notes')
    await commitNaming('journal')
    await flush()
    expect(names()).toContain('  journal')
    expect(names()).toContain('    deep')
    expect(names()).toContain('      c.md')
    expect(expandedFolderPaths.value).toEqual(['/work', '/work/journal', '/work/journal/deep'])
    expect(host.files.has('/work/notes/a.md')).toBe(false)
    expect(host.files.read('/work/journal/deep/c.md')).toBe('# c\n')
  })
})

describe('open documents follow their file (ISC-219)', () => {
  const lf: Endings = { dominant: LF, at: [], codes: [] }

  it('a renamed file keeps its tab, shows the new name, and saves to the new path', async () => {
    await start()
    await openPath('/work/notes/a.md')
    const id = idAt('/work/notes/a.md')
    await renameRow('/work/notes/a.md')
    await commitNaming('first.md')
    await flush()
    expect(docMeta(id)).toMatchObject({ name: 'first.md', path: '/work/notes/first.md' })
    await (await import('@/platform')).getHost().then((h) => h.saveFile(id, 'changed\n', lf))
    expect(host.files.read('/work/notes/first.md')).toBe('changed\n')
    expect(host.files.has('/work/notes/a.md')).toBe(false)
  })

  it('a moved file does the same', async () => {
    await start()
    await openPath('/work/notes/a.md')
    const id = idAt('/work/notes/a.md')
    await moveRow('/work/notes/a.md', '/work/empty')
    await flush()
    expect(docMeta(id)?.path).toBe('/work/empty/a.md')
    await (await import('@/platform')).getHost().then((h) => h.saveFile(id, 'moved\n', lf))
    expect(host.files.read('/work/empty/a.md')).toBe('moved\n')
    expect(host.files.has('/work/notes/a.md')).toBe(false)
  })

  it('every open file in a renamed or moved folder follows, and the others stay put', async () => {
    await start()
    for (const path of ['/work/notes/deep/c.md', '/work/notes/b.md', '/work/readme.md']) {
      await openPath(path)
    }
    const [deep, top, other] = [
      idAt('/work/notes/deep/c.md'),
      idAt('/work/notes/b.md'),
      idAt('/work/readme.md'),
    ]
    await renameRow('/work/notes')
    await commitNaming('journal')
    await flush()
    await moveRow('/work/journal', '/work/empty')
    await flush()
    expect(docMeta(deep)?.path).toBe('/work/empty/journal/deep/c.md')
    expect(docMeta(top)?.path).toBe('/work/empty/journal/b.md')
    expect(docMeta(other)?.path).toBe('/work/readme.md')
    const h = await (await import('@/platform')).getHost()
    await h.saveFile(deep, 'deep\n', lf)
    await h.saveFile(top, 'top\n', lf)
    expect(host.files.read('/work/empty/journal/deep/c.md')).toBe('deep\n')
    expect(host.files.read('/work/empty/journal/b.md')).toBe('top\n')
    expect(host.files.has('/work/notes/b.md')).toBe(false)
    expect(host.files.has('/work/journal/b.md')).toBe(false)
  })

  it('an image tab follows a rename, a move, and a folder that holds it, and others stay put', async () => {
    await start()
    for (const path of ['/work/notes/deep/p.png', '/work/notes/q.png', '/work/o.png']) {
      host.files.write(path, 'png')
      await openPath(path)
    }
    const paths = (): string[] =>
      imageTabs()
        .map(([, tab]) => tab.path)
        .sort()
    expect(paths()).toEqual(['/work/notes/deep/p.png', '/work/notes/q.png', '/work/o.png'].sort())
    await renameRow('/work/notes/q.png')
    await commitNaming('r.png')
    await flush()
    await renameRow('/work/notes')
    await commitNaming('journal')
    await flush()
    await moveRow('/work/journal', '/work/empty')
    await flush()
    expect(paths()).toEqual(
      ['/work/empty/journal/deep/p.png', '/work/empty/journal/r.png', '/work/o.png'].sort(),
    )
    // The moved tab still names a file that is there.
    expect(host.files.has('/work/empty/journal/r.png')).toBe(true)
  })
})

describe('moving (ISC-102)', () => {
  it('moves a file into another folder and shows it there', async () => {
    await start(['/work/notes'])
    await moveRow('/work/readme.md', '/work/notes')
    await flush()
    expect(host.files.read('/work/notes/readme.md')).toBe('# readme\n')
    expect(host.files.has('/work/readme.md')).toBe(false)
    expect(names()).toContain('    readme.md')
    expect(names()).not.toContain('  readme.md')
    expect(selectedPath.value).toBe('/work/notes/readme.md')
  })

  it('moves a folder with everything in it', async () => {
    await start()
    await moveRow('/work/notes', '/work/empty')
    await flush()
    expect(host.files.read('/work/empty/notes/deep/c.md')).toBe('# c\n')
    expect(host.files.read('/work/empty/notes/a.md')).toBe('# a\n')
    expect(host.files.has('/work/notes/a.md')).toBe(false)
  })

  it('refuses a folder into itself or below it, and a folder it is already in, without asking', async () => {
    await start()
    const move = vi.spyOn(host, 'moveEntry')
    await moveRow('/work/notes', '/work/notes')
    expect(toasts.last).toContain('into itself')
    await moveRow('/work/notes', '/work/notes/deep')
    expect(toasts.last).toContain('into itself')
    await moveRow('/work/readme.md', '/work')
    expect(toasts.last).toContain('already in')
    expect(move).not.toHaveBeenCalled()
  })

  it('says so when the name is taken there, and moves nothing', async () => {
    await start()
    host.files.write('/work/empty/readme.md', 'already here')
    await moveRow('/work/readme.md', '/work/empty')
    expect(toasts.last).toContain('already exists')
    expect(host.files.read('/work/readme.md')).toBe('# readme\n')
    expect(host.files.read('/work/empty/readme.md')).toBe('already here')
  })

  it('refuses a target outside the workspace', async () => {
    await start()
    await moveRow('/work/readme.md', '/outside')
    expect(toasts.last).toContain('not allowed')
    expect(host.files.has('/work/readme.md')).toBe(true)
    expect(host.files.has('/outside/readme.md')).toBe(false)
  })
})

describe('deleting (ISC-103)', () => {
  it('sends a file to the Recycle Bin and takes its row away', async () => {
    await start()
    await deleteRow('/work/Zeta.txt')
    await flush()
    expect(host.files.has('/work/Zeta.txt')).toBe(false)
    expect(host.recycled).toEqual([{ path: '/work/Zeta.txt', raw: 'z' }])
    expect(names()).not.toContain('  Zeta.txt')
  })

  it('sends a folder with all its files, and clears a selection inside it', async () => {
    await start(['/work/notes'])
    selectedPath.value = '/work/notes/a.md'
    await deleteRow('/work/notes')
    await flush()
    expect(host.recycled.map((file) => file.path).sort()).toEqual([
      '/work/notes/a.md',
      '/work/notes/b.md',
      '/work/notes/deep/c.md',
    ])
    expect(selectedPath.value).toBeNull()
    expect(expandedFolderPaths.value).toEqual(['/work'])
  })

  it('keeps the file and says why when the host cannot recycle it', async () => {
    await start()
    vi.spyOn(host, 'deleteEntry').mockRejectedValue(new Error('no Recycle Bin on this drive'))
    await deleteRow('/work/Zeta.txt')
    await flush()
    expect(toasts.last).toContain('no Recycle Bin')
    expect(host.files.has('/work/Zeta.txt')).toBe(true)
    expect(names()).toContain('  Zeta.txt')
  })

  it('refuses a workspace root', async () => {
    await start()
    await deleteRow('/work')
    expect(toasts.last).toContain('Remove Folder')
    expect(host.recycled).toEqual([])
  })
})

describe('reveal in the file manager (ISC-104)', () => {
  it('asks the host to show the path', async () => {
    await start()
    await revealInFileManager('/work/notes/a.md')
    expect(host.revealed).toEqual(['/work/notes/a.md'])
  })

  it('says so when the path is outside the workspace', async () => {
    await start()
    await revealInFileManager('/outside/o.md')
    expect(toasts.last).toContain('not allowed')
    expect(host.revealed).toEqual([])
  })
})

describe('the drawn tree', () => {
  /** A fake pointer event the row's listener understands. */
  function pointer(type: string, init: { x: number; y: number }): MouseEvent {
    return new MouseEvent(type, { bubbles: true, button: 0, clientX: init.x, clientY: init.y })
  }

  function row(root: HTMLElement, path: string): HTMLElement {
    const found = root.querySelector<HTMLElement>(`[data-row-path="${path}"]`)
    if (found === null) throw new Error(`no row for ${path}`)
    return found
  }

  async function ready(open: readonly string[] = ['/work/notes']): Promise<HTMLElement> {
    await start(open)
    const root = mountTree()
    await flush()
    return root
  }

  it('F2 renames the selected row and Enter keeps the name', async () => {
    const root = await ready()
    row(root, '/work/readme.md').click()
    await flush()
    const tree = root.querySelector<HTMLElement>('[data-file-tree]')
    tree?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
    await flush()
    const input = root.querySelector<HTMLInputElement>('[data-name-input]')
    expect(input?.value).toBe('readme.md')
    expect(input?.selectionEnd).toBe('readme'.length)
    if (input === null) throw new Error('no box')
    input.value = 'intro.md'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flush()
    expect(host.files.has('/work/intro.md')).toBe(true)
    expect(root.querySelector('[data-name-input]')).toBeNull()
  })

  it('shows no tooltip over a row that is a name box (ISC-222)', async () => {
    const root = await ready()
    await renameRow('/work/readme.md')
    await flush()
    const box = root.querySelector('[data-name-input]')
    const rowEl = box?.closest('[data-kind]')
    if (!rowEl) throw new Error('no row')
    rowEl.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    await flush()
    expect(document.body.querySelector('[data-hover-hint]')).toBeNull()
  })

  it('Escape drops the box and so does leaving it', async () => {
    const root = await ready()
    await renameRow('/work/readme.md')
    await flush()
    const input = root.querySelector<HTMLInputElement>('[data-name-input]')
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    expect(naming.value).toBeNull()
    await newFileIn('/work')
    await flush()
    root.querySelector<HTMLInputElement>('[data-name-input]')?.dispatchEvent(new FocusEvent('blur'))
    await flush()
    expect(naming.value).toBeNull()
    expect(host.files.has('/work/readme.md')).toBe(true)
  })

  it('shows the reason under a box whose name was refused', async () => {
    const root = await ready()
    await renameRow('/work/notes/a.md')
    await flush()
    await commitNaming('b.md')
    await flush()
    expect(root.querySelector('[data-name-error]')?.textContent).toContain('already exists')
  })

  it('the Delete key sends the selected row to the Recycle Bin', async () => {
    const root = await ready()
    row(root, '/work/Zeta.txt').click()
    await flush()
    root
      .querySelector('[data-file-tree]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await flush()
    // It asks first; nothing is gone yet (ISC-227).
    expect(deletePrompt.value?.path).toBe('/work/Zeta.txt')
    expect(host.recycled).toEqual([])
    await confirmDelete()
    await flush()
    expect(host.recycled.map((file) => file.path)).toEqual(['/work/Zeta.txt'])
  })

  it('Delete in the context menu asks first, like the key (ISC-227)', async () => {
    const root = await ready()
    row(root, '/work/Zeta.txt').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
    )
    await flush()
    const item = [...document.body.querySelectorAll<HTMLElement>('[role=menuitem]')].find((el) =>
      el.textContent.trim().startsWith('Delete'),
    )
    expect(item).toBeDefined()
    item?.click()
    await flush()
    expect(deletePrompt.value?.path).toBe('/work/Zeta.txt')
    expect(host.recycled).toEqual([])
  })

  it('Delete and F2 do nothing while a name is being typed', async () => {
    const root = await ready()
    row(root, '/work/Zeta.txt').click()
    await newFileIn('/work')
    await flush()
    // From the box itself the key never reaches the tree; from the tree it must still do nothing.
    const input = root.querySelector<HTMLInputElement>('[data-name-input]')
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    const tree = root.querySelector('[data-file-tree]')
    tree?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    tree?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
    await flush()
    expect(host.recycled).toEqual([])
    expect(naming.value?.kind).toBe('new-file')
  })

  it('dragging a row onto a folder moves it, and a short press only clicks (ISC-102)', async () => {
    const root = await ready()
    try {
      document.elementFromPoint = () => row(root, '/work/notes')
      row(root, '/work/readme.md').dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }))
      window.dispatchEvent(pointer('pointermove', { x: 11, y: 11 }))
      window.dispatchEvent(pointer('pointerup', { x: 11, y: 11 }))
      await flush()
      expect(host.files.has('/work/readme.md')).toBe(true)

      row(root, '/work/readme.md').dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }))
      window.dispatchEvent(pointer('pointermove', { x: 40, y: 60 }))
      await flush()
      expect(row(root, '/work/notes').dataset.dropTarget).toBeDefined()
      expect(row(root, '/work/readme.md').dataset.dragging).toBeDefined()
      window.dispatchEvent(pointer('pointerup', { x: 40, y: 60 }))
      await flush()
      expect(host.files.read('/work/notes/readme.md')).toBe('# readme\n')
      expect(host.files.has('/work/readme.md')).toBe(false)
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint')
    }
  })

  it('a drag over a place it cannot go marks nothing and moves nothing; Escape cancels', async () => {
    const root = await ready()
    try {
      // Over its own folder: no target.
      document.elementFromPoint = () => row(root, '/work')
      row(root, '/work/readme.md').dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }))
      window.dispatchEvent(pointer('pointermove', { x: 40, y: 60 }))
      await flush()
      expect(root.querySelector('[data-drop-target]')).toBeNull()
      window.dispatchEvent(pointer('pointerup', { x: 40, y: 60 }))
      await flush()
      expect(host.files.has('/work/readme.md')).toBe(true)

      document.elementFromPoint = () => row(root, '/work/notes')
      row(root, '/work/readme.md').dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }))
      window.dispatchEvent(pointer('pointermove', { x: 40, y: 60 }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      window.dispatchEvent(pointer('pointerup', { x: 40, y: 60 }))
      await flush()
      expect(host.files.has('/work/readme.md')).toBe(true)
      expect(root.querySelector('[data-dragging]')).toBeNull()
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint')
    }
  })

  it('a folder cannot be dragged into its own subfolder', async () => {
    const root = await ready(['/work/notes', '/work/notes/deep'])
    try {
      document.elementFromPoint = () => row(root, '/work/notes/deep')
      row(root, '/work/notes').dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }))
      window.dispatchEvent(pointer('pointermove', { x: 40, y: 60 }))
      await flush()
      expect(root.querySelector('[data-drop-target]')).toBeNull()
      window.dispatchEvent(pointer('pointerup', { x: 40, y: 60 }))
      await flush()
      expect(host.files.has('/work/notes/a.md')).toBe(true)
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint')
    }
  })

  it('does not toggle a folder whose drag just ended on it', async () => {
    const root = await ready()
    try {
      document.elementFromPoint = () => row(root, '/work/notes')
      row(root, '/work/readme.md').dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }))
      window.dispatchEvent(pointer('pointermove', { x: 40, y: 60 }))
      window.dispatchEvent(pointer('pointerup', { x: 40, y: 60 }))
      row(root, '/work/notes').click()
      // Checked before anything is awaited: the move opens the folder again a moment later, which
      // would hide a click that had closed it.
      expect(expandedFolderPaths.value).toContain('/work/notes')
      await flush()
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint')
    }
  })

  it('toggling a folder still works as before', async () => {
    const root = await ready([])
    await toggleFolder('/work/notes')
    await flush()
    expect(root.querySelector('[data-row-path="/work/notes/a.md"]')).not.toBeNull()
  })
})

describe('asking before a delete (ISC-227)', () => {
  it('asks first and deletes nothing until the owner confirms', async () => {
    await start()
    await requestDelete('/work/Zeta.txt')
    expect(deletePrompt.value).toMatchObject({
      path: '/work/Zeta.txt',
      name: 'Zeta.txt',
      folder: false,
    })
    expect(host.recycled).toEqual([])
    expect(host.files.has('/work/Zeta.txt')).toBe(true)
    await confirmDelete()
    await flush()
    expect(deletePrompt.value).toBeNull()
    expect(host.recycled.map((file) => file.path)).toEqual(['/work/Zeta.txt'])
  })

  it('leaves the file alone when the owner cancels', async () => {
    await start()
    await requestDelete('/work/Zeta.txt')
    cancelDelete()
    await flush()
    expect(deletePrompt.value).toBeNull()
    expect(host.recycled).toEqual([])
    expect(host.files.has('/work/Zeta.txt')).toBe(true)
  })

  it('says a folder is a folder, and does not ask about a workspace root', async () => {
    await start(['/work/notes'])
    await requestDelete('/work/notes')
    expect(deletePrompt.value?.folder).toBe(true)
    cancelDelete()
    await requestDelete('/work')
    expect(deletePrompt.value).toBeNull()
    expect(toasts.last).toContain('Remove Folder')
  })
})

describe('deleting closes the tabs (ISC-228)', () => {
  const tabsOf = (path: string): string[] =>
    allDocuments()
      .filter((doc) => doc.path === path)
      .map((doc) => doc.id.toString())

  it('closes the tab of a deleted file, and the prompt counts it', async () => {
    await start()
    await openPath('/work/notes/a.md')
    await requestDelete('/work/notes/a.md')
    expect(deletePrompt.value).toMatchObject({ tabs: 1, unsaved: 0 })
    await confirmDelete()
    await flush()
    expect(tabsOf('/work/notes/a.md')).toEqual([])
    expect(allDocuments().filter((doc) => doc.path.startsWith('/work/notes/a.md'))).toEqual([])
  })

  it('closes every tab under a deleted folder, unsaved edits included, and counts them', async () => {
    await start()
    const a = await openPath('/work/notes/a.md')
    await openPath('/work/notes/deep/c.md')
    await openPath('/work/readme.md')
    followerOfTab(a)?.dispatch({ changes: { from: 0, insert: 'edited ' } })
    await flush()
    expect(documentOfTab(a)?.dirty).toBe(true)
    await requestDelete('/work/notes')
    expect(deletePrompt.value).toMatchObject({ tabs: 2, unsaved: 1 })
    await confirmDelete()
    await flush()
    expect(allDocuments().map((d) => d.path)).toEqual(['/work/readme.md'])
  })

  it('closes the image tabs under it, and keeps tabs elsewhere', async () => {
    await start()
    host.files.write('/work/notes/pic.png', 'png')
    await openPath('/work/notes/pic.png')
    await openPath('/work/readme.md')
    expect(imageTabs().length).toBe(1)
    await requestDelete('/work/notes')
    expect(deletePrompt.value?.tabs).toBe(1)
    await confirmDelete()
    await flush()
    expect(imageTabs()).toEqual([])
    expect(allDocuments().map((d) => d.path)).toEqual(['/work/readme.md'])
  })

  it('keeps every tab when the host cannot delete', async () => {
    await start()
    await openPath('/work/notes/a.md')
    vi.spyOn(host, 'deleteEntry').mockRejectedValue(new Error('no'))
    await deleteRow('/work/notes/a.md')
    await flush()
    expect(allDocuments().map((d) => d.path)).toEqual(['/work/notes/a.md'])
  })
})
