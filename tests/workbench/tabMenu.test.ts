// @vitest-environment jsdom
/**
 * The tab context menu (P6-T9): ISC-213 (Close Others), ISC-214 (Copy Path), ISC-215 (Copy
 * Relative Path) and the rest of its items. Every function takes the tab that was right-clicked,
 * so each case runs on a tab that is in the background.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import {
  closeAllTabs,
  documentOfTab,
  followerOfTab,
  openPath,
  pendingClose,
  resetDocuments,
  resolvePendingClose,
} from '@/documents/store'
import { newUntitledTab, resetUntitled } from '@/documents/untitled'
import { resetReferences, referencesState } from '@/features/references/store'
import {
  naming,
  resetTree,
  restoreWorkspace,
  selectedPath,
  workspaceRoots,
} from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import {
  resetSidebar,
  showSidebar,
  sidebarPanel,
  sidebarVisible,
  toggleSidebar,
} from '@/workbench/sidebar'
import { clearCommands, isCommandEnabled, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { allTabs, paneOfTab, panesOf } from '@/workbench/splitTree'
import {
  activeTabId,
  closeEveryTab,
  closeOtherTabs,
  closeTab,
  closeTabsToTheRight,
  copyTabPath,
  copyTabRelativePath,
  findTabReferences,
  keepNameBoxFocus,
  RENAME_OUTSIDE_FOLDER,
  relativePathOf,
  renameTab,
  revealTabInExplorer,
  revealTabInSidebar,
  tabMenuState,
  tabPath,
} from '@/workbench/tabMenu'
import {
  openTabFor,
  resetWorkbench,
  selectTab,
  splitActivePane,
  workbenchLayout,
} from '@/workbench/store'
import { toasts } from '../helpers/toasts'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

const FILES: Record<string, string> = {
  '/work/a.md': 'a\n',
  '/work/b.md': 'b\n',
  '/work/c.md': 'c\n',
  '/work/deep/er/d.md': 'd\n',
  '/work/pic.png': 'png',
  '/outside/o.md': 'o\n',
  '/work/inner/x.md': 'x\n',
}

let host: MockHost

function type(tab: string, text: string): void {
  const follower = followerOfTab(tab)
  if (follower === undefined) throw new Error('no document')
  follower.dispatch({ changes: { from: 0, insert: text } })
}

/** Opens a new untitled tab and returns it. */
async function untitled(): Promise<string> {
  await newUntitledTab()
  const tab = activeTabId()
  if (tab === null) throw new Error('no tab opened')
  return tab
}

const paneTabs = (tab: string): readonly string[] =>
  paneOfTab(workbenchLayout.value, tab)?.tabs ?? []

async function start(roots = ['/work']): Promise<void> {
  host = createMockHost({ files: FILES, roots })
  setHost(host)
  await restoreWorkspace([])
  await flush()
}

beforeEach(() => {
  resetTree()
  resetWorkbench()
  resetDocuments()
  resetUntitled()
  resetSidebar()
  resetReferences()
})

afterEach(() => {
  setHost(undefined)
  resetTree()
  resetSidebar()
})

