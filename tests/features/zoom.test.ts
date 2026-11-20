// @vitest-environment jsdom
/**
 * Zoom the whole window (P9.1-T3): the three commands, the keys and aliases that run them, Ctrl+wheel,
 * the `view.zoom` setting and what reaches the web view. Real scaling and pointer positions at a
 * zoomed level are checked in a real window (ISA Verification).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDocuments } from '@/documents/store'
import { SETTING_ROWS } from '@/features/settings/rows'
import {
  applySettingsText,
  loadSettings,
  resetSettingsState,
  settingsFileState,
} from '@/features/settings/store'
import { zoomBy, zoomNote, zoomTo } from '@/features/settings/zoom'
import { resetZoomApplied } from '@/features/settings/zoomApply'
import { resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, MOCK_SETTINGS_FILE, type MockHost } from '@/platform/mock'
import { clearCommands, runCommand, shortcutLabel } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { resetWorkbench } from '@/workbench/store'
import { installZoomWheel, WHEEL_PER_STEP } from '@/workbench/zoomWheel'
import { parseJsonc } from '../helpers/jsonc'

let host: MockHost
let removeCommands: (() => void) | undefined
let stops: (() => void)[] = []
let target: EventTarget

async function start(file?: string): Promise<void> {
  host = createMockHost(file === undefined ? {} : { files: { [MOCK_SETTINGS_FILE]: file } })
  setHost(host)
  await loadSettings()
  removeCommands = registerDefaultCommands()
  target = new EventTarget()
  stops = [installKeybindings(target, 'other'), installZoomWheel(target)]
}

const fileObject = (): unknown => {
  const text = host.files.read(MOCK_SETTINGS_FILE)
  return text === undefined ? undefined : parseJsonc(text)
}

/** A key press on the page's target; returns the event so a test can read `defaultPrevented`. */
function press(props: Record<string, unknown>): Event {
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

function wheel(init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

/** Waits until the live zoom setting is `level`. */
const zoomIs = (level: number): Promise<void> =>
  vi.waitFor(() => {
    expect(settings.view.zoom).toBe(level)
  })

beforeEach(() => {
  resetSettings()
  resetSettingsState()
  resetZoomApplied()
})

afterEach(() => {
  for (const stop of stops) stop()
  stops = []
  removeCommands?.()
  removeCommands = undefined
  clearCommands()
  resetDocuments()
  resetWorkbench()
  setHost(undefined)
  vi.useRealTimers()
})

describe('the setting reaches the web view', () => {
  it('sends 100 at start when the file says nothing, so a window left zoomed starts normal', async () => {
    await start()
    expect(settings.view.zoom).toBe(100)
    expect(host.runtime.zooms).toEqual([100])
  })

  it('sends the level the file holds, and a hand edit of the file moves it', async () => {
    await start('{"view": {"zoom": 150}}')
    expect(settings.view.zoom).toBe(150)
    expect(host.runtime.zooms).toEqual([150])
    applySettingsText('{"view": {"zoom": 80}}')
    await vi.waitFor(() => {
      expect(host.runtime.zooms).toEqual([150, 80])
    })
    // The same level again sends nothing.
    applySettingsText('{"view": {"zoom": 80}, "devtools": false}')
    await Promise.resolve()
    expect(host.runtime.zooms).toEqual([150, 80])
  })

  it('keeps the last good level when the file holds a level out of range', async () => {
    await start('{"view": {"zoom": 150}}')
    applySettingsText('{"view": {"zoom": 900}}')
    expect(settingsFileState.problems['view.zoom']).toBeDefined()
    expect(settings.view.zoom).toBe(150)
    expect(host.runtime.zooms).toEqual([150])
  })

  it('has a row on the Appearance screen under Window, and a number field', () => {
    const row = SETTING_ROWS.find((candidate) => candidate.key === 'view.zoom')
    expect(row?.category).toBe('appearance')
    expect(row?.group).toBe('Window')
    expect(row?.control.kind).toBe('number')
  })
})

describe('the commands', () => {
  it('Zoom In and Zoom Out step by 10, write the level to the file and apply it', async () => {
    await start()
    expect(await runCommand(COMMAND_IDS.zoomIn)).toBe(true)
    expect(settings.view.zoom).toBe(110)
    expect(fileObject()).toEqual({ view: { zoom: 110 } })
    expect(host.runtime.zooms).toEqual([100, 110])
    await runCommand(COMMAND_IDS.zoomOut)
    await runCommand(COMMAND_IDS.zoomOut)
    expect(settings.view.zoom).toBe(90)
    expect(host.runtime.zooms).toEqual([100, 110, 100, 90])
  })

  it('Reset Zoom goes back to 100 and takes the key out of the file', async () => {
    await start('{"view": {"zoom": 170}}')
    await runCommand(COMMAND_IDS.zoomReset)
    expect(settings.view.zoom).toBe(100)
    expect(fileObject()).toEqual({})
    expect(host.runtime.zooms).toEqual([170, 100])
  })

  it('steps from a level off the grid to the next one, in either direction', async () => {
    await start('{"view": {"zoom": 105}}')
    await runCommand(COMMAND_IDS.zoomIn)
    expect(settings.view.zoom).toBe(110)
    await zoomTo(105)
    await runCommand(COMMAND_IDS.zoomOut)
    expect(settings.view.zoom).toBe(100)
  })

  it('stops at 50 and at 300', async () => {
    await start('{"view": {"zoom": 300}}')
    await runCommand(COMMAND_IDS.zoomIn)
    expect(settings.view.zoom).toBe(300)
    await zoomTo(50)
    await runCommand(COMMAND_IDS.zoomOut)
    expect(settings.view.zoom).toBe(50)
  })

  it('count every step of a burst asked for before the first write is done', async () => {
    await start()
    await Promise.all([zoomBy(1), zoomBy(1), zoomBy(1)])
    expect(settings.view.zoom).toBe(130)
    await Promise.all([zoomBy(-1), zoomBy(-1)])
    expect(settings.view.zoom).toBe(110)
  })

  it('show the new level in the status bar note, which clears itself', async () => {
    await start()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await zoomBy(1)
    expect(zoomNote.value).toBe('Zoom 110%')
    vi.advanceTimersByTime(5000)
    expect(zoomNote.value).toBe('')
  })

  it('have the keys Ctrl+=, Ctrl+- and Ctrl+0', async () => {
    await start()
    expect(shortcutLabel(COMMAND_IDS.zoomIn, 'other')).toBe('Ctrl+=')
    expect(shortcutLabel(COMMAND_IDS.zoomOut, 'other')).toBe('Ctrl+-')
    expect(shortcutLabel(COMMAND_IDS.zoomReset, 'other')).toBe('Ctrl+0')
  })
})

describe('the keys', () => {
  it('Ctrl+=, Ctrl+Shift+= (a plus) and the numpad plus all zoom in, and are taken from the page', async () => {
    await start()
    const presses = [
      { key: '=', code: 'Equal', ctrlKey: true },
      { key: '+', code: 'Equal', ctrlKey: true, shiftKey: true },
      { key: '+', code: 'NumpadAdd', ctrlKey: true },
    ]
    for (const [index, props] of presses.entries()) {
      expect(press(props).defaultPrevented).toBe(true)
      await zoomIs(110 + index * 10)
    }
  })

  it('Ctrl+- and the numpad minus zoom out, and Ctrl+0 resets, with the main row or the numpad', async () => {
    await start('{"view": {"zoom": 150}}')
    expect(press({ key: '-', code: 'Minus', ctrlKey: true }).defaultPrevented).toBe(true)
    await zoomIs(140)
    press({ key: '-', code: 'NumpadSubtract', ctrlKey: true })
    await zoomIs(130)
    press({ key: '0', code: 'Numpad0', ctrlKey: true })
    await zoomIs(100)
  })

  it('a held zoom key keeps stepping', async () => {
    await start()
    press({ key: '=', code: 'Equal', ctrlKey: true, repeat: true })
    press({ key: '=', code: 'Equal', ctrlKey: true, repeat: true })
    await zoomIs(120)
  })

  it('a plus without Ctrl, or with Alt, is not a zoom, and the page keeps it', async () => {
    await start()
    expect(press({ key: '+', code: 'NumpadAdd' }).defaultPrevented).toBe(false)
    expect(press({ key: '+', code: 'Equal', shiftKey: true }).defaultPrevented).toBe(false)
    const withAlt = press({ key: '+', code: 'NumpadAdd', ctrlKey: true, altKey: true })
    expect(withAlt.defaultPrevented).toBe(false)
    expect(settings.view.zoom).toBe(100)
  })
})

describe('Ctrl+wheel', () => {
  it('zooms in when the wheel turns away from the user and out when it turns toward, and cancels the scroll', async () => {
    await start()
    expect(wheel({ ctrlKey: true, deltaY: -100 }).defaultPrevented).toBe(true)
    await zoomIs(110)
    expect(wheel({ ctrlKey: true, deltaY: 100 }).defaultPrevented).toBe(true)
    await zoomIs(100)
  })

  it('does nothing without Ctrl, and leaves the scroll alone', async () => {
    await start()
    expect(wheel({ deltaY: -100 }).defaultPrevented).toBe(false)
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false)
    await Promise.resolve()
    expect(settings.view.zoom).toBe(100)
    expect(host.runtime.zooms).toEqual([100])
  })

  it('adds up the small events of a touchpad, one step for each WHEEL_PER_STEP of travel', async () => {
    await start()
    const small = -(WHEEL_PER_STEP / 2.5)
    wheel({ ctrlKey: true, deltaY: small })
    wheel({ ctrlKey: true, deltaY: small })
    expect(host.runtime.zooms).toEqual([100])
    wheel({ ctrlKey: true, deltaY: small })
    await zoomIs(110)
  })

  it('reads a wheel counted in lines as 40 pixels a line', async () => {
    await start()
    wheel({ ctrlKey: true, deltaY: -3, deltaMode: WheelEvent.DOM_DELTA_LINE })
    await zoomIs(110)
  })
})
