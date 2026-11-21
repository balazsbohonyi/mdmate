// @vitest-environment jsdom
/**
 * Ctrl+Tab cycles the tab-list menu of the focused pane and Ctrl+PageUp / Ctrl+PageDown switch
 * tabs directly (P9.1-T12, ISC-601 to ISC-603). The cycle state is tested pure, then through the
 * real keys, commands and workbench drawn together, as in the app. jsdom cannot say whether
 * WebView2 hands Ctrl+Tab to the page; that is ISC-604, checked in the real window.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { openPath, resetDocuments } from '@/documents/store'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import {
  clearCommands,
  getCommand,
  runCommand,
  setKeybindingOverrides,
  shortcutLabel,
} from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { findPane, panesOf } from '@/workbench/splitTree'
import {
  focusPane,
  pinTabById,
  resetWorkbench,
  selectTab,
  splitActivePane,
  workbenchLayout,
} from '@/workbench/store'
import {
  markedTab,
  neighbourTab,
  resetTabCycle,
  startCycle,
  stepCycle,
  tabCycle,
} from '@/workbench/tabCycle'
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

afterAll(() => {
  document.body.replaceChildren()
})

/** For a value the test has just made sure exists. */
function fail(): never {
  throw new Error('expected a value')
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

describe('the cycle state (ISC-601, ISC-602)', () => {
  const ids = ['a', 'b', 'c']

  it('starts on the next tab, or the previous one, and wraps', () => {
    expect(markedTab(startCycle('p1', ids, 'b', 'next') ?? fail())).toBe('c')
    expect(markedTab(startCycle('p1', ids, 'c', 'next') ?? fail())).toBe('a')
    expect(markedTab(startCycle('p1', ids, 'a', 'previous') ?? fail())).toBe('c')
    expect(markedTab(startCycle('p1', ids, 'b', 'previous') ?? fail())).toBe('a')
  })

  it('steps on from the mark, either way, and wraps', () => {
    let state = startCycle('p1', ids, 'b', 'next') ?? fail()
    state = stepCycle(state, 'next')
    expect(markedTab(state)).toBe('a')
    state = stepCycle(state, 'next')
    expect(markedTab(state)).toBe('b')
    state = stepCycle(state, 'previous')
    expect(markedTab(state)).toBe('a')
    state = stepCycle(state, 'previous')
    expect(markedTab(state)).toBe('c')
  })

  it('does not start with fewer than two tabs', () => {
    expect(startCycle('p1', ['a'], 'a', 'next')).toBeNull()
    expect(startCycle('p1', [], null, 'next')).toBeNull()
  })

  it('starts from the first tab when the active tab is not in the list', () => {
    expect(markedTab(startCycle('p1', ids, null, 'next') ?? fail())).toBe('b')
  })

  it('finds the neighbour for the direct keys, wrapping at the ends', () => {
    expect(neighbourTab(ids, 'c', 'next')).toBe('a')
    expect(neighbourTab(ids, 'a', 'previous')).toBe('c')
    expect(neighbourTab(ids, 'b', 'next')).toBe('c')
    expect(neighbourTab(ids, 'b', 'previous')).toBe('a')
    expect(neighbourTab(['a'], 'a', 'next')).toBeNull()
  })
})

let mounted: { app: App; root: HTMLElement } | undefined
let removeCommands: (() => void) | undefined
let uninstallKeys: (() => void) | undefined

beforeEach(async () => {
  setHost(
    createMockHost({
      files: { '/w/a.md': 'a\n', '/w/b.md': 'b\n', '/w/c.md': 'c\n', '/w/d.md': 'd\n' },
    }),
  )
  resetDocuments()
  resetWorkbench()
  resetTabCycle()
  clearCommands()
  removeCommands = registerDefaultCommands()
  uninstallKeys = installKeybindings(document, 'other')
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h(TooltipProvider, { delayDuration: 0 }, () => h(WorkbenchView)),
  })
  app.mount(root)
  mounted = { app, root }
  await flush()
})

afterEach(() => {
  uninstallKeys?.()
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  document.body.replaceChildren()
  removeCommands?.()
  clearCommands()
  resetTabCycle()
  setHost(undefined)
})

/** Opens the files in the active pane, in order; the last one ends up active. */
async function open(...names: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const name of names) ids.push(await openPath(`/w/${name}.md`))
  await flush()
  return ids
}

const activePane = () => findPane(workbenchLayout.value, workbenchLayout.value.activePane)
const activeTab = (): string | null => activePane()?.activeTab ?? null