describe('Close Others (ISC-213)', () => {
  it('closes every other tab of the pane, from a tab that is in the background', async () => {
    await start()
    const a = await openPath('/work/a.md')
    const b = await openPath('/work/b.md')
    const c = await openPath('/work/c.md')
    expect(activeTabId()).toBe(c)
    expect(await closeOtherTabs(a)).toBe(true) // a is not the active tab
    expect(paneTabs(a)).toEqual([a])
    expect(allTabs(workbenchLayout.value)).toEqual([a])
    expect(activeTabId()).toBe(a) // the tab that was kept is the one shown
    expect(documentOfTab(b)).toBeUndefined()
    expect(documentOfTab(c)).toBeUndefined()
  })

  it('leaves the tabs of the other panes alone', async () => {
    await start()
    const a = await openPath('/work/a.md')
    await openPath('/work/b.md')
    splitActivePane('row', { kind: 'image', path: '/work/pic.png', size: 3 })
    const lone = activeTabId()
    expect(lone).not.toBeNull()
    const left = allTabs(workbenchLayout.value).filter((tab) => tab !== lone)
    expect(left).toHaveLength(2)
    await closeOtherTabs(a)
    expect(paneTabs(a)).toEqual([a])
    expect(allTabs(workbenchLayout.value)).toContain(lone)
  })

  it('asks about a tab with unsaved edits and keeps everything on Cancel', async () => {
    await start()
    const a = await openPath('/work/a.md')
    const b = await openPath('/work/b.md')
    type(b, 'B!')
    const done = closeOtherTabs(a)
    await flush()
    // The question is about b, and b is the tab in front so the banner can be seen.
    expect(pendingClose.value?.tabId).toBe(b)
    expect(activeTabId()).toBe(b)
    await resolvePendingClose('cancel')
    expect(await done).toBe(false)
    expect(paneTabs(a)).toEqual([a, b])
  })

  it('discarding the answer closes the tab and the kept tab comes to the front', async () => {
    await start()
    const a = await openPath('/work/a.md')
    const b = await openPath('/work/b.md')
    type(b, 'B!')
    const done = closeOtherTabs(a)
    await flush()
    await resolvePendingClose('discard')
    expect(await done).toBe(true)
    expect(paneTabs(a)).toEqual([a])
    expect(activeTabId()).toBe(a)
  })

  it('is offered only when the pane has another tab', async () => {
    await start()
    const a = await openPath('/work/a.md')
    expect(tabMenuState(a).canCloseOthers).toBe(false)
    await openPath('/work/b.md')
    expect(tabMenuState(a).canCloseOthers).toBe(true)
  })
})

