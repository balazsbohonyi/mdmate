// @vitest-environment jsdom
/**
 * ISC-194: the roots and the open folders come back after a restart. Rust keeps the roots (the mock
 * host keeps them across a "restart" the same way); the session keeps which folders were open.
 * ISC-195 (page side): a folder dropped from Explorer outside the tree becomes a root, and a path
 * no drop delivered is refused.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushSession, resetSession, restoreSession } from '@/documents/session'
import { openPath, problem, resetDocuments } from '@/documents/store'
import { handleDrop, installFileDrop } from '@/features/drop'
import {
  expandedFolderPaths,
  openFolderDialog,
  resetTree,
  toggleFolder,
  treeRows,
  workspaceRoots,
} from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'

const FILES: Record<string, string> = {
  '/work/notes/a.md': '# a\n',
  '/work/notes/deep/c.md': '# c\n',
  '/work/readme.md': '# readme\n',
  '/dropped/d.md': '# d\n',
  '/elsewhere/e.md': '# e\n',
}

let host: MockHost

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 4; round++) await settle()
}

function reset(): void {
  resetSession()
  resetDocuments()
  resetWorkbench()
  resetTree()
}

/** A new run: fresh page state, the same files, the session and the roots the old run left. */
function newRun(old: MockHost, session: string | null): MockHost {
  const next = createMockHost({
    files: Object.fromEntries(old.files.paths().map((path) => [path, old.files.read(path) ?? ''])),
    roots: old.roots,
  })
  next.session = session
  reset()
  setHost(next)
  host = next
  return next
}

function snapshotOf(from: MockHost): Record<string, unknown> {
  return JSON.parse(from.session ?? '{}') as Record<string, unknown>
}

/** jsdom has no hit testing; the page under test answers with whatever element it is told to. */
let hit: Element | null = null
/** What the folder dialog returns next, one entry per time it is shown. */
let picks: string[] = []

beforeEach(() => {
  hit = null
  document.elementFromPoint = () => hit
  picks = ['/work']
  host = createMockHost({ files: FILES, pickFolder: () => picks.shift() ?? null })
  setHost(host)
  reset()
})

afterEach(() => {
  reset()
  setHost(undefined)
})

describe('the workspace across a restart (ISC-194)', () => {
  it('brings back both roots and the folders that were open, and their files', async () => {
    picks = ['/work', '/dropped']
    await restoreSession()
    await openFolderDialog()
    await openFolderDialog()
    await flush()
    await toggleFolder('/work/notes')
    await toggleFolder('/work/notes/deep')
    await flush()
    await flushSession()
    const session = host.session

    newRun(host, session)
    await restoreSession()
    await flush()

    expect(workspaceRoots.value).toEqual(['/work', '/dropped'])
    expect(expandedFolderPaths.value).toEqual([
      '/dropped',
      '/work',
      '/work/notes',
      '/work/notes/deep',
    ])
    expect(treeRows.value.map((row) => row.name)).toContain('c.md')
    expect(treeRows.value.map((row) => row.name)).toContain('d.md')
  })

  it('brings back the roots even when the session file is missing or damaged', async () => {
    await restoreSession()
    await openFolderDialog()
    await flush()
    for (const damaged of [null, '{not json', '{"version":1}']) {
      newRun(host, damaged)
      await restoreSession()
      await flush()
      expect(workspaceRoots.value, String(damaged)).toEqual(['/work'])
    }
  })

  it('restores a session from before the workspace existed', async () => {
    await openPath('/work/readme.md')
    await flushSession()
    const old = snapshotOf(host)
    delete old.workspace
    newRun(host, JSON.stringify(old))
    const report = await restoreSession()
    expect(report?.tabs).toBe(1)
    expect(workspaceRoots.value).toEqual([])
  })

  it('ignores a remembered folder that is outside every root', async () => {
    await restoreSession()
    await openFolderDialog()
    await flush()
    await flushSession()
    const snapshot = snapshotOf(host)
    snapshot.workspace = { expanded: ['/elsewhere', '/work/notes'] }
    newRun(host, JSON.stringify(snapshot))
    await restoreSession()
    await flush()
    expect(expandedFolderPaths.value).toEqual(['/work', '/work/notes'])
  })

  it('does not let a session snapshot add a root', async () => {
    await restoreSession()
    await flushSession()
    const snapshot = snapshotOf(host)
    snapshot.workspace = { roots: ['/elsewhere'], expanded: ['/elsewhere'] }
    newRun(host, JSON.stringify(snapshot))
    await restoreSession()
    await flush()
    expect(workspaceRoots.value).toEqual([])
    expect(host.roots).toEqual([])
  })
})

describe('dropping a folder from Explorer (ISC-195, page side)', () => {
  it('makes a folder dropped outside the tree a root', async () => {
    await restoreSession()
    await installFileDrop()
    host.simulateDrop(['/dropped'], { x: 5, y: 5 })
    await flush()
    expect(workspaceRoots.value).toEqual(['/dropped'])
    expect(treeRows.value.map((row) => row.name)).toContain('d.md')
    expect(problem.value).toBeNull()
  })

  it('makes a root of a folder dropped on a pane, over the editor', async () => {
    await restoreSession()
    await installFileDrop()
    const pane = document.createElement('div')
    pane.dataset.pane = ''
    hit = pane
    host.simulateDrop(['/dropped'], { x: 600, y: 300 })
    await flush()
    expect(workspaceRoots.value).toEqual(['/dropped'])
  })

  it('does not make a root of a folder dropped onto the tree', async () => {
    await restoreSession()
    await installFileDrop()
    const tree = document.createElement('div')
    tree.dataset.fileTree = ''
    const row = document.createElement('div')
    tree.append(row)
    hit = row
    host.simulateDrop(['/dropped'], { x: 5, y: 5 })
    await flush()
    expect(workspaceRoots.value).toEqual([])
  })

  it('does nothing for a drag that is not a drop', async () => {
    await restoreSession()
    await installFileDrop()
    host.simulateDrag({ type: 'over', position: { x: 1, y: 1 } })
    await flush()
    expect(workspaceRoots.value).toEqual([])
  })

  it('refuses a path no drop delivered, however the page asks', async () => {
    await restoreSession()
    await handleDrop(['/elsewhere'], { x: 0, y: 0 })
    expect(workspaceRoots.value).toEqual([])
    expect(host.roots).toEqual([])
    expect(problem.value).toMatch(/not allowed/)
  })

  it('does not make a dropped file a root', async () => {
    await restoreSession()
    await installFileDrop()
    host.simulateDrop(['/work/readme.md'])
    await flush()
    expect(workspaceRoots.value).toEqual([])
    expect(problem.value).toBeNull()
  })
})
