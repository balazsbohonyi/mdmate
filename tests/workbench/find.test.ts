// @vitest-environment jsdom
/**
 * The find bar in the pane and the commands that open it (P7-T1): ISC-133 and ISC-134 as the user
 * reaches them (keys, bar, marks), closing it returns the caret to the editor (ISC-263), the bar
 * follows tab switches and splits, and replace is off on a read-only file.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { followerOfTab, openPath, resetDocuments } from '@/documents/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { clearCommands, commandForEvent, getCommand, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { FIND_COUNT_EVENT, type FindCount } from '@/editor/find'
import { focusActiveEditor } from '@/workbench/focus'
import { findBars, findSpec, resetFind, setFind } from '@/workbench/find'
import { installKeybindings } from '@/workbench/keyboard'
import { blockNativeMenu } from '@/lib/nativeMenu'
import { findPane } from '@/workbench/splitTree'
import { resetWorkbench, splitActivePane, workbenchLayout } from '@/workbench/store'
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

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

const FILES: Record<string, string> = {
  '/w/a.md': 'alpha beta alpha\nsecond alpha line\n',
  '/w/b.md': 'beta only here, no a-word\nbeta again\n',
  '/w/locked.md': 'alpha locked alpha\n',
}

let mounted: { app: App; root: HTMLElement } | undefined
let removeCommands: (() => void) | undefined
let uninstallKeys: (() => void) | undefined

beforeEach(async () => {
  const host: MockHost = createMockHost({ files: FILES })
  host.files.markUnsupported('/w/locked.md')
  setHost(host)
  resetDocuments()
  resetWorkbench()
  resetFind()
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
  setHost(undefined)
  resetFind()
})

const activeTab = (): string | null =>
  findPane(workbenchLayout.value, workbenchLayout.value.activePane)?.activeTab ?? null

const bars = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-find-bar]')]
const bar = (): HTMLElement => {
  const found = bars()[0]
  if (found === undefined) throw new Error('no find bar')
  return found
}
const findBox = (): HTMLInputElement => {
  const input = bar().querySelector<HTMLInputElement>('[data-find-input]')
  if (input === null) throw new Error('no find box')
  return input
}
const replaceBox = (): HTMLInputElement => {
  const input = bar().querySelector<HTMLInputElement>('[data-replace-input]')
  if (input === null) throw new Error('no replace box')
  return input
}
const marks = (): number => document.querySelectorAll('.cm-md-find').length
const editorText = (): string => followerOfTab(activeTab() ?? '')?.state.doc.toString() ?? ''
const selection = (): string => {
  const state = followerOfTab(activeTab() ?? '')?.state
  if (state === undefined) return ''
  const { from, to } = state.selection.main
  return state.sliceDoc(from, to)
}
const inEditor = (): boolean => document.activeElement?.closest('.cm-editor') != null

async function type(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}

async function press(
  target: Element,
  key: string,
  init: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  await flush()
  return event
}

async function openA(): Promise<string> {
  const tab = await openPath('/w/a.md')
  await flush()
  return tab
}

describe('the commands and their keys', () => {
  it('Find, Replace, Find Next and Find Previous exist with the keys other editors use', () => {
    expect(getCommand(COMMAND_IDS.find)?.keybinding).toBe('Mod+F')
    expect(getCommand(COMMAND_IDS.replace)?.keybinding).toBe('Mod+H')
    expect(getCommand(COMMAND_IDS.findNext)?.keybinding).toBe('F3')
    expect(getCommand(COMMAND_IDS.findPrevious)?.keybinding).toBe('Shift+F3')
  })

  it('takes Ctrl+F from the page even with no file open, so the browser find never opens', async () => {
    const event = await press(document.body, 'f', { code: 'KeyF', ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(bars()).toHaveLength(0)
    const f3 = await press(document.body, 'F3', { code: 'F3' })
    expect(f3.defaultPrevented).toBe(true)
  })

  it('finds the command for each key press', () => {
    const find = (init: Partial<KeyboardEvent> & { key: string; code: string }) =>
      commandForEvent(
        { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init },
        'other',
      )?.id
    expect(find({ key: 'f', code: 'KeyF', ctrlKey: true })).toBe(COMMAND_IDS.find)
    expect(find({ key: 'h', code: 'KeyH', ctrlKey: true })).toBe(COMMAND_IDS.replace)
    expect(find({ key: 'F3', code: 'F3' })).toBe(COMMAND_IDS.findNext)
    expect(find({ key: 'F3', code: 'F3', shiftKey: true })).toBe(COMMAND_IDS.findPrevious)
  })
})

describe('Ctrl+F finds text in the file (ISC-133)', () => {
  it('opens the bar in the active pane with focus in its box', async () => {
    await openA()
    const event = await press(document.body, 'f', { code: 'KeyF', ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(bars()).toHaveLength(1)
    expect(document.activeElement).toBe(findBox())
  })

  it('marks every match in the file as the query is typed, and shows how many', async () => {
    await openA()
    await runCommand(COMMAND_IDS.find)
    await flush()
    await type(findBox(), 'alpha')
    expect(marks()).toBe(3)
    await new Promise((resolve) => setTimeout(resolve, 30))
    await flush()
    expect(bar().querySelector('[data-find-count]')?.textContent.trim()).toBe('3 results')
  })

  it('says the count stopped, not that nothing was found, when it ran out of time', async () => {
    await openA()
    await runCommand(COMMAND_IDS.find)
    await flush()
    await type(findBox(), 'alpha')
    const pane = document.querySelector('[data-pane-id]')
    const report = async (detail: FindCount): Promise<string> => {
      pane?.dispatchEvent(new CustomEvent(FIND_COUNT_EVENT, { detail }))
      await flush()
      return bar().querySelector('[data-find-count]')?.textContent.trim() ?? ''
    }
    expect(await report({ total: 0, current: 0, capped: false })).toBe('No results')
    expect(await report({ total: 0, current: 0, capped: true })).toBe('Count stopped')
    expect(await report({ total: 700, current: 0, capped: true })).toBe('700+ results')
    expect(await report({ total: 700, current: 3, capped: true })).toBe('3 of 700+')
  })

  it('Enter selects the next match and Shift+Enter the previous one, focus staying in the box', async () => {
    await openA()
    await runCommand(COMMAND_IDS.find)
    await flush()
    await type(findBox(), 'alpha')
    await press(findBox(), 'Enter')
    expect(selection()).toBe('alpha')
    expect(followerOfTab(activeTab() ?? '')?.state.selection.main.from).toBe(0)
    await press(findBox(), 'Enter')
    expect(followerOfTab(activeTab() ?? '')?.state.selection.main.from).toBe(11)
    await press(findBox(), 'Enter', { shiftKey: true })
    expect(followerOfTab(activeTab() ?? '')?.state.selection.main.from).toBe(0)
    expect(document.activeElement).toBe(findBox())
    expect(document.querySelectorAll('.cm-md-find-active')).toHaveLength(1)
  })

  it('takes the selected word as the query when it opens', async () => {
    const tab = await openA()
    followerOfTab(tab)?.dispatch({ selection: { anchor: 6, head: 10 } })
    await runCommand(COMMAND_IDS.find)
    await flush()
    expect(findBox().value).toBe('beta')
    expect(marks()).toBe(1)
  })

  it('F3 and Shift+F3 step through matches with no bar open, opening one', async () => {
    await openA()
    setFind({ search: 'alpha' })
    focusActiveEditor()
    await flush()
    expect(inEditor()).toBe(true)
    const event = await press(document.body, 'F3', { code: 'F3' })
    expect(event.defaultPrevented).toBe(true)
    expect(bars()).toHaveLength(1)
    expect(selection()).toBe('alpha')
    // F3 steps through matches while you write: it never moves the caret into the bar.
    expect(inEditor()).toBe(true)
    await press(document.body, 'F3', { code: 'F3' })
    expect(followerOfTab(activeTab() ?? '')?.state.selection.main.from).toBe(11)
    await press(document.body, 'F3', { code: 'F3', shiftKey: true })
    expect(followerOfTab(activeTab() ?? '')?.state.selection.main.from).toBe(0)
  })

  it('the switches change what matches, and a bad pattern is explained', async () => {
    await openA()
    await runCommand(COMMAND_IDS.find)
    await flush()
    await type(findBox(), 'ALPHA')
    expect(marks()).toBe(3)
    bar().querySelector<HTMLElement>('[aria-label="Match case"]')?.click()
    await flush()
    expect(marks()).toBe(0)
    bar().querySelector<HTMLElement>('[aria-label="Match case"]')?.click()
    bar().querySelector<HTMLElement>('[aria-label="Regular expression"]')?.click()
    await type(findBox(), 'al(')
    expect(marks()).toBe(0)
    expect(bar().querySelector('[role=alert]')?.textContent).toMatch(/regular expression/i)
    await type(findBox(), 'al\\w+')
    expect(marks()).toBe(3)
    expect(bar().querySelector('[role=alert]')).toBeNull()
  })

  it('whole word skips a match inside a longer word (ISC-265)', async () => {
    await openA()
    await runCommand(COMMAND_IDS.find)
    await flush()
    await type(findBox(), 'alph')
    expect(marks()).toBe(3)
    bar().querySelector<HTMLElement>('[aria-label="Whole word"]')?.click()
    await flush()
    expect(marks()).toBe(0)
    await type(findBox(), 'alpha')
    expect(marks()).toBe(3)
  })
})

describe('closing the bar returns the caret to the editor (ISC-263)', () => {
  it('Escape in the find box closes the bar, clears the marks and focuses the editor', async () => {
    await openA()
    await runCommand(COMMAND_IDS.find)
    await flush()
    await type(findBox(), 'alpha')
    expect(marks()).toBe(3)
    const event = await press(findBox(), 'Escape')
    expect(event.defaultPrevented).toBe(true)
    expect(bars()).toHaveLength(0)
    expect(marks()).toBe(0)
    expect(inEditor()).toBe(true)
  })

  it('Escape in the replace box and the close button do the same', async () => {
    await openA()
    await runCommand(COMMAND_IDS.replace)
    await flush()
    await press(replaceBox(), 'Escape')
    expect(bars()).toHaveLength(0)
    expect(inEditor()).toBe(true)
    await runCommand(COMMAND_IDS.find)
    await flush()
    bar().querySelector<HTMLElement>('[aria-label="Close find"]')?.click()
    await flush()
    expect(bars()).toHaveLength(0)
    expect(inEditor()).toBe(true)
  })

  it('keeps the query for the next time the bar opens', async () => {
    await openA()
    await runCommand(COMMAND_IDS.find)
    await flush()
    await type(findBox(), 'beta')
    await press(findBox(), 'Escape')
    await runCommand(COMMAND_IDS.find)
    await flush()
    expect(findBox().value).toBe('beta')
    expect(marks()).toBe(1)
    expect(document.activeElement).toBe(findBox())
  })
})

describe('Ctrl+H replaces text in the file (ISC-134)', () => {
  it('opens the replace row, and Replace all changes every match in one step', async () => {
    const tab = await openA()
    await runCommand(COMMAND_IDS.replace)
    await flush()
    expect(replaceBox()).toBeDefined()
    await type(findBox(), 'alpha')
    await type(replaceBox(), 'omega')
    const all = [...bar().querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Replace all',
    )
    all?.click()
    await flush()
    expect(editorText()).toBe('omega beta omega\nsecond omega line\n')
    // One undo gives all three back.
    followerOfTab(tab)?.undo()
    expect(editorText()).toBe('alpha beta alpha\nsecond alpha line\n')
  })

  it('Enter in the replace box replaces the selected match and moves to the next', async () => {
    await openA()
    await runCommand(COMMAND_IDS.replace)
    await flush()
    await type(findBox(), 'alpha')
    await type(replaceBox(), 'omega')
    await press(replaceBox(), 'Enter')
    expect(selection()).toBe('alpha')
    await press(replaceBox(), 'Enter')
    expect(editorText()).toBe('omega beta alpha\nsecond alpha line\n')
  })

  it('Ctrl+F on an open bar keeps the replace row, and the chevron hides it', async () => {
    await openA()
    await runCommand(COMMAND_IDS.replace)
    await runCommand(COMMAND_IDS.find)
    await flush()
    expect(replaceBox()).toBeDefined()
    bar().querySelector<HTMLElement>('[aria-label="Toggle replace"]')?.click()
    await flush()
    expect(bar().querySelector('[data-replace-input]')).toBeNull()
  })
})

describe('Replace is off on a read-only file (ISC-259)', () => {
  it('disables the buttons and leaves the text alone, while Find still marks matches', async () => {
    await openPath('/w/locked.md')
    await flush()
    await runCommand(COMMAND_IDS.replace)
    await flush()
    await type(findBox(), 'alpha')
    expect(marks()).toBe(2)
    const buttons = [...bar().querySelectorAll('button')].filter((b) =>
      ['Replace', 'Replace all'].includes(b.textContent.trim()),
    )
    expect(buttons).toHaveLength(2)
    for (const button of buttons) expect(button.disabled).toBe(true)
    await type(replaceBox(), 'x')
    await press(replaceBox(), 'Enter')
    expect(editorText()).toBe('alpha locked alpha\n')
    expect(bar().textContent).toContain('read-only')
  })
})

describe('no browser menu on the bar (ISC-251)', () => {
  it('a right click on the boxes and the buttons opens no browser menu', async () => {
    const stop = blockNativeMenu()
    try {
      await openA()
      await runCommand(COMMAND_IDS.replace)
      await flush()
      const targets = [
        findBox(),
        replaceBox(),
        bar().querySelector<HTMLElement>('[aria-label="Match case"]'),
        bar().querySelector<HTMLElement>('[data-find-count]'),
      ]
      for (const target of targets) {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
        target?.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
      }
    } finally {
      stop()
    }
  })
})

describe('the bar belongs to the pane', () => {
  it('stays open when another tab is shown, searching it, and the tab left shows no marks', async () => {
    const a = await openA()
    const b = await openPath('/w/b.md')
    await flush()
    // b is shown now; go back to a, open the bar and search.
    expect(activeTab()).toBe(b)
    await runCommand(COMMAND_IDS.find)
    await flush()
    await type(findBox(), 'beta')
    expect(marks()).toBe(2)
    const { selectTab } = await import('@/workbench/store')
    selectTab(a)
    await flush()
    expect(bars()).toHaveLength(1)
    expect(findBox().value).toBe('beta')
    expect(marks()).toBe(1)
    selectTab(b)
    await flush()
    expect(marks()).toBe(2)
  })

  it('a closed bar leaves no query on any tab', async () => {
    const a = await openA()
    const b = await openPath('/w/b.md')
    await flush()
    await runCommand(COMMAND_IDS.find)
    await flush()
    await type(findBox(), 'beta')
    const { selectTab } = await import('@/workbench/store')
    selectTab(a)
    await flush()
    await press(findBox(), 'Escape')
    selectTab(b)
    await flush()
    expect(marks()).toBe(0)
    selectTab(a)
    await flush()
    expect(marks()).toBe(0)
  })

  it('each pane has its own bar, sharing the query', async () => {
    await openA()
    splitActivePane('row')
    await flush()
    await runCommand(COMMAND_IDS.find)
    await flush()
    expect(bars()).toHaveLength(1)
    await type(findBox(), 'alpha')
    expect(findSpec.value.search).toBe('alpha')
    const firstPane = workbenchLayout.value.activePane
    expect([...findBars.keys()]).toEqual([firstPane])
    expect(document.querySelectorAll('[data-pane-id]')).toHaveLength(2)
  })
})