function press(props: Record<string, unknown>, type: 'keydown' | 'keyup' = 'keydown'): Event {
  const event = Object.assign(new Event(type, { cancelable: true, bubbles: true }), {
    key: '',
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...props,
  })
  document.dispatchEvent(event)
  return event
}

const CTRL_TAB = { key: 'Tab', code: 'Tab', ctrlKey: true }
const CTRL_SHIFT_TAB = { key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true }
const PAGE_DOWN = { key: 'PageDown', code: 'PageDown', ctrlKey: true }
const PAGE_UP = { key: 'PageUp', code: 'PageUp', ctrlKey: true }
const releaseCtrl = (): Event => press({ key: 'Control', code: 'ControlLeft' }, 'keyup')

const menu = (): HTMLElement | null => document.body.querySelector('[data-tab-list-menu]')
const markedRow = (): string | undefined =>
  document.body
    .querySelector<HTMLElement>('[data-tab-list-item][data-marked=true]')
    ?.getAttribute('data-tab-list-item') ?? undefined

describe('Ctrl+Tab and Ctrl+Shift+Tab (ISC-601)', () => {
  it('open the menu with the next tab marked, move the mark on, and switch when Ctrl goes up', async () => {
    const [a, b, c] = await open('a', 'b', 'c')
    selectTab(b ?? fail())
    await flush()
    expect(press(CTRL_TAB).defaultPrevented).toBe(true)
    await flush()
    expect(menu()).not.toBeNull()
    expect(markedRow()).toBe(c)
    expect(activeTab()).toBe(b)

    press(CTRL_TAB)
    await flush()
    expect(markedRow()).toBe(a)
    expect(activeTab()).toBe(b)

    releaseCtrl()
    await flush()
    expect(activeTab()).toBe(a)
    expect(menu()).toBeNull()
    expect(tabCycle.value).toBeNull()
  })

  it('go back from the previous tab with Shift, wrapping to the last tab', async () => {
    const [a, , c] = await open('a', 'b', 'c')
    selectTab(a ?? fail())
    await flush()
    press(CTRL_SHIFT_TAB)
    await flush()
    expect(markedRow()).toBe(c)
    press(CTRL_SHIFT_TAB)
    await flush()
    expect(markedRow()).not.toBe(c)
    press(CTRL_TAB)
    await flush()
    expect(markedRow()).toBe(c)
    releaseCtrl()
    await flush()
    expect(activeTab()).toBe(c)
  })

  it('also move on with a plain Tab or Down, and back with Shift+Tab or Up, while it is open', async () => {
    const [a, b, c] = await open('a', 'b', 'c')
    selectTab(a ?? fail())
    await flush()
    press(CTRL_TAB)
    await flush()
    expect(markedRow()).toBe(b)
    expect(press({ key: 'Tab', code: 'Tab' }).defaultPrevented).toBe(true)
    await flush()
    expect(markedRow()).toBe(c)
    expect(press({ key: 'ArrowDown', code: 'ArrowDown' }).defaultPrevented).toBe(true)
    await flush()
    expect(markedRow()).toBe(a)
    press({ key: 'ArrowUp', code: 'ArrowUp' })
    await flush()
    expect(markedRow()).toBe(c)
    press({ key: 'Tab', code: 'Tab', shiftKey: true })
    await flush()
    expect(markedRow()).toBe(b)
    releaseCtrl()
    await flush()
    expect(activeTab()).toBe(b)
  })

  it('leave the keys alone when no cycle is open', async () => {
    await open('a', 'b')
    expect(press({ key: 'Tab', code: 'Tab' }).defaultPrevented).toBe(false)
    expect(press({ key: 'ArrowDown', code: 'ArrowDown' }).defaultPrevented).toBe(false)
    expect(press({ key: 'Escape', code: 'Escape' }).defaultPrevented).toBe(false)
  })

  it('leave the focus where it was, and the menu open, while the cycle runs', async () => {
    await open('a', 'b', 'c')
    const before = document.activeElement
    press(CTRL_TAB)
    await flush()
    expect(menu()).not.toBeNull()
    expect(document.activeElement).toBe(before)
    press(CTRL_TAB)
    await flush()
    expect(menu()).not.toBeNull()
    expect(document.activeElement).toBe(before)
  })

  it('put the caret in the editor of the tab it switched to', async () => {
    const [a] = await open('a', 'b')
    press(CTRL_TAB)
    await flush()
    releaseCtrl()
    await flush()
    expect(activeTab()).toBe(a)
    expect(document.activeElement?.closest('.cm-editor')).not.toBeNull()
  })

  it('cancel with Escape, with no switch, and take the key', async () => {
    const [, b] = await open('a', 'b', 'c')
    selectTab(b ?? fail())
    await flush()
    press(CTRL_TAB)
    await flush()
    expect(menu()).not.toBeNull()
    expect(press({ key: 'Escape', code: 'Escape' }).defaultPrevented).toBe(true)
    await flush()
    expect(menu()).toBeNull()
    expect(tabCycle.value).toBeNull()
    releaseCtrl()
    await flush()
    expect(activeTab()).toBe(b)
  })

  it('cancel when the window loses focus, so a lost key release never leaves it open', async () => {
    const [, b] = await open('a', 'b', 'c')
    selectTab(b ?? fail())
    await flush()
    press(CTRL_TAB)
    await flush()
    window.dispatchEvent(new Event('blur'))
    await flush()
    expect(tabCycle.value).toBeNull()
    expect(menu()).toBeNull()
    expect(activeTab()).toBe(b)
  })

  it('cancel when the focused pane changes', async () => {
    const [a] = await open('a', 'b', 'c')
    splitActivePane('row')
    await flush()
    const [first, second] = panesOf(workbenchLayout.value)
    focusPane(first?.id ?? fail())
    press(CTRL_TAB)
    await flush()
    expect(tabCycle.value?.paneId).toBe(first?.id)
    focusPane(second?.id ?? fail())
    await flush()
    expect(tabCycle.value).toBeNull()
    expect(a).toBeDefined()
  })

  it('do nothing in a pane with one tab', async () => {
    await open('a')
    press(CTRL_TAB)
    await flush()
    expect(tabCycle.value).toBeNull()
    expect(menu()).toBeNull()
  })

  it('take the key from the page even when there is nothing to cycle', async () => {
    await open('a')
    expect(press(CTRL_TAB).defaultPrevented).toBe(true)
    expect(press(PAGE_DOWN).defaultPrevented).toBe(true)
  })
})