describe('Close and Close All from the menu', () => {
  it('Close on a clean background tab closes just that tab', async () => {
    await start()
    const a = await openPath('/work/a.md')
    const b = await openPath('/work/b.md')
    closeTab(a)
    expect(allTabs(workbenchLayout.value)).toEqual([b])
  })

  it('Close on a background tab with unsaved edits brings it to the front to ask', async () => {
    await start()
    const a = await openPath('/work/a.md')
    const b = await openPath('/work/b.md')
    type(a, 'A!')
    expect(activeTabId()).toBe(b)
    closeTab(a)
    expect(pendingClose.value?.tabId).toBe(a)
    expect(activeTabId()).toBe(a)
    await resolvePendingClose('discard')
    expect(allTabs(workbenchLayout.value)).toEqual([b])
  })

  it('Close All closes the tabs of its own pane only, and the pane goes away (ISC-307)', async () => {
    await start()
    const a = await openPath('/work/a.md')
    const c = await openPath('/work/c.md')
    splitActivePane('row') // the new pane starts with a second view of c
    const b = await openPath('/work/b.md')
    const right = paneTabs(b)
    expect(right).toHaveLength(2)
    expect(panesOf(workbenchLayout.value)).toHaveLength(2)
    // From the first pane, with its tab in the background.
    expect(await closeEveryTab(a)).toBe(true)
    expect(allTabs(workbenchLayout.value)).toEqual(right)
    expect(documentOfTab(a)).toBeUndefined()
    expect(documentOfTab(c)).toBeUndefined() // that tab is gone; the right pane's view of c stays
    expect(documentOfTab(right[0] ?? '')).toBeDefined()
    expect(panesOf(workbenchLayout.value)).toHaveLength(1)
    expect(activeTabId()).toBe(b)
  })

  it('Close All in the only pane closes everything, as before', async () => {
    await start()
    const a = await openPath('/work/a.md')
    await openPath('/work/b.md')
    expect(await closeEveryTab(a)).toBe(true)
    expect(allTabs(workbenchLayout.value)).toEqual([])
    expect(await closeAllTabs()).toBe(true)
  })

  it('Close All asks about a tab with unsaved edits and keeps the pane on Cancel', async () => {
    await start()
    const a = await openPath('/work/a.md')
    const b = await openPath('/work/b.md')
    splitActivePane('row')
    const other = await openPath('/work/c.md')
    type(a, 'A!')
    const done = closeEveryTab(b)
    await flush()
    expect(pendingClose.value?.tabId).toBe(a)
    await resolvePendingClose('cancel')
    expect(await done).toBe(false)
    expect(paneTabs(a)).toEqual([a, b])
    expect(allTabs(workbenchLayout.value)).toContain(other)
  })
})
describe('Close to the Right (ISC-308)', () => {
  it('closes the tabs after this one in its pane, from a tab in the background', async () => {
    await start()
    const a = await openPath('/work/a.md')
    const b = await openPath('/work/b.md')
    const c = await openPath('/work/c.md')
    const d = await openPath('/work/deep/er/d.md')
    expect(activeTabId()).toBe(d)
    expect(await closeTabsToTheRight(b)).toBe(true)
    expect(paneTabs(a)).toEqual([a, b])
    expect(documentOfTab(c)).toBeUndefined()
    expect(documentOfTab(d)).toBeUndefined()
    expect(activeTabId()).toBe(b)
  })

  it('leaves the tabs of the other panes alone', async () => {
    await start()
    const a = await openPath('/work/a.md')
    await openPath('/work/b.md')
    splitActivePane('row')
    const x = await openPath('/work/c.md')
    const right = paneTabs(x)
    expect(right).toHaveLength(2)
    expect(await closeTabsToTheRight(a)).toBe(true)
    expect(paneTabs(a)).toEqual([a])
    expect(paneTabs(x)).toEqual(right)
  })

  it('asks about a tab with unsaved edits; Cancel keeps it and the tabs after it', async () => {
    await start()
    const a = await openPath('/work/a.md')
    const b = await openPath('/work/b.md')
    const c = await openPath('/work/c.md')
    type(b, 'B!')
    const done = closeTabsToTheRight(a)
    await flush()
    expect(pendingClose.value?.tabId).toBe(b)
    await resolvePendingClose('cancel')
    expect(await done).toBe(false)
    expect(paneTabs(a)).toEqual([a, b, c])
  })

  it('is offered only when a tab lies to the right of this one', async () => {
    await start()
    const a = await openPath('/work/a.md')
    expect(tabMenuState(a).canCloseToTheRight).toBe(false)
    const b = await openPath('/work/b.md')
    expect(tabMenuState(a).canCloseToTheRight).toBe(true)
    expect(tabMenuState(b).canCloseToTheRight).toBe(false)
    expect(await closeTabsToTheRight(b)).toBe(true)
    expect(paneTabs(a)).toEqual([a, b])
  })
})

describe('Copy Path (ISC-214)', () => {
  it('copies the absolute path of a tab that is in the background', async () => {
    await start()
    const d = await openPath('/work/deep/er/d.md')
    await openPath('/work/a.md')
    await copyTabPath(d)
    expect(host.clipboard).toEqual(['/work/deep/er/d.md'])
  })

  it('copies the path of an image tab and of a file outside every folder', async () => {
    await start()
    const pic = await openPath('/work/pic.png')
    const outside = await openPath('/outside/o.md')
    await copyTabPath(pic)
    await copyTabPath(outside)
    expect(host.clipboard).toEqual(['/work/pic.png', '/outside/o.md'])
  })

  it('has nothing to copy for an untitled tab', async () => {
    await start()
    const tab = await untitled()
    expect(tabPath(tab)).toBeNull()
    expect(tabMenuState(tab)).toMatchObject({ hasPath: false, untitled: true })
    await copyTabPath(tab)
    await copyTabRelativePath(tab)
    expect(host.clipboard).toEqual([])
  })

  it('reports nothing when a copy works', async () => {
    await start()
    const a = await openPath('/work/a.md')
    await copyTabPath(a)
    expect(toasts.last).toBeNull()
  })

  it('says so when the clipboard refuses', async () => {
    await start()
    const a = await openPath('/work/a.md')
    host.writeClipboard = () => Promise.reject(new Error('no clipboard here'))
    await copyTabPath(a)
    expect(toasts.last).toContain('no clipboard here')
  })
})

