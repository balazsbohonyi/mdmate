// @vitest-environment jsdom
/**
 * Copy on drop (P6-T2): ISC-197 (files dropped on a tree folder are copied into it), ISC-198
 * (a folder is copied whole) and ISC-199 (a name that is taken offers Replace, Keep both and Skip),
 * from the page's side. A native drop is simulated by the mock host, which records the paths the
 * way Rust's drop record does; the folder under the pointer is found through the row it is over.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App, type Component } from 'vue'
import { problem, resetDocuments } from '@/documents/store'
import { handleDrop, installFileDrop } from '@/features/drop'
import CopyBanner from '@/features/tree/CopyBanner.vue'
import { answerClash, cancelCopy, copyDropInto, copyPrompt } from '@/features/tree/ops'
import {
  resetTree,
  restoreWorkspace,
  selectedPath,
  treeRows,
  workspaceRoots,
} from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 4; round++) {
    await settle()
    await nextTick()
  }
}

const FILES: Record<string, string> = {
  '/work/dest/keep.md': 'old keep',
  '/work/dest/rep.md': 'old rep',
  '/work/dest/skip.md': 'old skip',
  '/work/dest/sub/inner.md': 'inner',
  '/work/top.md': 'top',
  '/outside/new.md': 'new',
  '/outside/keep.md': 'new keep',
  '/outside/rep.md': 'new rep',
  '/outside/skip.md': 'new skip',
  '/outside/tree/one.md': '1',
  '/outside/tree/sub/two.md': '2',
  '/outside/tree/sub/deeper/three.png': '3',
  '/elsewhere/never.md': 'never dropped',
}

let host: MockHost
let hit: Element | null = null
let mounted: { app: App; root: HTMLElement }[] = []

/** A row of the tree as the drop handler reads it: a path and a kind, inside the tree. */
function treeRow(path: string, kind: 'file' | 'folder' | 'root'): Element {
  const tree = document.createElement('div')
  tree.dataset.fileTree = ''
  const row = document.createElement('div')
  row.dataset.rowPath = path
  row.dataset.kind = kind
  tree.append(row)
  return row
}

function mount(component: Component): HTMLElement {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(component)
  app.mount(root)
  mounted.push({ app, root })
  return root
}

async function start(): Promise<void> {
  host = createMockHost({ files: FILES, roots: ['/work'] })
  setHost(host)
  await restoreWorkspace(['/work/dest'])
  await flush()
  await installFileDrop()
  document.elementFromPoint = () => hit
}

function dropOn(target: Element | null, paths: string[]): Promise<void> {
  hit = target
  host.simulateDrop(paths, { x: 5, y: 5 })
  return flush()
}

function names(): string[] {
  return treeRows.value.map((row) => `${'  '.repeat(row.depth)}${row.name}`)
}

beforeEach(() => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  problem.value = null
  copyPrompt.value = null
})

afterEach(() => {
  for (const { app, root } of mounted) {
    app.unmount()
    root.remove()
  }
  mounted = []
  Reflect.deleteProperty(document, 'elementFromPoint')
  hit = null
  setHost(undefined)
  resetTree()
  copyPrompt.value = null
  vi.restoreAllMocks()
})

