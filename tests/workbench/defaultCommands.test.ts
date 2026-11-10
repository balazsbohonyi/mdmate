import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const close = vi.fn(() => Promise.resolve())
vi.mock('@/platform', () => ({
  getHost: () => Promise.resolve({ windowControls: { close } }),
}))

import {
  clearCommands,
  getCommand,
  listCommands,
  runCommand,
  shortcutLabel,
} from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { isRaw, resetRawModes } from '@/workbench/rawMode'
import { sidebarVisible } from '@/workbench/sidebar'
import { findPane, panesOf, type Layout } from '@/workbench/splitTree'
import { resetWorkbench, selectTab, tabTitle, workbenchLayout } from '@/workbench/store'
import { openNewTab } from '../helpers/tabs'

let target: EventTarget
let removeKeybindings: () => void
let removeCommands: () => void

function keydown(props: Record<string, unknown>): Event {
  const event = Object.assign(new Event('keydown', { cancelable: true }), {
    key: '',
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...props,
  })
  target.dispatchEvent(event)
  return event
}

/** The key presses a user would make for each default command, as a Windows keyboard sends them. */
const keys = {
  splitRight: { key: '@', code: 'Digit2', altKey: true, shiftKey: true },
  splitDown: { key: '*', code: 'Digit8', altKey: true, shiftKey: true },
  closeTab: { key: 'w', code: 'KeyW', ctrlKey: true },
  toggleSidebar: { key: 'B', code: 'KeyB', ctrlKey: true, shiftKey: true },
  toggleRawSource: { key: 'e', code: 'KeyE', ctrlKey: true },
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function shape(layout: Layout): string {
  const walk = (node: Layout['root']): string =>
    node.kind === 'split'
      ? `${node.direction}(${node.children.map(walk).join(' ')})`
      : `[${node.tabs.map(tabTitle).join(',')}]`
  return walk(layout.root)
}

beforeEach(() => {
  clearCommands()
  resetWorkbench()
  close.mockClear()
  target = new EventTarget()
  removeCommands = registerDefaultCommands()
  removeKeybindings = installKeybindings(target, 'other')
})

afterEach(() => {
  removeKeybindings()
  removeCommands()
  clearCommands()
  resetWorkbench()
  resetRawModes()
})

describe('the default commands', () => {
  it('are registered with the shortcuts a user can see in the menu', () => {
    const shown = Object.fromEntries(
      listCommands().map((command) => [command.id, shortcutLabel(command.id, 'other')]),
    )
    expect(shown).toEqual({
      [COMMAND_IDS.open]: 'Ctrl+O',
      [COMMAND_IDS.openFolder]: 'Ctrl+Shift+O',
      [COMMAND_IDS.quickOpen]: 'Ctrl+P',
      [COMMAND_IDS.commandPalette]: 'Ctrl+Shift+P',
      [COMMAND_IDS.save]: 'Ctrl+S',
      [COMMAND_IDS.splitRight]: 'Alt+Shift+2',
      [COMMAND_IDS.splitDown]: 'Alt+Shift+8',
      [COMMAND_IDS.closeTab]: 'Ctrl+W',
      [COMMAND_IDS.toggleSidebar]: 'Ctrl+Shift+B',
      [COMMAND_IDS.toggleRawSource]: 'Ctrl+E',
      [COMMAND_IDS.back]: 'Alt+ArrowLeft',
      [COMMAND_IDS.forward]: 'Alt+ArrowRight',
      [COMMAND_IDS.bold]: 'Ctrl+B',
      [COMMAND_IDS.italic]: 'Ctrl+I',
      [COMMAND_IDS.link]: 'Ctrl+K',
      [COMMAND_IDS.inlineCode]: 'Ctrl+`',
      [COMMAND_IDS.strikethrough]: 'Alt+Shift+5',
      [COMMAND_IDS.headingUp]: 'Ctrl+Shift+ArrowUp',
      [COMMAND_IDS.headingDown]: 'Ctrl+Shift+ArrowDown',
      [COMMAND_IDS.exit]: undefined,
    })
  })

  it('can be registered a second time before the first is removed, as hot reload does', () => {
    const removeOld = removeCommands
    removeCommands = registerDefaultCommands()
    expect(listCommands()).toHaveLength(20)
    // The old shell unmounts after the new one has mounted, and removes what it registered.
    removeOld()
    expect(listCommands()).toHaveLength(20)
    expect(shortcutLabel(COMMAND_IDS.toggleSidebar, 'other')).toBe('Ctrl+Shift+B')
  })

  it('can be removed again, and registered again after that', () => {
    removeCommands()
    expect(listCommands()).toEqual([])
    removeCommands = registerDefaultCommands()
    expect(listCommands()).toHaveLength(20)
  })
})

describe('split right', () => {
  it('makes two side-by-side panes from its shortcut, and the new one is active', async () => {
    openNewTab('a.md')
    const first = workbenchLayout.value.activePane
    const event = keydown(keys.splitRight)
    await settle()
    expect(event.defaultPrevented).toBe(true)
    const layout = workbenchLayout.value
    expect(shape(layout)).toBe('row([a.md] [a.md])')
    expect(panesOf(layout)).toHaveLength(2)
    expect(layout.activePane).not.toBe(first)
    expect(findPane(layout, layout.activePane)?.tabs).toHaveLength(1)
  })

  it('works on an empty pane too, and splits only the active pane', async () => {
    openNewTab('a.md')
    await runCommand(COMMAND_IDS.splitRight)
    await runCommand(COMMAND_IDS.splitRight)
    // The second split divides the new pane, which stays in the same row.
    expect(shape(workbenchLayout.value)).toBe('row([a.md] [a.md] [a.md])')
    resetWorkbench()
    await runCommand(COMMAND_IDS.splitRight)
    expect(shape(workbenchLayout.value)).toBe('row([] [])')
  })
})

describe('split down', () => {
  it('makes two stacked panes from its shortcut', async () => {
    openNewTab('a.md')
    const event = keydown(keys.splitDown)
    await settle()
    expect(event.defaultPrevented).toBe(true)
    expect(shape(workbenchLayout.value)).toBe('column([a.md] [a.md])')
  })

  it('nests a column inside a row when the active pane is already in a row', async () => {
    openNewTab('a.md')
    await runCommand(COMMAND_IDS.splitRight)
    await runCommand(COMMAND_IDS.splitDown)
    expect(shape(workbenchLayout.value)).toBe('row([a.md] column([a.md] [a.md]))')
  })
})

describe('close tab', () => {
  it('closes the active tab of the active pane from its shortcut', async () => {
    openNewTab('a.md')
    openNewTab('b.md')
    expect(shape(workbenchLayout.value)).toBe('[a.md,b.md]')
    keydown(keys.closeTab)
    await settle()
    expect(shape(workbenchLayout.value)).toBe('[a.md]')
  })

  it('closes the tab that is active, not the last one', async () => {
    const a = openNewTab('a.md')
    openNewTab('b.md')
    selectTab(a)
    await runCommand(COMMAND_IDS.closeTab)
    expect(shape(workbenchLayout.value)).toBe('[b.md]')
  })

  it('removes a pane when its last tab closes, and leaves a lone pane empty', async () => {
    openNewTab('a.md')
    await runCommand(COMMAND_IDS.splitRight)
    await runCommand(COMMAND_IDS.closeTab)
    expect(shape(workbenchLayout.value)).toBe('[a.md]')
    await runCommand(COMMAND_IDS.closeTab)
    expect(shape(workbenchLayout.value)).toBe('[]')
  })

  it('is disabled with nothing to close, and its key does nothing', async () => {
    expect(getCommand(COMMAND_IDS.closeTab)?.enabled?.()).toBe(false)
    await expect(runCommand(COMMAND_IDS.closeTab)).resolves.toBe(false)
    const event = keydown(keys.closeTab)
    await settle()
    expect(event.defaultPrevented).toBe(true)
    expect(shape(workbenchLayout.value)).toBe('[]')
  })
})

describe('toggle sidebar', () => {
  it('shows and hides the sidebar from its shortcut', async () => {
    const start = sidebarVisible.value
    keydown(keys.toggleSidebar)
    await settle()
    expect(sidebarVisible.value).toBe(!start)
    keydown(keys.toggleSidebar)
    await settle()
    expect(sidebarVisible.value).toBe(start)
  })
})

describe('toggle raw source', () => {
  it('switches the active pane only, from its shortcut', async () => {
    openNewTab('a.md')
    const left = workbenchLayout.value.activePane
    await runCommand(COMMAND_IDS.splitRight)
    const right = workbenchLayout.value.activePane
    expect(right).not.toBe(left)

    keydown(keys.toggleRawSource)
    await settle()
    expect([isRaw(left), isRaw(right)]).toEqual([false, true])
    keydown(keys.toggleRawSource)
    await settle()
    expect([isRaw(left), isRaw(right)]).toEqual([false, false])
  })

  it('is disabled with no tab, and its key does nothing', async () => {
    expect(getCommand(COMMAND_IDS.toggleRawSource)?.enabled?.()).toBe(false)
    await expect(runCommand(COMMAND_IDS.toggleRawSource)).resolves.toBe(false)
    expect(isRaw(workbenchLayout.value.activePane)).toBe(false)
  })
})

describe('exit', () => {
  it('closes the window through the host', async () => {
    await expect(runCommand(COMMAND_IDS.exit)).resolves.toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('keys that are not shortcuts', () => {
  it('change nothing', async () => {
    openNewTab('a.md')
    const before = shape(workbenchLayout.value)
    const ignored = [
      { key: '@', code: 'Digit2', shiftKey: true },
      { key: 'w', code: 'KeyW' },
      { key: '@', code: 'Digit2', ctrlKey: true, altKey: true, shiftKey: true },
      // Ctrl+B was here until P5-T4 made it bold; Ctrl+J is still free.
      { key: 'j', code: 'KeyJ', ctrlKey: true },
    ]
    for (const props of ignored) {
      const event = keydown(props)
      expect(event.defaultPrevented).toBe(false)
    }
    await settle()
    expect(shape(workbenchLayout.value)).toBe(before)
  })
})