describe('Copy Relative Path (ISC-215)', () => {
  it('is the path from the folder that holds it, with the separator of the full path', async () => {
    await start()
    const d = await openPath('/work/deep/er/d.md')
    await openPath('/work/a.md')
    await copyTabRelativePath(d)
    expect(host.clipboard).toEqual(['deep/er/d.md'])
  })

  it('is the full path for a file outside every folder', async () => {
    await start()
    const outside = await openPath('/outside/o.md')
    await copyTabRelativePath(outside)
    expect(host.clipboard).toEqual(['/outside/o.md'])
  })

  it('uses the innermost of two folders, and forward slashes for a path with both kinds', async () => {
    await start(['/work', '/work/inner'])
    expect(workspaceRoots.value).toHaveLength(2)
    expect(relativePathOf('/work/inner/x.md')).toBe('x.md')
    expect(relativePathOf('/work/deep/er/d.md')).toBe('deep/er/d.md')
    expect(relativePathOf('/work\\deep\\er\\d.md')).toBe('deep/er/d.md')
  })
})

describe('Copy Path and Copy Relative Path use one separator (ISC-243)', () => {
  const WINDOWS: Record<string, string> = {
    'C:\\work\\deep\\er\\d.md': 'd\n',
    'C:\\work\\a.md': 'a\n',
  }

  async function startWindows(): Promise<void> {
    host = createMockHost({ files: WINDOWS, roots: ['C:\\work'] })
    setHost(host)
    await restoreWorkspace([])
    await flush()
  }

  it('a Windows path copies as backslashes in both, as Explorer shows it', async () => {
    await startWindows()
    const d = await openPath('C:\\work\\deep\\er\\d.md')
    await copyTabPath(d)
    await copyTabRelativePath(d)
    expect(host.clipboard).toEqual(['C:\\work\\deep\\er\\d.md', 'deep\\er\\d.md'])
    expect(host.clipboard.some((text) => text.includes('/'))).toBe(false)
  })

  it('a file directly in the folder is its bare name', async () => {
    await startWindows()
    expect(relativePathOf('C:\\work\\a.md')).toBe('a.md')
  })

  it('a path with forward slashes copies as forward slashes in both', async () => {
    await start()
    const d = await openPath('/work/deep/er/d.md')
    await copyTabPath(d)
    await copyTabRelativePath(d)
    expect(host.clipboard).toEqual(['/work/deep/er/d.md', 'deep/er/d.md'])
  })
})

describe('Reveal in the file manager and in the sidebar', () => {
  it('Reveal in the file manager shows the file, wherever it is', async () => {
    await start()
    const a = await openPath('/work/a.md')
    const outside = await openPath('/outside/o.md')
    await revealTabInExplorer(a)
    await revealTabInExplorer(outside)
    expect(host.revealed).toEqual(['/work/a.md', '/outside/o.md'])
  })

  it('Reveal in Sidebar selects the file, opens the folders above it and shows a hidden sidebar', async () => {
    await start()
    const d = await openPath('/work/deep/er/d.md')
    await openPath('/work/a.md')
    toggleSidebar()
    expect(sidebarVisible.value).toBe(false)
    await revealTabInSidebar(d)
    await flush()
    expect(sidebarVisible.value).toBe(true)
    expect(selectedPath.value).toBe('/work/deep/er/d.md')
  })

  it('Reveal in Sidebar goes back from the references to the folders', async () => {
    await start()
    const a = await openPath('/work/a.md')
    showSidebar('references')
    expect(sidebarPanel.value).toBe('references')
    await revealTabInSidebar(a)
    expect(sidebarPanel.value).toBe('folders')
  })

  it('is off for a file outside every folder, and does nothing if asked anyway', async () => {
    await start()
    const outside = await openPath('/outside/o.md')
    expect(tabMenuState(outside).canRevealInSidebar).toBe(false)
    selectedPath.value = null
    await revealTabInSidebar(outside)
    expect(selectedPath.value).toBeNull()
  })

  it('is off for an untitled tab', async () => {
    await start()
    const tab = await untitled()
    expect(tabMenuState(tab).canRevealInSidebar).toBe(false)
  })
})

