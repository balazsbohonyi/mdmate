import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearRecent,
  openRecentFile,
  openRecentFolder,
  recentLists,
  refreshRecent,
} from '@/documents/recent'
import { openPath, resetDocuments } from '@/documents/store'
import { restoreSession, resetSession, flushSession } from '@/documents/session'
import { resetTree, workspaceRoots } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { buildMenuEntries, findMenuItem } from '@/shell/menuEntries'
import { clearCommands } from '@/workbench/commands'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { allTabs } from '@/workbench/splitTree'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'
import { toasts } from '../helpers/toasts'

const FILES: Record<string, string> = {
  'C:/notes/a.md': 'a\n',
  'C:/notes/b.md': 'b\n',
  'C:/work/docs/c.md': 'c\n',
}

let host: MockHost
let removeCommands: () => void

beforeEach(() => {
  host = createMockHost({ files: FILES })
  host.files.mkdir('C:/notes')
  setHost(host)
  resetWorkbench()
  resetDocuments()
  resetSession()
  resetTree()
  recentLists.value = { files: [], folders: [] }
  clearCommands()
  removeCommands = registerDefaultCommands()
})

afterEach(() => {
  removeCommands()
  clearCommands()
  resetTree()
  resetSession()
  resetWorkbench()
  resetDocuments()
  setHost(undefined)
})

describe('Open Recent', () => {
  it('lists files the user opened, newest first, once each', async () => {
    await openPath('C:/notes/a.md')
    await openPath('C:/notes/b.md')
    await openPath('C:/notes/a.md')
    await refreshRecent()
    expect(recentLists.value.files).toEqual(['C:/notes/a.md', 'C:/notes/b.md'])
  })

  it('does not list files that a restored session opened again', async () => {
    await openPath('C:/notes/a.md')
    await flushSession()
    const next = createMockHost({ files: FILES })
    next.session = host.session
    resetSession()
    resetDocuments()
    resetWorkbench()
    setHost(next)
    await restoreSession()
    expect(allTabs(workbenchLayout.value)).toHaveLength(1)
    await refreshRecent()
    expect(recentLists.value.files).toEqual([])
  })

  it('opens a file from the list in a tab', async () => {
    await openPath('C:/notes/a.md')
    await refreshRecent()
    resetWorkbench()
    resetDocuments()
    await openRecentFile('C:/notes/a.md')
    expect(allTabs(workbenchLayout.value)).toHaveLength(1)
    expect(toasts.last).toBeNull()
  })

  it('refuses a path that is not on the list and says so', async () => {
    await openRecentFile('C:/work/docs/c.md')
    expect(allTabs(workbenchLayout.value)).toEqual([])
    expect(toasts.last).toMatch(/Could not open/)
  })

  it('drops a file that is gone when the list is read again', async () => {
    await openPath('C:/notes/a.md')
    await openPath('C:/notes/b.md')
    host.files.delete('C:/notes/a.md')
    await refreshRecent()
    expect(recentLists.value.files).toEqual(['C:/notes/b.md'])
  })

  it('lists the folders the user opened and makes one a workspace folder again', async () => {
    host.recent.folders.push('C:/notes')
    await refreshRecent()
    expect(recentLists.value.folders).toEqual(['C:/notes'])
    await openRecentFolder('C:/notes')
    expect(workspaceRoots.value).toEqual(['C:/notes'])
    expect(host.roots).toEqual(['C:/notes'])
  })

  it('shows in the menu: files, folders, then Clear Recent last', async () => {
    host.recent.folders.push('C:/notes')
    await openPath('C:/work/docs/c.md')
    await refreshRecent()
    const submenu = buildMenuEntries('other').find((entry) => entry.kind === 'submenu')
    if (submenu?.kind !== 'submenu') throw new Error('no Open Recent submenu')
    expect(submenu.label).toBe('Open Recent')
    expect(submenu.items.map((item) => (item.kind === 'separator' ? '-' : item.label))).toEqual([
      'Files',
      'c.md',
      '-',
      'Folders',
      'notes',
      '-',
      'Clear Recent',
    ])
    const file = findMenuItem(buildMenuEntries('other'), 'recent.file:C:/work/docs/c.md')
    expect(file?.detail).toBe('C:/work/docs')
  })

  it('clears both lists from the menu item', async () => {
    host.recent.folders.push('C:/notes')
    await openPath('C:/notes/a.md')
    await refreshRecent()
    const clear = findMenuItem(buildMenuEntries('other'), 'recent.clear')
    expect(clear?.disabled).toBe(false)
    await clear?.run?.()
    expect(recentLists.value).toEqual({ files: [], folders: [] })
    expect(host.recent).toEqual({ files: [], folders: [] })
    await clearRecent()
    expect(findMenuItem(buildMenuEntries('other'), 'recent.clear')?.disabled).toBe(true)
  })
})