describe('the focused pane, and pinned tabs (ISC-602)', () => {
  it('cycles the tabs of the focused pane only, in each pane in turn', async () => {
    const [a, b] = await open('a', 'b')
    splitActivePane('row')
    await flush()
    const [first, second] = panesOf(workbenchLayout.value)
    // The new pane holds a copy of b. Give it a second tab of its own.
    focusPane(second?.id ?? fail())
    const d = await openPath('/w/d.md')
    await flush()
    const rightTabs = findPane(workbenchLayout.value, second?.id ?? '')?.tabs ?? []
    expect(rightTabs).toHaveLength(2)

    press(CTRL_TAB)
    await flush()
    expect(tabCycle.value?.paneId).toBe(second?.id)
    expect(tabCycle.value?.ids).toEqual(rightTabs)
    releaseCtrl()
    await flush()
    expect(findPane(workbenchLayout.value, second?.id ?? '')?.activeTab).not.toBe(d)
    expect(findPane(workbenchLayout.value, first?.id ?? '')?.activeTab).toBe(b)

    focusPane(first?.id ?? fail())
    press(CTRL_TAB)
    await flush()
    expect(tabCycle.value?.paneId).toBe(first?.id)
    expect(tabCycle.value?.ids).toEqual([a, b])
    releaseCtrl()
    await flush()
    expect(findPane(workbenchLayout.value, first?.id ?? '')?.activeTab).toBe(a)
  })

  it('lists pinned tabs first, in strip order, and marks the row of that order', async () => {
    const [a, b, c] = await open('a', 'b', 'c')
    pinTabById(c ?? fail())
    await flush()
    const order = activePane()?.tabs ?? []
    expect(order).toEqual([c, a, b])
    selectTab(c ?? fail())
    await flush()
    press(CTRL_TAB)
    await flush()
    expect(tabCycle.value?.ids).toEqual([c, a, b])
    expect(markedRow()).toBe(a)
    const rows = [...document.body.querySelectorAll('[data-tab-list-item]')].map((row) =>
      row.getAttribute('data-tab-list-item'),
    )
    expect(rows).toEqual([c, a, b])
  })
})

