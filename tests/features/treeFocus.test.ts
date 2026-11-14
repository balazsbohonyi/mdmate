// @vitest-environment jsdom
/**
 * Where keyboard focus is after the sidebar tree opens a file (ISC-255, ISC-256, ISC-257): a click
 * or Space shows the file and leaves focus on the tree, a double click or Enter puts the caret in
 * the file, every other way to open a file still does, and rename, delete and move leave focus
 * where it was. The tree and the panes are drawn together, as in the app. jsdom cannot show the
 * press-focus quirks of a real window; those are checked there.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { openPath, resetDocuments } from '@/documents/store'
import FileTree from '@/features/tree/FileTree.vue'
import { commitNaming, deleteRow, moveRow, renameRow } from '@/features/tree/ops'
import {
  focusTree,
  resetTree,
  restoreWorkspace,
  selectedPath,
  toggleFolder,
} from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { clearCommands, getCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import {
  editorFocusRequest,
  focusActiveEditor,
  holdingEditorFocus,
  isEditorFocusHeld,
} from '@/workbench/focus'
import { resetFind } from '@/workbench/find'
import { installKeybindings } from '@/workbench/keyboard'
import { resetSidebar, showSidebar, sidebarPanel, sidebarVisible } from '@/workbench/sidebar'
import { findPane } from '@/workbench/splitTree'
import { focusPane, resetWorkbench, splitActivePane, workbenchLayout } from '@/workbench/store'
import WorkbenchView from '@/workbench/WorkbenchView.vue'

class FakeObserver {
  observe = (): undefined => undefined
  unobserve = (): undefined => undefined
  disconnect = (): undefined => undefined
}
Object.assign(globalThis, { ResizeObserver: FakeObserver })

beforeAll(() => {
  // jsdom has no layout; CodeMirror asks ranges for their boxes.
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

const FILES: Record<string, string> = {
  '/work/notes/a.md': '# a\n',
  '/work/notes/b.md': '# b\n',
  '/work/readme.md': '# readme\n',
}

let mounted: { app: App; root: HTMLElement } | undefined
let removeCommands: (() => void) | undefined

function mountBoth(): void {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h(TooltipProvider, { delayDuration: 0 }, () => [h(FileTree), h(WorkbenchView)]),
  })
  app.mount(root)
  mounted = { app, root }
}

function treeElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-file-tree]')
  if (element === null) throw new Error('no tree')
  return element
}

async function start(): Promise<void> {
  setHost(createMockHost({ files: FILES, roots: ['/work'] }))
  await restoreWorkspace([])
  await toggleFolder('/work/notes')
  await flush()
  mountBoth()
  await flush()
  treeElement().focus()
}

const rowOf = (path: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[data-row-path="${path}"]`)
  if (row === null) throw new Error(`no row ${path}`)
  return row
}

const editorHasFocus = (): boolean => document.activeElement?.closest('.cm-editor') != null
const treeHasFocus = (): boolean => document.activeElement === treeElement()
const shownTabs = (): number =>
  findPane(workbenchLayout.value, workbenchLayout.value.activePane)?.tabs.length ?? 0
const hasRow = (path: string): boolean =>
  document.querySelector(`[data-row-path="${path}"]`) !== null

async function click(path: string): Promise<void> {
  rowOf(path).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  await flush()
}

async function doubleClick(path: string): Promise<void> {
  const row = rowOf(path)
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
  row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))
  await flush()
}

async function press(key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  treeElement().dispatchEvent(event)
  await flush()
  return event
}

beforeEach(() => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  resetSidebar()
  clearCommands()
  removeCommands = registerDefaultCommands()
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  document.body.replaceChildren()
  removeCommands?.()
  clearCommands()
  setHost(undefined)
  resetTree()
})

describe('a click shows the file and leaves focus on the tree (ISC-255)', () => {
  it('opens the file in a tab and keeps focus on the tree, for a new tab and for one already shown', async () => {
    await start()
    await click('/work/notes/a.md')
    expect(shownTabs()).toBe(1)
    expect(document.querySelector('.cm-editor')).not.toBeNull()
    expect(treeHasFocus()).toBe(true)
    expect(editorHasFocus()).toBe(false)
    expect(selectedPath.value).toBe('/work/notes/a.md')
    // A tab that is already the one on screen wakes no editor; the hold must not outlast it.
    await click('/work/notes/a.md')
    expect(treeHasFocus()).toBe(true)
    expect(isEditorFocusHeld()).toBe(false)
  })

  it('a second file in the same pane keeps focus on the tree too', async () => {
    await start()
    await click('/work/notes/a.md')
    await click('/work/notes/b.md')
    expect(shownTabs()).toBe(2)
    expect(treeHasFocus()).toBe(true)
  })

  it('a double click puts the caret in the file; the folder under a double click toggles once', async () => {
    await start()
    await doubleClick('/work/notes/a.md')
    expect(shownTabs()).toBe(1)
    expect(editorHasFocus()).toBe(true)
    treeElement().focus()
    const before = document.querySelectorAll('[data-row-path]').length
    await doubleClick('/work/notes')
    const after = document.querySelectorAll('[data-row-path]').length
    // /work/notes held a.md and b.md, so one toggle closes it; two would leave it open.
    expect(before - after).toBe(2)
  })
})

describe('the keys (ISC-254)', () => {
  it('arrows move the selection and open nothing', async () => {
    await start()
    selectedPath.value = '/work'
    await press('ArrowDown')
    expect(selectedPath.value).toBe('/work/notes')
    await press('ArrowDown')
    expect(selectedPath.value).toBe('/work/notes/a.md')
    await press('ArrowUp')
    expect(selectedPath.value).toBe('/work/notes')
    expect(shownTabs()).toBe(0)
    expect(treeHasFocus()).toBe(true)
    expect(treeElement().getAttribute('aria-activedescendant')).toBe(
      rowOf('/work/notes').getAttribute('id'),
    )
  })

  it('Right and Left open, step in, step out and close', async () => {
    await start()
    selectedPath.value = '/work/notes'
    await press('ArrowLeft') // closes notes
    expect(hasRow('/work/notes/a.md')).toBe(false)
    await press('ArrowRight') // opens it again
    expect(hasRow('/work/notes/a.md')).toBe(true)
    await press('ArrowRight') // steps into it
    expect(selectedPath.value).toBe('/work/notes/a.md')
    await press('ArrowLeft') // steps out to the folder
    expect(selectedPath.value).toBe('/work/notes')
  })

  it('Home and End jump to the first and last row', async () => {
    await start()
    selectedPath.value = '/work/notes'
    await press('End')
    expect(selectedPath.value).toBe('/work/readme.md')
    await press('Home')
    expect(selectedPath.value).toBe('/work')
  })

  it('Space shows the file and keeps focus on the tree; Enter puts the caret in it', async () => {
    await start()
    selectedPath.value = '/work/notes/a.md'
    const space = await press(' ')
    expect(space.defaultPrevented).toBe(true)
    expect(shownTabs()).toBe(1)
    expect(treeHasFocus()).toBe(true)
    expect(editorHasFocus()).toBe(false)
    const enter = await press('Enter')
    expect(enter.defaultPrevented).toBe(true)
    expect(editorHasFocus()).toBe(true)
  })

  it('Enter on the file that is already the active tab still moves the caret into it', async () => {
    await start()
    await click('/work/notes/a.md')
    expect(treeHasFocus()).toBe(true)
    await press('Enter')
    expect(editorHasFocus()).toBe(true)
  })

  it('Enter and Space on a folder toggle it', async () => {
    await start()
    selectedPath.value = '/work/notes'
    await press('Enter')
    expect(hasRow('/work/notes/a.md')).toBe(false)
    await press(' ')
    expect(hasRow('/work/notes/a.md')).toBe(true)
    expect(shownTabs()).toBe(0)
  })

  it('a held key does not toggle again', async () => {
    await start()
    selectedPath.value = '/work/notes'
    await press('Enter', { repeat: true })
    expect(hasRow('/work/notes/a.md')).toBe(true)
  })

  it('a key with Ctrl, Alt or Meta is left to the app shortcuts, and so is Shift', async () => {
    await start()
    selectedPath.value = '/work/notes'
    for (const init of [
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      const event = await press('ArrowDown', init)
      expect(event.defaultPrevented, JSON.stringify(init)).toBe(false)
      expect(selectedPath.value).toBe('/work/notes')
    }
  })

  it('keys typed in the name box belong to the box', async () => {
    await start()
    selectedPath.value = '/work/readme.md'
    await renameRow('/work/readme.md')
    await flush()
    const box = document.querySelector<HTMLInputElement>('[data-name-input]')
    expect(box).not.toBeNull()
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })
    box?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(selectedPath.value).toBe('/work/readme.md')
  })
})

describe('every other way to open a file still takes focus (ISC-255)', () => {
  it('a link, Quick Open or history (openPath) puts the caret in the editor', async () => {
    await start()
    await openPath('/work/notes/a.md')
    await flush()
    expect(editorHasFocus()).toBe(true)
  })

  it('a tab clicked in the strip puts the caret in its editor, the shown tab included', async () => {
    await start()
    await click('/work/notes/a.md')
    await click('/work/notes/b.md')
    expect(treeHasFocus()).toBe(true)
    const tabs = [...document.querySelectorAll<HTMLElement>('[role=tab]')]
    expect(tabs.map((tab) => tab.textContent.trim())).toEqual(['a.md', 'b.md'])
    // Another tab than the shown one.
    tabs[0]?.click()
    await flush()
    expect(editorHasFocus()).toBe(true)
    treeElement().focus()
    // The tab that is shown already wakes no editor by itself.
    tabs[0]?.click()
    await flush()
    expect(editorHasFocus()).toBe(true)
  })
})

describe('the hold on editor focus', () => {
  it('is on while the work runs and off after it, also when the work fails', async () => {
    expect(isEditorFocusHeld()).toBe(false)
    let during = false
    await holdingEditorFocus(() => {
      during = isEditorFocusHeld()
    })
    expect(during).toBe(true)
    expect(isEditorFocusHeld()).toBe(false)
    await expect(
      holdingEditorFocus(() => {
        throw new Error('no')
      }),
    ).rejects.toThrow('no')
    expect(isEditorFocusHeld()).toBe(false)
  })

  it('a pane that becomes active during the hold does not take focus either', async () => {
    await start()
    await click('/work/notes/a.md')
    splitActivePane('row')
    await flush()
    const panes = [...document.querySelectorAll<HTMLElement>('[data-pane-id]')]
    expect(panes.length).toBe(2)
    treeElement().focus()
    const other = panes.find((pane) => pane.dataset.active !== 'true')?.dataset.paneId
    if (other === undefined) throw new Error('no second pane')
    await holdingEditorFocus(() => focusPane(other))
    expect(treeHasFocus()).toBe(true)
  })

  it('asking for the editor counts a request for each host to hear', () => {
    const before = editorFocusRequest.value
    focusActiveEditor()
    expect(editorFocusRequest.value).toBe(before + 1)
  })
})

describe('focus stays in the tree after rename, delete and move (ISC-256)', () => {
  it('deleting the open file does not hand focus to the next tab', async () => {
    await start()
    await click('/work/notes/a.md')
    await click('/work/notes/b.md')
    expect(treeHasFocus()).toBe(true)
    await deleteRow('/work/notes/b.md')
    await flush()
    expect(shownTabs()).toBe(1)
    expect(editorHasFocus()).toBe(false)
    expect(treeHasFocus()).toBe(true)
  })

  it('focus lost to the page after a delete comes back to the tree', async () => {
    await start()
    await click('/work/notes/a.md')
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
    await deleteRow('/work/notes/a.md')
    await flush()
    expect(treeHasFocus()).toBe(true)
  })

  it('a name typed and confirmed returns focus to the tree, and so does Escape', async () => {
    await start()
    selectedPath.value = '/work/readme.md'
    await renameRow('/work/readme.md')
    await flush()
    expect(document.activeElement?.hasAttribute('data-name-input')).toBe(true)
    await commitNaming('renamed.md')
    await flush()
    expect(treeHasFocus()).toBe(true)
    selectedPath.value = '/work/renamed.md'
    await renameRow('/work/renamed.md')
    await flush()
    const box = document.querySelector<HTMLInputElement>('[data-name-input]')
    box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    expect(treeHasFocus()).toBe(true)
  })

  it('a move into another folder leaves focus on the tree', async () => {
    await start()
    await moveRow('/work/readme.md', '/work/notes')
    await flush()
    expect(treeHasFocus()).toBe(true)
  })

  it('focus that sits somewhere else on purpose is not pulled back', async () => {
    await start()
    const outside = document.createElement('input')
    document.body.append(outside)
    outside.focus()
    await deleteRow('/work/readme.md')
    await flush()
    expect(document.activeElement).toBe(outside)
  })
})

describe('Focus Sidebar (ISC-257)', () => {
  it('is a command on Ctrl+Shift+E', () => {
    expect(getCommand(COMMAND_IDS.focusSidebar)?.keybinding).toBe('Mod+Shift+E')
    expect(getCommand(COMMAND_IDS.focusSidebar)?.title).toBe('Focus Sidebar')
  })

  it('moves focus from the editor to the tree and selects the first row when none is selected', async () => {
    await start()
    await doubleClick('/work/notes/a.md')
    expect(editorHasFocus()).toBe(true)
    selectedPath.value = null
    void getCommand(COMMAND_IDS.focusSidebar)?.run()
    await flush()
    expect(treeHasFocus()).toBe(true)
    expect(selectedPath.value).toBe('/work')
  })

  it('keeps the selected row when there is one', async () => {
    await start()
    selectedPath.value = '/work/readme.md'
    const outside = document.createElement('input')
    document.body.append(outside)
    outside.focus()
    focusTree()
    await flush()
    expect(treeHasFocus()).toBe(true)
    expect(selectedPath.value).toBe('/work/readme.md')
  })

  it('shows the folders panel when another one was on screen', () => {
    expect(sidebarVisible.value).toBe(true)
    showSidebar('references')
    expect(sidebarPanel.value).toBe('references')
    void getCommand(COMMAND_IDS.focusSidebar)?.run()
    expect(sidebarPanel.value).toBe('folders')
    expect(sidebarVisible.value).toBe(true)
  })

  it('is heard by a tree that is drawn after the request', async () => {
    setHost(createMockHost({ files: FILES, roots: ['/work'] }))
    await restoreWorkspace([])
    await flush()
    focusTree()
    mountBoth()
    await flush()
    expect(treeHasFocus()).toBe(true)
    expect(selectedPath.value).toBe('/work')
  })
})

describe('find keys work from the tree (ISC-262)', () => {
  const findBox = (): HTMLInputElement | null =>
    document.querySelector<HTMLInputElement>('[data-find-input]')

  async function withKeys(run: () => Promise<void>): Promise<void> {
    const uninstall = installKeybindings(document, 'other')
    try {
      await run()
    } finally {
      uninstall()
      resetFind()
    }
  }

  it('Ctrl+F with the tree focused opens the bar in the active pane with focus in its box', async () => {
    await withKeys(async () => {
      await start()
      await click('/work/notes/a.md')
      expect(treeHasFocus()).toBe(true)
      const event = await press('f', { ctrlKey: true })
      expect(event.defaultPrevented).toBe(true)
      expect(findBox()).not.toBeNull()
      expect(document.activeElement).toBe(findBox())
    })
  })

  it('Ctrl+H does the same with the replace row open', async () => {
    await withKeys(async () => {
      await start()
      await click('/work/notes/a.md')
      await press('h', { ctrlKey: true })
      expect(document.activeElement).toBe(findBox())
      expect(document.querySelector('[data-replace-input]')).not.toBeNull()
    })
  })

  it('F3 with the tree focused opens the bar but leaves focus on the tree', async () => {
    await withKeys(async () => {
      await start()
      await click('/work/notes/a.md')
      const event = await press('F3')
      expect(event.defaultPrevented).toBe(true)
      expect(findBox()).not.toBeNull()
      expect(treeHasFocus()).toBe(true)
    })
  })
})
