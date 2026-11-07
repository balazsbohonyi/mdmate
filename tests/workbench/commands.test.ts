import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCommands,
  commandForEvent,
  getCommand,
  isCommandEnabled,
  listCommands,
  registerCommand,
  removeCommand,
  runCommand,
  shortcutLabel,
} from '@/workbench/commands'

const ctrlShiftB = {
  key: 'B',
  code: 'KeyB',
  ctrlKey: true,
  altKey: false,
  shiftKey: true,
  metaKey: false,
}

beforeEach(() => {
  clearCommands()
})

afterEach(() => {
  clearCommands()
})

describe('registering', () => {
  it('holds a command by id and lists it', () => {
    registerCommand({ id: 'a.one', title: 'One', run: vi.fn() })
    expect(getCommand('a.one')?.title).toBe('One')
    expect(listCommands().map((command) => command.id)).toEqual(['a.one'])
    expect(getCommand('a.two')).toBeUndefined()
  })

  it('refuses a second command with the same id', () => {
    registerCommand({ id: 'a.one', title: 'One', run: vi.fn() })
    expect(() => registerCommand({ id: 'a.one', title: 'Again', run: vi.fn() })).toThrow(
      /already registered/,
    )
    expect(getCommand('a.one')?.title).toBe('One')
  })

  it('refuses a shortcut another command holds, however it is spelled', () => {
    registerCommand({ id: 'a.one', title: 'One', keybinding: 'Mod+Shift+B', run: vi.fn() })
    expect(() =>
      registerCommand({ id: 'a.two', title: 'Two', keybinding: 'shift+mod+b', run: vi.fn() }),
    ).toThrow(/held by "a.one"/)
  })

  it('leaves no trace of a command it refused', () => {
    registerCommand({ id: 'a.one', title: 'One', keybinding: 'Mod+Shift+B', run: vi.fn() })
    expect(() =>
      registerCommand({ id: 'a.two', title: 'Two', keybinding: 'Mod+Shift+B', run: vi.fn() }),
    ).toThrow()
    expect(() =>
      registerCommand({ id: 'a.three', title: 'Three', keybinding: 'B', run: vi.fn() }),
    ).toThrow()
    expect(listCommands().map((command) => command.id)).toEqual(['a.one'])
    // A shortcut that was never held stays free for a command that may have it.
    registerCommand({ id: 'a.free', title: 'Free', keybinding: 'Mod+Shift+C', run: vi.fn() })
    expect(listCommands()).toHaveLength(2)
  })

  it('gives a shortcut back when its command is removed', () => {
    const remove = registerCommand({
      id: 'a.one',
      title: 'One',
      keybinding: 'Mod+Shift+B',
      run: vi.fn(),
    })
    remove()
    expect(getCommand('a.one')).toBeUndefined()
    registerCommand({ id: 'a.two', title: 'Two', keybinding: 'Mod+Shift+B', run: vi.fn() })
    expect(commandForEvent(ctrlShiftB, 'other')?.id).toBe('a.two')
  })

  it('removes a command by id, frees its shortcut, and ignores an unknown id', () => {
    registerCommand({ id: 'a.one', title: 'One', keybinding: 'Mod+Shift+B', run: vi.fn() })
    removeCommand('nope')
    removeCommand('a.one')
    expect(getCommand('a.one')).toBeUndefined()
    expect(commandForEvent(ctrlShiftB, 'other')).toBeUndefined()
    registerCommand({ id: 'a.two', title: 'Two', keybinding: 'Mod+Shift+B', run: vi.fn() })
    expect(commandForEvent(ctrlShiftB, 'other')?.id).toBe('a.two')
  })

  it('does not let an old remover take out a newer command with the same id', () => {
    const removeOld = registerCommand({ id: 'a.one', title: 'Old', run: vi.fn() })
    removeOld()
    registerCommand({ id: 'a.one', title: 'New', run: vi.fn() })
    removeOld()
    expect(getCommand('a.one')?.title).toBe('New')
  })
})

describe('running', () => {
  it('runs a command once and says so', async () => {
    const run = vi.fn()
    registerCommand({ id: 'a.one', title: 'One', run })
    await expect(runCommand('a.one')).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('waits for an async command to finish', async () => {
    let done = false
    registerCommand({
      id: 'a.slow',
      title: 'Slow',
      run: async () => {
        await Promise.resolve()
        done = true
      },
    })
    await runCommand('a.slow')
    expect(done).toBe(true)
  })

  it('does nothing for an unknown id', async () => {
    await expect(runCommand('nope')).resolves.toBe(false)
  })

  it('does nothing while the command is disabled, and runs it once it is enabled', async () => {
    let enabled = false
    const run = vi.fn()
    registerCommand({ id: 'a.one', title: 'One', enabled: () => enabled, run })
    expect(isCommandEnabled('a.one')).toBe(false)
    await expect(runCommand('a.one')).resolves.toBe(false)
    expect(run).not.toHaveBeenCalled()
    enabled = true
    expect(isCommandEnabled('a.one')).toBe(true)
    await expect(runCommand('a.one')).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('passes on an error from the command', async () => {
    registerCommand({
      id: 'a.bad',
      title: 'Bad',
      run: () => {
        throw new Error('boom')
      },
    })
    await expect(runCommand('a.bad')).rejects.toThrow('boom')
  })
})

describe('finding a command from a key press', () => {
  it('finds the command whose shortcut the event is', () => {
    registerCommand({ id: 'a.one', title: 'One', keybinding: 'Mod+Shift+B', run: vi.fn() })
    registerCommand({ id: 'a.two', title: 'Two', run: vi.fn() })
    expect(commandForEvent(ctrlShiftB, 'other')?.id).toBe('a.one')
    expect(commandForEvent({ ...ctrlShiftB, shiftKey: false }, 'other')).toBeUndefined()
  })

  it('still finds a disabled command, so its key is taken from the page', () => {
    registerCommand({
      id: 'a.one',
      title: 'One',
      keybinding: 'Mod+Shift+B',
      enabled: () => false,
      run: vi.fn(),
    })
    expect(commandForEvent(ctrlShiftB, 'other')?.id).toBe('a.one')
  })

  it('shows a shortcut as a menu would, and nothing for a command without one', () => {
    registerCommand({ id: 'a.one', title: 'One', keybinding: 'Mod+Shift+B', run: vi.fn() })
    registerCommand({ id: 'a.two', title: 'Two', run: vi.fn() })
    expect(shortcutLabel('a.one', 'other')).toBe('Ctrl+Shift+B')
    expect(shortcutLabel('a.one', 'mac')).toBe('⇧⌘B')
    expect(shortcutLabel('a.two', 'other')).toBeUndefined()
    expect(shortcutLabel('nope', 'other')).toBeUndefined()
  })
})