describe('Rename and Find File References from the menu', () => {
  it('Rename on a file in a folder opens the name box on its row', async () => {
    await start()
    const d = await openPath('/work/deep/er/d.md')
    await openPath('/work/a.md')
    await renameTab(d)
    await flush()
    expect(naming.value).toMatchObject({ kind: 'rename', path: '/work/deep/er/d.md' })
    expect(sidebarPanel.value).toBe('folders')
  })

  it('Rename shows a hidden sidebar and the folders panel before the name box', async () => {
    await start()
    const a = await openPath('/work/a.md')
    toggleSidebar()
    showSidebar('references')
    toggleSidebar()
    expect(sidebarVisible.value).toBe(false)
    await renameTab(a)
    await flush()
    expect(sidebarVisible.value).toBe(true)
    expect(sidebarPanel.value).toBe('folders')
    expect(naming.value).toMatchObject({ kind: 'rename', path: '/work/a.md' })
  })

  it('Rename on an untitled tab is Save As', async () => {
    await start()
    const tab = await untitled()
    const before = host.saveDialogs.length
    await renameTab(tab)
    expect(host.saveDialogs.length).toBe(before + 1)
    expect(tabMenuState(tab).canRename).toBe(true)
  })

  it('Rename is off for a file outside every folder, and says why if asked anyway', async () => {
    await start()
    const outside = await openPath('/outside/o.md')
    expect(tabMenuState(outside).canRename).toBe(false)
    await renameTab(outside)
    expect(naming.value).toBeNull()
    expect(toasts.last).toBe(RENAME_OUTSIDE_FOLDER)
  })

  it('Find File References lists the links to a tab that is in the background', async () => {
    await start()
    const a = await openPath('/work/a.md')
    await openPath('/work/b.md')
    host.files.write('/work/c.md', 'see [a](a.md)\n')
    await findTabReferences(a)
    await flush()
    expect(referencesState.value?.phase).toBe('done')
    expect(sidebarPanel.value).toBe('references')
  })

  it('every path item is off for a tab with no tab record', async () => {
    await start()
    const gone = openTabFor({ kind: 'image', path: '/work/pic.png', size: 3 })
    selectTab(gone)
    expect(tabPath(gone)).toBe('/work/pic.png')
    expect(tabMenuState(gone)).toMatchObject({ hasPath: true, canRename: true })
    expect(tabMenuState('no-such-tab')).toMatchObject({
      hasPath: false,
      canCloseOthers: false,
      canRevealInSidebar: false,
    })
  })
})

describe('the commands that share the menu', () => {
  let removeCommands: (() => void) | undefined

  beforeEach(() => {
    clearCommands()
    removeCommands = registerDefaultCommands()
  })

  afterEach(() => {
    removeCommands?.()
    clearCommands()
  })

  it('the Close All command closes the active pane only, and is off when that pane has no tab (ISC-307)', async () => {
    await start()
    expect(isCommandEnabled(COMMAND_IDS.closeAll)).toBe(false)
    await openPath('/work/a.md')
    splitActivePane('row')
    const b = await openPath('/work/b.md')
    const c = await openPath('/work/c.md')
    expect(isCommandEnabled(COMMAND_IDS.closeAll)).toBe(true)
    await runCommand(COMMAND_IDS.closeAll)
    const left = allTabs(workbenchLayout.value)
    expect(left).toHaveLength(1)
    expect(left).not.toContain(b)
    expect(left).not.toContain(c)
    expect(panesOf(workbenchLayout.value)).toHaveLength(1)
    // What is left is the first pane's tab; Close All again closes it too.
    expect(isCommandEnabled(COMMAND_IDS.closeAll)).toBe(true)
    await runCommand(COMMAND_IDS.closeAll)
    expect(allTabs(workbenchLayout.value)).toEqual([])
    expect(isCommandEnabled(COMMAND_IDS.closeAll)).toBe(false)
  })

  it('Find File References is off with no tab and for an untitled tab, on for a file', async () => {
    await start()
    expect(isCommandEnabled(COMMAND_IDS.findReferences)).toBe(false)
    await untitled()
    expect(isCommandEnabled(COMMAND_IDS.findReferences)).toBe(false)
    await openPath('/work/a.md')
    expect(isCommandEnabled(COMMAND_IDS.findReferences)).toBe(true)
    await runCommand(COMMAND_IDS.findReferences)
    await flush()
    expect(referencesState.value).toMatchObject({ phase: 'done', target: '/work/a.md' })
  })
})

