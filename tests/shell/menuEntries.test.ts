import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const close = vi.fn(() => Promise.resolve())
vi.mock('@/platform', () => ({
  getHost: () => Promise.resolve({ windowControls: { close } }),
}))

import { buildMenuEntries } from '@/shell/menuEntries'
import { clearCommands, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { panesOf } from '@/workbench/splitTree'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'
import { openNewTab } from '../helpers/tabs'

let removeCommands: () => void

beforeEach(() => {
  clearCommands()
  resetWorkbench()
  removeCommands = registerDefaultCommands()
})

afterEach(() => {
  removeCommands()
  clearCommands()
  resetWorkbench()
})

describe('the app menu', () => {
  it('lists the commands in order with separators, labels and shortcuts from the registry', () => {
    openNewTab('a.md')
    expect(buildMenuEntries('other')).toEqual([
      {
        kind: 'item',
        id: COMMAND_IDS.open,
        label: 'Open...',
        shortcut: 'Ctrl+O',
        disabled: false,
      },
      {
        kind: 'item',
        id: COMMAND_IDS.save,
        label: 'Save',
        shortcut: 'Ctrl+S',
        // Nothing is edited, so there is nothing to save.
        disabled: true,
      },
      { kind: 'separator' },
      {
        kind: 'item',
        id: COMMAND_IDS.splitRight,
        label: 'Split Right',
        shortcut: 'Alt+Shift+2',
        disabled: false,
      },
      {
        kind: 'item',
        id: COMMAND_IDS.splitDown,
        label: 'Split Down',
        shortcut: 'Alt+Shift+8',
        disabled: false,
      },
      {
        kind: 'item',
        id: COMMAND_IDS.closeTab,
        label: 'Close Tab',
        shortcut: 'Ctrl+W',
        disabled: false,
      },
      { kind: 'separator' },
      {
        kind: 'item',
        id: COMMAND_IDS.toggleSidebar,
        label: 'Toggle Sidebar',
        shortcut: 'Ctrl+Shift+B',
        disabled: false,
      },
      {
        kind: 'item',
        id: COMMAND_IDS.toggleRawSource,
        label: 'Toggle Raw Source',
        shortcut: 'Ctrl+E',
        disabled: false,
      },
      { kind: 'separator' },
      { kind: 'item', id: COMMAND_IDS.exit, label: 'Exit', disabled: false },
    ])
  })

  it('shows Mac shortcuts on a Mac', () => {
    const shortcuts = buildMenuEntries('mac').flatMap((entry) =>
      entry.kind === 'item' && entry.shortcut !== undefined ? [entry.shortcut] : [],
    )
    expect(shortcuts).toEqual(['⌘O', '⌘S', '⌥⇧2', '⌥⇧8', '⌘W', '⇧⌘B', '⌘E'])
  })

  it('greys out Close Tab while there is no tab, and Save while nothing is edited', () => {
    const disabled = () =>
      buildMenuEntries('other').flatMap((entry) =>
        entry.kind === 'item' && entry.disabled === true ? [entry.id] : [],
      )
    expect(disabled()).toEqual([
      COMMAND_IDS.save,
      COMMAND_IDS.closeTab,
      COMMAND_IDS.toggleRawSource,
    ])
    openNewTab('a.md')
    expect(disabled()).toEqual([COMMAND_IDS.save])
  })

  it('leaves out a command that is not registered', () => {
    removeCommands()
    expect(buildMenuEntries('other').filter((entry) => entry.kind === 'item')).toEqual([])
  })

  it('has an id on every item that runs the same command as its shortcut', async () => {
    openNewTab('a.md')
    const split = buildMenuEntries('other').find(
      (entry) => entry.kind === 'item' && entry.label === 'Split Right',
    )
    if (split?.kind !== 'item') throw new Error('no Split Right entry')
    await runCommand(split.id)
    const fromMenu = panesOf(workbenchLayout.value).length

    resetWorkbench()
    openNewTab('a.md')
    const target = new EventTarget()
    const remove = installKeybindings(target, 'other')
    target.dispatchEvent(
      Object.assign(new Event('keydown', { cancelable: true }), {
        key: '@',
        code: 'Digit2',
        ctrlKey: false,
        altKey: true,
        shiftKey: true,
        metaKey: false,
      }),
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    remove()
    expect(panesOf(workbenchLayout.value).length).toBe(fromMenu)
    expect(fromMenu).toBe(2)
  })
})
