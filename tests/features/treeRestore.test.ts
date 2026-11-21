// @vitest-environment jsdom
/**
 * The sidebar comes back as it was left (P9.1-T18: ISC-619 to ISC-621). The roots come from the host
 * (Rust keeps them); the session says which places were open and whether the sidebar was shown. The
 * tree restore is driven both directly (`restoreWorkspace`) and through a session written by the
 * journal and read back, so the two halves agree.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushSession, resetSession, restoreSession } from '@/documents/session'
import { resetDocuments } from '@/documents/store'
import {
  expandedPlaces,
  resetTree,
  restoreWorkspace,
  toggleFolder,
  treeRows,
  workspaceRoots,
} from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import {
  resetSidebar,
  restoreSidebar,
  showSidebar,
  sidebarPanel,
  sidebarVisible,
} from '@/workbench/sidebar'
import { toggleSidebar } from '@/workbench/sidebar'
import { resetWorkbench } from '@/workbench/store'
import { toasts } from '../helpers/toasts'

const FILES: Record<string, string> = {
  '/work/a.md': '# a\n',
  '/work/notes/n.md': '# n\n',
  '/work/notes/deep/d.md': '# d\n',
  '/work/notes/deep/deeper/dd.md': '# dd\n',
  '/work/other/o.md': '# o\n',
  '/play/p.md': '# p\n',
  '/play/sub/s.md': '# s\n',
  '/third/t.md': '# t\n',
  '/third/inner/i.md': '# i\n',
}

const ROOTS = ['/work', '/play', '/third']

let host: MockHost

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 5; round++) await settle()
}

function reset(): void {
  resetSession()
  resetDocuments()
  resetWorkbench()
  resetTree()
  resetSidebar()
}

function start(roots: readonly string[] = ROOTS, extra: Record<string, string> = {}): MockHost {
  const next = createMockHost({ files: { ...FILES, ...extra }, roots })
  reset()
  setHost(next)
  host = next
  return next
}

/** A new run of the app: same files and roots, the session the old run left. */
function restart(old: MockHost): MockHost {
  const next = createMockHost({
    files: Object.fromEntries(old.files.paths().map((path) => [path, old.files.read(path) ?? ''])),
    roots: old.roots,
  })
  next.session = old.session
  reset()
  setHost(next)
  host = next
  return next
}

const open = (): string[] => expandedPlaces.value.map((place) => `${place.root}|${place.path}`)
const names = (): string[] => treeRows.value.map((row) => row.name)

beforeEach(() => {
  start()
})

afterEach(() => {
  reset()
  setHost(undefined)
})

describe('a root keeps the state it was left in (ISC-619)', () => {
  it('stays collapsed when every root was collapsed', async () => {
    await restoreWorkspace([], [])
    await flush()
    expect(workspaceRoots.value).toEqual(ROOTS)
    expect(open()).toEqual([])
    expect(treeRows.value.map((row) => row.kind)).toEqual(['root', 'root', 'root'])
  })

  it('opens the roots that were open and leaves the others collapsed', async () => {
    await restoreWorkspace(
      [],
      [
        { root: '/work', path: '/work' },
        { root: '/third', path: '/third' },
      ],
    )
    await flush()
    expect(open()).toEqual(['/third|/third', '/work|/work'])
    expect(names()).toContain('a.md')
    expect(names()).toContain('t.md')
    expect(names()).not.toContain('p.md')
  })

  it('opens every root one level on a first start, as before', async () => {
    await restoreWorkspace([])
    await flush()
    expect(open()).toEqual(['/play|/play', '/third|/third', '/work|/work'])
    expect(names()).toEqual(expect.arrayContaining(['a.md', 'p.md', 't.md']))
  })

  it('keeps today’s way for a session from before places: the roots open and the bare paths too', async () => {
    await restoreWorkspace(['/work/notes'])
    await flush()
    expect(open()).toEqual(['/play|/play', '/third|/third', '/work|/work', '/work|/work/notes'])
  })

  it('goes through a written session: collapse one root, restart, and it is collapsed', async () => {
    await restoreSession()
    await flush()
    expect(open()).toHaveLength(3)
    await toggleFolder('/play')
    await toggleFolder('/work')
    await flush()
    await flushSession()
    restart(host)
    await restoreSession()
    await flush()
    expect(open()).toEqual(['/third|/third'])
  })

  it('goes through a written session with every root collapsed', async () => {
    await restoreSession()
    await flush()
    for (const root of ROOTS) await toggleFolder(root)
    await flush()
    await flushSession()
    restart(host)
    await restoreSession()
    await flush()
    expect(open()).toEqual([])
    expect(workspaceRoots.value).toEqual(ROOTS)
  })

  it('opens each root as before when the session file is missing or damaged', async () => {
    for (const damaged of [null, '{not json']) {
      restart(host)
      host.session = damaged
      await restoreSession()
      await flush()
      expect(open(), String(damaged)).toHaveLength(3)
    }
  })
})