describe('closing the menu while the name box is open', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('leaves focus on the name box instead of giving it back to the tab', () => {
    const box = document.createElement('input')
    box.setAttribute('data-name-input', '')
    document.body.append(box)
    const event = new Event('focusout', { cancelable: true })
    keepNameBoxFocus(event)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(box)
  })

  it('lets the menu give focus back when there is no name box', () => {
    const event = new Event('focusout', { cancelable: true })
    keepNameBoxFocus(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('why Rename is off (ISC-220)', () => {
  it('gives a reason for a file outside every folder, an image included', async () => {
    await start()
    const outside = await openPath('/outside/o.md')
    expect(tabMenuState(outside).renameWhyNot).toBe(RENAME_OUTSIDE_FOLDER)
    expect(tabMenuState(outside).canRename).toBe(false)
    host.files.write('/outside/p.png', 'png')
    const image = await openPath('/outside/p.png')
    expect(tabMenuState(image).renameWhyNot).toBe(RENAME_OUTSIDE_FOLDER)
  })

  it('gives none for a file in a folder, an untitled tab or a tab that is gone', async () => {
    await start()
    const inside = await openPath('/work/a.md')
    expect(tabMenuState(inside).renameWhyNot).toBeNull()
    const tab = await untitled()
    expect(tabMenuState(tab).renameWhyNot).toBeNull()
    expect(tabMenuState('no-such-tab').renameWhyNot).toBeNull()
  })

  it('asking anyway shows the same reason in the status bar', async () => {
    await start()
    const outside = await openPath('/outside/o.md')
    await renameTab(outside)
    expect(toasts.last).toBe(RENAME_OUTSIDE_FOLDER)
  })
})

describe('Shift+F12 (ISC-221)', () => {
  let removeCommands: (() => void) | undefined
  let removeKeys: (() => void) | undefined
  let target: EventTarget

  beforeEach(() => {
    clearCommands()
    removeCommands = registerDefaultCommands()
    target = new EventTarget()
    removeKeys = installKeybindings(target, 'other')
  })

  afterEach(() => {
    removeKeys?.()
    removeCommands?.()
    clearCommands()
  })

  function press(props: Record<string, unknown>): Event {
    const event = Object.assign(new Event('keydown', { cancelable: true }), {
      key: 'F12',
      code: 'F12',
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
      metaKey: false,
      ...props,
    })
    target.dispatchEvent(event)
    return event
  }

  it('lists the links to the active file', async () => {
    await start()
    host.files.write('/work/b.md', 'see [a](a.md)\n')
    await openPath('/work/a.md')
    const event = press({})
    expect(event.defaultPrevented).toBe(true)
    await flush()
    expect(referencesState.value).toMatchObject({ phase: 'done', target: '/work/a.md' })
    expect(sidebarPanel.value).toBe('references')
  })

  it('does nothing without Shift, and nothing for an untitled tab', async () => {
    await start()
    await openPath('/work/a.md')
    press({ shiftKey: false })
    await flush()
    expect(referencesState.value).toBeNull()
    await untitled()
    press({})
    await flush()
    expect(referencesState.value).toBeNull()
  })
})
