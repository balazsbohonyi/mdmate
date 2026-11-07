import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCommands, registerCommand } from '@/workbench/commands'
import { installKeybindings } from '@/workbench/keyboard'

let target: EventTarget
let uninstall: () => void

/** Sends a keydown and returns the event, so a test can read `defaultPrevented`. */
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

const ctrlShiftB = { key: 'B', code: 'KeyB', ctrlKey: true, shiftKey: true }

/** Lets the promise a command run returns settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function registerSidebar(run: () => void, enabled?: () => boolean) {
  registerCommand({
    id: 'a.one',
    title: 'One',
    keybinding: 'Mod+Shift+B',
    ...(enabled === undefined ? {} : { enabled }),
    run,
  })
}

beforeEach(() => {
  clearCommands()
  target = new EventTarget()
  uninstall = installKeybindings(target, 'other')
})

afterEach(() => {
  uninstall()
  clearCommands()
  vi.restoreAllMocks()
})

describe('keyboard shortcuts', () => {
  it('run the command, once, and take the key from the page', async () => {
    const run = vi.fn()
    registerSidebar(run)
    const event = keydown(ctrlShiftB)
    await settle()
    expect(run).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('leave every other key alone', async () => {
    const run = vi.fn()
    registerSidebar(run)
    const event = keydown({ key: 'b', code: 'KeyB', ctrlKey: true })
    await settle()
    expect(run).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('stand down when something else already handled the key', async () => {
    const run = vi.fn()
    registerSidebar(run)
    // Node's EventTarget runs listeners in the order they were added, so the other handler has to
    // be added before ours to be the one that gets the key first.
    uninstall()
    target.addEventListener('keydown', (event) => {
      event.preventDefault()
    })
    uninstall = installKeybindings(target, 'other')
    keydown(ctrlShiftB)
    await settle()
    expect(run).not.toHaveBeenCalled()
  })

  it('ignore a key that is part of typing with an input method', async () => {
    const run = vi.fn()
    registerSidebar(run)
    const event = keydown({ ...ctrlShiftB, isComposing: true })
    await settle()
    expect(run).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('take a held key from the page but run the command only once', async () => {
    const run = vi.fn()
    registerSidebar(run)
    keydown(ctrlShiftB)
    const repeat = keydown({ ...ctrlShiftB, repeat: true })
    keydown({ ...ctrlShiftB, repeat: true })
    await settle()
    expect(run).toHaveBeenCalledTimes(1)
    expect(repeat.defaultPrevented).toBe(true)
  })

  it('take the key from the page even when the command is disabled, and do nothing', async () => {
    const run = vi.fn()
    registerSidebar(run, () => false)
    const event = keydown(ctrlShiftB)
    await settle()
    expect(run).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('log a command that throws instead of raising it into the page', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    registerSidebar(() => {
      throw new Error('boom')
    })
    keydown(ctrlShiftB)
    await settle()
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('stop when uninstalled', async () => {
    const run = vi.fn()
    registerSidebar(run)
    uninstall()
    const event = keydown(ctrlShiftB)
    await settle()
    expect(run).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignore events that are not keyboard events', async () => {
    const run = vi.fn()
    registerSidebar(run)
    target.dispatchEvent(new Event('keydown'))
    await settle()
    expect(run).not.toHaveBeenCalled()
  })
})