describe('dropping files on a folder of the tree (ISC-197)', () => {
  it('copies them in, leaves the sources, shows and selects the copies, and opens nothing', async () => {
    await start()
    await dropOn(treeRow('/work/dest', 'folder'), ['/outside/new.md'])
    expect(host.files.read('/work/dest/new.md')).toBe('new')
    expect(host.files.read('/outside/new.md')).toBe('new')
    expect(names()).toContain('    new.md')
    expect(selectedPath.value).toBe('/work/dest/new.md')
    expect(host.openDocuments().size).toBe(0)
    expect(problem.value).toBeNull()
  })

  it('copies several at once', async () => {
    await start()
    await dropOn(
      treeRow('/work/dest', 'folder'),
      ['/outside/new.md', '/elsewhere/never.md'].slice(0, 1),
    )
    await dropOn(treeRow('/work', 'root'), ['/outside/new.md'])
    expect(host.files.read('/work/new.md')).toBe('new')
  })

  it('a drop on a file copies into the folder holding it', async () => {
    await start()
    await dropOn(treeRow('/work/dest/keep.md', 'file'), ['/outside/new.md'])
    expect(host.files.read('/work/dest/new.md')).toBe('new')
  })

  it('a drop on a root copies into the root', async () => {
    await start()
    await dropOn(treeRow('/work', 'root'), ['/outside/new.md'])
    expect(host.files.read('/work/new.md')).toBe('new')
  })

  it('refuses a path no drop delivered, however the page asks', async () => {
    await start()
    await handleDrop(['/elsewhere/never.md'], { x: 5, y: 5 })
    await copyDropInto('/work/dest', ['/elsewhere/never.md'])
    expect(host.files.has('/work/dest/never.md')).toBe(false)
    expect(problem.value).toContain('not allowed')
  })

  it('refuses a folder outside the workspace as the place to copy to', async () => {
    await start()
    host.simulateDrop(['/outside/new.md'])
    await flush()
    await copyDropInto('/outside/tree', ['/outside/new.md'])
    expect(host.files.has('/outside/tree/new.md')).toBe(false)
    expect(problem.value).toContain('not allowed')
  })
})

describe('dropping a folder on a folder of the tree (ISC-198)', () => {
  it('copies it whole, every file at every depth', async () => {
    await start()
    await dropOn(treeRow('/work', 'root'), ['/outside/tree'])
    expect(host.files.read('/work/tree/one.md')).toBe('1')
    expect(host.files.read('/work/tree/sub/two.md')).toBe('2')
    expect(host.files.read('/work/tree/sub/deeper/three.png')).toBe('3')
    expect(host.files.read('/outside/tree/sub/two.md')).toBe('2')
    expect(workspaceRoots.value).toEqual(['/work'])
    expect(selectedPath.value).toBe('/work/tree')
  })

  it('a folder dropped on the empty space of the tree still becomes a root', async () => {
    await start()
    const blank = document.createElement('div')
    blank.dataset.fileTree = ''
    await dropOn(blank, ['/outside/tree'])
    expect(workspaceRoots.value).toEqual(['/work', '/outside/tree'])
    expect(host.files.has('/work/tree/one.md')).toBe(false)
  })
})