describe('Ctrl+PageDown and Ctrl+PageUp (ISC-603)', () => {
  it('select the next and previous tab at once, with no menu, wrapping at the ends', async () => {
    const [a, b, c] = await open('a', 'b', 'c')
    expect(activeTab()).toBe(c)
    press(PAGE_DOWN)
    await flush()
    expect(activeTab()).toBe(a)
    press(PAGE_UP)
    await flush()
    expect(activeTab()).toBe(c)
    press(PAGE_UP)
    await flush()
    expect(activeTab()).toBe(b)
    press(PAGE_DOWN)
    await flush()
    expect(activeTab()).toBe(c)
    expect(menu()).toBeNull()
    expect(tabCycle.value).toBeNull()
  })

  it('repeat while the key is held', async () => {
    const [a, b, c] = await open('a', 'b', 'c')
    press({ ...PAGE_UP })
    press({ ...PAGE_UP, repeat: true })
    await flush()
    expect(activeTab()).toBe(a)
    expect(b).toBeDefined()
    expect(c).toBeDefined()
  })

  it('do nothing in a pane with one tab, and still take the key', async () => {
    const [a] = await open('a')
    expect(press(PAGE_DOWN).defaultPrevented).toBe(true)
    await flush()
    expect(activeTab()).toBe(a)
  })
})

describe('the four commands (ISC-604)', () => {
  it('are in Tabs & Navigation with the default shortcuts, and show where shortcuts show', () => {
    const shown = (id: string): string | undefined => shortcutLabel(id, 'other')
    expect(shown(COMMAND_IDS.cycleTabs)).toBe('Ctrl+Tab')
    expect(shown(COMMAND_IDS.cycleTabsBack)).toBe('Ctrl+Shift+Tab')
    expect(shown(COMMAND_IDS.nextTab)).toBe('Ctrl+PageDown')
    expect(shown(COMMAND_IDS.previousTab)).toBe('Ctrl+PageUp')
    for (const id of [
      COMMAND_IDS.cycleTabs,
      COMMAND_IDS.cycleTabsBack,
      COMMAND_IDS.nextTab,
      COMMAND_IDS.previousTab,
    ]) {
      expect(getCommand(id)?.group).toBe('Tabs & Navigation')
    }
  })

  it('run from the palette, which has no key to release, by switching tabs at once', async () => {
    const [a, b] = await open('a', 'b')
    expect(activeTab()).toBe(b)
    await runCommand(COMMAND_IDS.cycleTabs)
    await flush()
    expect(activeTab()).toBe(a)
    expect(tabCycle.value).toBeNull()
    expect(menu()).toBeNull()
    await runCommand(COMMAND_IDS.cycleTabsBack)
    await flush()
    expect(activeTab()).toBe(b)
  })

  it('can be rebound, and the cycle then ends when the modifier of that chord goes up', async () => {
    const [a, b] = await open('a', 'b', 'c')
    setKeybindingOverrides({ [COMMAND_IDS.cycleTabs]: 'Alt+J' })
    selectTab(b ?? fail())
    await flush()
    const chord = { key: 'j', code: 'KeyJ', altKey: true }
    press(chord)
    await flush()
    expect(tabCycle.value).not.toBeNull()
    // Ctrl is not part of this chord, so its release changes nothing.
    releaseCtrl()
    await flush()
    expect(tabCycle.value).not.toBeNull()
    press({ key: 'Alt', code: 'AltLeft' }, 'keyup')
    await flush()
    expect(tabCycle.value).toBeNull()
    expect(activeTab()).not.toBe(b)
    expect(a).toBeDefined()
  })
})

describe('the menu (ISC-601)', () => {
  it('marks one row at a time, with the row that is shown as the tab being left still checked', async () => {
    const [, b, c] = await open('a', 'b', 'c')
    selectTab(b ?? fail())
    await flush()
    press(CTRL_TAB)
    await flush()
    const marked = document.body.querySelectorAll('[data-tab-list-item][data-marked=true]')
    expect(marked).toHaveLength(1)
    expect(marked[0]?.getAttribute('data-tab-list-item')).toBe(c)
    const checks = [...document.body.querySelectorAll('[data-tab-list-item]')].filter((row) =>
      row.querySelector('svg')?.classList.contains('opacity-100'),
    )
    expect(checks.map((row) => row.getAttribute('data-tab-list-item'))).toEqual([b])
  })

  it('still opens from the chevron, with no row marked', async () => {
    await open('a', 'b')
    const chevron = document.body.querySelector<HTMLElement>('[data-tab-list]')
    chevron?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
    )
    await flush()
    expect(menu()).not.toBeNull()
    expect(document.body.querySelector('[data-tab-list-item][data-marked=true]')).toBeNull()
    expect(tabCycle.value).toBeNull()
  })
})