describe('folders open at any depth (ISC-620)', () => {
  it('opens exactly the saved folders, three levels down, with their files', async () => {
    await restoreWorkspace(
      [],
      [
        { root: '/work', path: '/work' },
        { root: '/work', path: '/work/notes' },
        { root: '/work', path: '/work/notes/deep' },
        { root: '/work', path: '/work/notes/deep/deeper' },
      ],
    )
    await flush()
    expect(open()).toHaveLength(4)
    expect(names()).toEqual(expect.arrayContaining(['n.md', 'd.md', 'dd.md']))
    // The sibling that was not open stays closed.
    expect(names()).toContain('other')
    expect(names()).not.toContain('o.md')
  })

  it('drops a folder that is gone, with no message, and keeps the rest', async () => {
    await restoreWorkspace(
      [],
      [
        { root: '/work', path: '/work' },
        { root: '/work', path: '/work/notes' },
        { root: '/work', path: '/work/vanished' },
        { root: '/work', path: '/work/vanished/deeper' },
      ],
    )
    await flush()
    expect(open()).toEqual(['/work|/work', '/work|/work/notes'])
    expect(toasts.messages).toEqual([])
    expect(names()).toContain('n.md')
  })

  it('a folder under two roots is two places, each with its own state', async () => {
    start(['/work', '/work/notes'])
    await restoreWorkspace(
      [],
      [
        { root: '/work', path: '/work' },
        { root: '/work', path: '/work/notes' },
        { root: '/work/notes', path: '/work/notes' },
        { root: '/work/notes', path: '/work/notes/deep' },
      ],
    )
    await flush()
    expect(open()).toEqual([
      '/work|/work',
      '/work|/work/notes',
      '/work/notes|/work/notes',
      '/work/notes|/work/notes/deep',
    ])
    // Only the inner root was collapsed on the next run: the copy under /work is still open.
    await flushSession()
    restart(host)
    await restoreWorkspace(
      [],
      [
        { root: '/work', path: '/work' },
        { root: '/work', path: '/work/notes' },
      ],
    )
    await flush()
    expect(open()).toEqual(['/work|/work', '/work|/work/notes'])
  })

  it('ignores a saved place whose root is not a root now, and one outside its root', async () => {
    await restoreWorkspace(
      [],
      [
        { root: '/gone', path: '/gone' },
        { root: '/work', path: '/elsewhere/x' },
        { root: '/work', path: '/work' },
      ],
    )
    await flush()
    expect(open()).toEqual(['/work|/work'])
  })

  it('goes through a written session with folders three levels deep and one removed afterwards', async () => {
    await restoreSession()
    await flush()
    for (const folder of ['/work/notes', '/work/notes/deep', '/work/notes/deep/deeper']) {
      await toggleFolder(folder)
    }
    await flush()
    await flushSession()
    const next = restart(host)
    next.files.remove('/work/notes/deep/deeper')
    await restoreSession()
    await flush()
    expect(open()).toContain('/work|/work/notes/deep')
    expect(toasts.messages).toEqual([])
  })
})

describe('the sidebar panel and whether it is shown (ISC-621)', () => {
  it('comes back hidden', async () => {
    await restoreSession()
    toggleSidebar()
    expect(sidebarVisible.value).toBe(false)
    await flushSession()
    restart(host)
    await restoreSession()
    expect(sidebarVisible.value).toBe(false)
    expect(sidebarPanel.value).toBe('folders')
  })

  it('comes back with the Outline or the Search panel active', async () => {
    for (const panel of ['outline', 'search'] as const) {
      start()
      await restoreSession()
      showSidebar(panel)
      await flushSession()
      restart(host)
      await restoreSession()
      expect(sidebarPanel.value, panel).toBe(panel)
      expect(sidebarVisible.value, panel).toBe(true)
    }
  })

  it('comes back hidden with its panel kept', async () => {
    await restoreSession()
    showSidebar('outline')
    toggleSidebar()
    await flushSession()
    restart(host)
    await restoreSession()
    expect(sidebarVisible.value).toBe(false)
    expect(sidebarPanel.value).toBe('outline')
  })

  it('brings the References list back as the folders, which is all it can show', async () => {
    await restoreSession()
    showSidebar('references')
    await flushSession()
    expect(JSON.parse(host.session ?? '{}')).toMatchObject({ workspace: {} })
    expect(host.session).not.toContain('sidebarPanel')
    restart(host)
    await restoreSession()
    expect(sidebarPanel.value).toBe('folders')
    restoreSidebar(true, 'references')
    expect(sidebarPanel.value).toBe('folders')
  })

  it('shows the sidebar with the folders for a session without these values', async () => {
    await restoreSession()
    await flushSession()
    const written = JSON.parse(host.session ?? '{}') as { workspace: Record<string, unknown> }
    expect(written.workspace).not.toHaveProperty('sidebarVisible')
    expect(written.workspace).not.toHaveProperty('sidebarPanel')
    showSidebar('search')
    toggleSidebar()
    restart(host)
    await restoreSession()
    expect(sidebarVisible.value).toBe(true)
    expect(sidebarPanel.value).toBe('folders')
  })

  it('does not trust a value that is not a panel or a flag', async () => {
    await restoreSession()
    await flushSession()
    const snapshot = JSON.parse(host.session ?? '{}') as { workspace: Record<string, unknown> }
    snapshot.workspace.sidebarPanel = 'terminal'
    snapshot.workspace.sidebarVisible = 'no'
    host.session = JSON.stringify(snapshot)
    restart(host)
    await restoreSession()
    expect(sidebarPanel.value).toBe('folders')
    expect(sidebarVisible.value).toBe(true)
  })
})