describe('a name that is taken (ISC-199)', () => {
  const drop = (): Promise<void> =>
    dropOn(treeRow('/work/dest', 'folder'), [
      '/outside/keep.md',
      '/outside/rep.md',
      '/outside/skip.md',
      '/outside/new.md',
    ])

  it('asks about each taken name and copies nothing until every one is answered', async () => {
    await start()
    await drop()
    expect(copyPrompt.value?.clashes).toEqual(['keep.md', 'rep.md', 'skip.md'])
    expect(host.files.has('/work/dest/new.md')).toBe(false)
    expect(host.files.read('/work/dest/keep.md')).toBe('old keep')
    await answerClash('keep-both')
    await answerClash('replace')
    expect(copyPrompt.value).not.toBeNull()
    expect(host.files.has('/work/dest/new.md')).toBe(false)
    await answerClash('skip')
    await flush()
    expect(copyPrompt.value).toBeNull()
  })

  it('does what each answer says: Replace recycles the old file first, Keep both numbers the copy, Skip leaves it', async () => {
    await start()
    await drop()
    await answerClash('keep-both')
    await answerClash('replace')
    await answerClash('skip')
    await flush()
    expect(host.files.read('/work/dest/keep.md')).toBe('old keep')
    expect(host.files.read('/work/dest/keep (2).md')).toBe('new keep')
    expect(host.files.read('/work/dest/rep.md')).toBe('new rep')
    expect(host.recycled).toEqual([{ path: '/work/dest/rep.md', raw: 'old rep' }])
    expect(host.files.read('/work/dest/skip.md')).toBe('old skip')
    expect(host.files.read('/work/dest/new.md')).toBe('new')
  })

  it('apply to all answers every name left the same way', async () => {
    await start()
    await drop()
    await answerClash('keep-both', true)
    await flush()
    expect(copyPrompt.value).toBeNull()
    expect(host.files.read('/work/dest/keep (2).md')).toBe('new keep')
    expect(host.files.read('/work/dest/rep (2).md')).toBe('new rep')
    expect(host.files.read('/work/dest/skip (2).md')).toBe('new skip')
    expect(host.recycled).toEqual([])
  })

  it('apply to all only covers the names after the one answered first', async () => {
    await start()
    await drop()
    await answerClash('replace')
    await answerClash('skip', true)
    await flush()
    expect(host.files.read('/work/dest/keep.md')).toBe('new keep')
    expect(host.files.read('/work/dest/rep.md')).toBe('old rep')
    expect(host.files.read('/work/dest/skip.md')).toBe('old skip')
  })

  it('Cancel copies nothing, not even the names that were free', async () => {
    await start()
    await drop()
    cancelCopy()
    await flush()
    expect(copyPrompt.value).toBeNull()
    expect(host.files.has('/work/dest/new.md')).toBe(false)
    expect(host.files.read('/work/dest/rep.md')).toBe('old rep')
    expect(host.recycled).toEqual([])
  })

  it('a copy that is never answered replaces nothing', async () => {
    await start()
    const h = host
    await h.copyDropped('/work/dest', ['/outside/rep.md'], []).catch(() => undefined)
    // Not delivered by a drop yet, so refused; then delivered and sent without an answer.
    h.simulateDrop(['/outside/rep.md', '/outside/keep.md'])
    const report = await h.copyDropped('/work/dest', ['/outside/rep.md', '/outside/keep.md'], [])
    expect(report.skipped).toEqual(['rep.md', 'keep.md'])
    expect(report.copied).toEqual([])
    expect(h.files.read('/work/dest/rep.md')).toBe('old rep')
    expect(h.recycled).toEqual([])
  })

  it('a second drop while a question is open is ignored', async () => {
    await start()
    await drop()
    const before = copyPrompt.value
    await dropOn(treeRow('/work', 'root'), ['/outside/tree'])
    expect(copyPrompt.value).toBe(before)
    expect(host.files.has('/work/tree/one.md')).toBe(false)
    expect(problem.value).toContain('earlier drop')
  })

  it('copying a file onto itself keeps both, never replaces', async () => {
    await start()
    await dropOn(treeRow('/work/dest', 'folder'), ['/work/dest/keep.md'])
    expect(copyPrompt.value?.clashes).toEqual(['keep.md'])
    await answerClash('replace')
    await flush()
    expect(host.files.read('/work/dest/keep.md')).toBe('old keep')
    expect(host.files.read('/work/dest/keep (2).md')).toBe('old keep')
    expect(host.recycled).toEqual([])
  })

  it('a folder taken by a file cannot be replaced by it, and the old one stays', async () => {
    await start()
    host.files.write('/outside/sub', 'a file named like a folder')
    await dropOn(treeRow('/work/dest', 'folder'), ['/outside/sub'])
    await answerClash('replace')
    await flush()
    expect(problem.value).toContain('cannot replace each other')
    expect(host.files.read('/work/dest/sub/inner.md')).toBe('inner')
    expect(host.recycled).toEqual([])
  })

  it('the banner names the file and its buttons answer', async () => {
    await start()
    const banner = mount(CopyBanner)
    await drop()
    expect(banner.textContent).toContain('keep.md')
    expect(banner.textContent).toContain('dest')
    expect(banner.querySelector('[data-apply-all]')).not.toBeNull()
    banner.querySelector<HTMLElement>('[data-answer="skip"]')?.click()
    await flush()
    expect(banner.textContent).toContain('rep.md')
    banner.querySelector<HTMLElement>('[data-answer="cancel"]')?.click()
    await flush()
    expect(banner.querySelector('[data-copy-banner]')).toBeNull()
    expect(host.files.has('/work/dest/new.md')).toBe(false)
  })

  it('the banner offers apply to all only while more than one name waits', async () => {
    await start()
    const banner = mount(CopyBanner)
    await dropOn(treeRow('/work/dest', 'folder'), ['/outside/keep.md'])
    expect(banner.querySelector('[data-apply-all]')).toBeNull()
  })
})
