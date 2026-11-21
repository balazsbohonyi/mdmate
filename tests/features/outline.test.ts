// @vitest-environment jsdom
/**
 * The outline (P7-T3): the sidebar's Outline tab, its list of headings, what a click, Enter or a
 * double click do with one, and when the document is scanned. The panel is drawn inside the real
 * sidebar frame next to the real panes, on the browser mock's scan. The scan itself (every rule of
 * what is a heading, a 10 MB file) is proven in Rust and by the parity table; this checks the page
 * around it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { contrast, parseColor } from '@/lib/color'
import {
  activeDocument,
  followerOfTab,
  openPath,
  resetDocuments,
  saveDocument,
} from '@/documents/store'
import {
  OUTLINE_DEBOUNCE_MS,
  outlineState,
  resetOutline,
  selectedHeading,
} from '@/features/outline/store'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import { setHost, type OutlineAnswer, type OutlineRequest } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import SidebarFrame from '@/shell/SidebarFrame.vue'
import { clearCommands, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetFind } from '@/workbench/find'
import { resetSidebar, showSidebar, sidebarPanel } from '@/workbench/sidebar'
import { findPane } from '@/workbench/splitTree'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'
import WorkbenchView from '@/workbench/WorkbenchView.vue'

class FakeObserver {
  observe = (): undefined => undefined
  unobserve = (): undefined => undefined
  disconnect = (): undefined => undefined
}
Object.assign(globalThis, { ResizeObserver: FakeObserver })

beforeAll(() => {
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 8; round++) {
    await settle()
    await nextTick()
  }
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
/** Waits past the debounce, so a scan that was asked for has been sent and answered. */
const pause = async (): Promise<void> => {
  await sleep(OUTLINE_DEBOUNCE_MS + 120)
  await flush()
}

const FILES: Record<string, string> = {
  '/work/a.md':
    '# Alpha\n\nintro\n\n## Beta **bold**\n\ntext\n\n### Gamma [link](x.md)\n\n# Delta\n',
  '/work/b.md': '# Other\n\n## Second\n',
  '/work/plain.txt': '# not a heading in a text file\n',
  '/work/none.md': 'just words\n',
}

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined
let removeCommands: (() => void) | undefined
/** Every request the page sent to the scan, in order. */
let asked: OutlineRequest[] = []

function mount(): void {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () =>
      h(TooltipProvider, { delayDuration: 0 }, () => [h(SidebarFrame), h(WorkbenchView)]),
  })
  app.mount(root)
  mounted = { app, root }
}

async function start(files: Record<string, string> = FILES): Promise<void> {
  host = createMockHost({ files, roots: ['/work'] })
  asked = []
  const real = host.outlineScan.bind(host)
  host.outlineScan = (request) => {
    asked.push(request)
    return real(request)
  }
  setHost(host)
  await restoreWorkspace([])
  mount()
  await flush()
}

const list = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[data-outline-list]')
  if (element === null) throw new Error('no outline list')
  return element
}
const rows = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-outline-heading]'),
]
const texts = (): string[] => rows().map((row) => row.textContent?.trim() ?? '')
const message = (): string =>
  document.querySelector('[data-outline-message]')?.textContent?.trim() ?? ''

/** Waits for something the lazy panel draws; its module loads the first time it is shown. */
async function until(ready: () => boolean): Promise<void> {
  for (let tries = 0; tries < 400 && !ready(); tries++) await settle()
  await flush()
}

async function openOutline(): Promise<void> {
  await runCommand(COMMAND_IDS.showOutline)
  await until(() => document.querySelector('[data-outline]') !== null)
  await flush()
}

async function openFile(path: string): Promise<string> {
  const tab = await openPath(path)
  await flush()
  return tab
}

const caretLine = (): number => {
  const doc = activeDocument()
  if (doc === undefined) return 0
  const layout = workbenchLayout.value
  const tab = findPane(layout, layout.activePane)?.activeTab
  const state = tab === null || tab === undefined ? undefined : followerOfTab(tab)?.state
  return state === undefined ? 0 : state.doc.lineAt(state.selection.main.head).number
}
const activeFollower = () => {
  const layout = workbenchLayout.value
  const tab = findPane(layout, layout.activePane)?.activeTab
  const follower = tab === null || tab === undefined ? undefined : followerOfTab(tab)
  if (follower === undefined) throw new Error('no active editor')
  return follower
}
const editorHasFocus = (): boolean => document.activeElement?.closest('.cm-editor') != null

async function press(key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  list().dispatchEvent(event)
  await flush()
  return event
}

beforeEach(() => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  resetSidebar()
  resetOutline()
  resetFind()
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
  resetOutline()
  resetTree()
})

describe('the Outline tab', () => {
  it('is in the sidebar header, and its panel is not drawn until it is shown', async () => {
    await start()
    const tabs = [...document.querySelectorAll('[data-sidebar-tab]')].map(
      (tab) => (tab as HTMLElement).dataset.sidebarTab,
    )
    expect(tabs).toEqual(['folders', 'search', 'outline'])
    expect(document.querySelector('[data-outline]')).toBeNull()
    document.querySelector<HTMLElement>('[data-sidebar-tab="outline"]')?.click()
    await until(() => document.querySelector('[data-outline]') !== null)
    expect(sidebarPanel.value).toBe('outline')
    document.querySelector<HTMLElement>('[data-sidebar-tab="folders"]')?.click()
    await flush()
    expect(document.querySelector('[data-outline]')).toBeNull()
  })

  it('Show Outline shows the panel with the caret in its list, even from a hidden sidebar', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    expect(sidebarPanel.value).toBe('outline')
    expect(document.activeElement).toBe(list())
  })

  it('says what is missing when there is nothing to list', async () => {
    await start()
    await openOutline()
    expect(message()).toBe('Open a Markdown file to see its headings.')
    await openFile('/work/plain.txt')
    await flush()
    expect(message()).toBe('This file is not Markdown, so it has no outline.')
    expect(asked).toHaveLength(0)
    await openFile('/work/none.md')
    await flush()
    expect(message()).toBe('This file has no headings.')
  })
})

describe('listing the headings', () => {
  it('lists the headings of the file in the active tab, indented by level, as they read when drawn', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    expect(texts()).toEqual(['Alpha', 'Beta bold', 'Gamma link', 'Delta'])
    expect(rows().map((row) => row.dataset.level)).toEqual(['1', '2', '3', '1'])
    expect(rows().map((row) => row.dataset.line)).toEqual(['1', '5', '9', '11'])
    const padding = rows().map((row) => Number.parseInt(row.style.paddingLeft, 10))
    expect(padding[1]).toBeGreaterThan(padding[0] ?? 0)
    expect(padding[2]).toBeGreaterThan(padding[1] ?? 0)
    expect(padding[3]).toBe(padding[0])
  })

  it('asks for the file by path when nothing is unsaved, and sends no text', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    expect(asked).toHaveLength(1)
    expect(asked[0]?.path).toBe('/work/a.md')
    expect(asked[0]?.text).toBeUndefined()
  })

  it('shows the headings of the tab it is switched to at once', async () => {
    await start()
    const first = await openFile('/work/a.md')
    await openOutline()
    await openFile('/work/b.md')
    await flush()
    expect(texts()).toEqual(['Other', 'Second'])
    // Back to the first tab: no pause needed.
    document
      .querySelector<HTMLElement>(`[data-tab-id="${first}"]`)
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
  })

  it('puts the heading rows of a very long list in the DOM only for the part on screen', async () => {
    const long = Array.from({ length: 5000 }, (_, i) => `## Heading ${String(i + 1)}\n`).join('')
    await start({ '/work/long.md': long })
    await openFile('/work/long.md')
    await openOutline()
    expect(outlineState.value.headings).toHaveLength(5000)
    expect(rows().length).toBeGreaterThan(0)
    expect(rows().length).toBeLessThan(60)
    await press('End')
    expect(selectedHeading.value).toBe(4999)
    expect(texts()).toContain('Heading 5000')
  })

  it('says only the first headings are listed when Rust cut the list', async () => {
    await start()
    await openFile('/work/a.md')
    host.outlineScan = (request) =>
      Promise.resolve<OutlineAnswer>({
        id: request.id,
        truncated: true,
        headings: [{ level: 1, line: 1, text: 'x' }],
      })
    await openOutline()
    expect(document.querySelector('[data-outline-note]')?.textContent).toContain(
      'Only the first 50,000 headings are listed.',
    )
  })

  it('shows the reason when the scan fails, and recovers on the next one', async () => {
    await start()
    await openFile('/work/a.md')
    const real = host.outlineScan.bind(host)
    host.outlineScan = () => Promise.reject(new Error('That file is not open.'))
    await openOutline()
    expect(message()).toBe('The outline could not be read. That file is not open.')
    host.outlineScan = real
    await openFile('/work/b.md')
    await flush()
    expect(texts()).toEqual(['Other', 'Second'])
  })

  it('reaches the last heading of a file of several megabytes', async () => {
    const section = '## Section\n' + 'A paragraph of plain words.\n'.repeat(40) + '\n'
    const body = section.repeat(2400)
    await start({ '/work/big.md': body + '# The very last heading\n' })
    await openFile('/work/big.md')
    await openOutline()
    const all = outlineState.value.headings
    expect(all).toHaveLength(2401)
    expect(all.at(-1)?.text).toBe('The very last heading')
    await press('End')
    await press('Enter')
    expect(caretLine()).toBe(all.at(-1)?.line)
  })
})

describe('moving to a heading', () => {
  it('a click puts the caret on the heading line and leaves focus in the list', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    list().focus()
    rows()[1]?.click()
    await flush()
    expect(caretLine()).toBe(5)
    expect(selectedHeading.value).toBe(1)
    expect(document.activeElement).toBe(list())
    expect(editorHasFocus()).toBe(false)
  })

  it('Enter and a double click put the caret in the file', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    list().focus()
    rows()[2]?.click()
    await flush()
    expect(caretLine()).toBe(9)
    expect(editorHasFocus()).toBe(false)
    await press('Enter')
    await flush()
    expect(caretLine()).toBe(9)
    expect(editorHasFocus()).toBe(true)
    list().focus()
    rows()[3]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await flush()
    expect(caretLine()).toBe(11)
    expect(editorHasFocus()).toBe(true)
  })

  it('Space jumps to the selected heading and leaves focus in the list (ISC-605)', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    list().focus()
    await press('ArrowDown')
    await press('ArrowDown')
    expect(selectedHeading.value).toBe(1)
    const space = await press(' ')
    expect(space.defaultPrevented).toBe(true)
    expect(caretLine()).toBe(5)
    expect(document.activeElement).toBe(list())
    expect(editorHasFocus()).toBe(false)
    await press('ArrowDown')
    expect(selectedHeading.value).toBe(2)
    expect(caretLine()).toBe(5)
    await press(' ')
    expect(caretLine()).toBe(9)
    expect(document.activeElement).toBe(list())
  })

  it('Space with nothing selected does not jump, and does not scroll the list', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    list().focus()
    const before = caretLine()
    const space = await press(' ')
    expect(space.defaultPrevented).toBe(true)
    expect(caretLine()).toBe(before)
    expect(selectedHeading.value).toBe(-1)
  })

  it('a held Space or Enter jumps once, and Enter still moves focus to the editor (ISC-605)', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    list().focus()
    await press('ArrowDown')
    await press('ArrowDown')
    await press(' ', { repeat: true })
    expect(caretLine()).not.toBe(5)
    await press('Enter')
    expect(caretLine()).toBe(5)
    expect(editorHasFocus()).toBe(true)
  })

  it('Space with Ctrl, Alt, Meta or Shift passes through', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    list().focus()
    await press('ArrowDown')
    const before = caretLine()
    for (const init of [
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      expect((await press(' ', init)).defaultPrevented).toBe(false)
    }
    expect(caretLine()).toBe(before)
  })

  it('the arrow keys, Home, End and the page keys move the selection and leave the caret alone', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    list().focus()
    const before = caretLine()
    expect((await press('ArrowDown')).defaultPrevented).toBe(true)
    expect(selectedHeading.value).toBe(0)
    await press('ArrowDown')
    await press('ArrowDown')
    expect(selectedHeading.value).toBe(2)
    await press('ArrowUp')
    expect(selectedHeading.value).toBe(1)
    await press('End')
    expect(selectedHeading.value).toBe(3)
    await press('ArrowDown')
    expect(selectedHeading.value).toBe(3)
    await press('Home')
    expect(selectedHeading.value).toBe(0)
    await press('PageDown')
    expect(selectedHeading.value).toBe(3)
    await press('PageUp')
    expect(selectedHeading.value).toBe(0)
    expect(caretLine()).toBe(before)
  })

  it('keys with Ctrl, Alt or Meta pass to the app', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    list().focus()
    for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect((await press('ArrowDown', init)).defaultPrevented).toBe(false)
    }
    expect(selectedHeading.value).toBe(-1)
  })

  it('moves the caret in the tab shown, in the pane that is active', async () => {
    await start()
    await openFile('/work/a.md')
    await openFile('/work/b.md')
    await openOutline()
    list().focus()
    rows()[1]?.click()
    await flush()
    expect(caretLine()).toBe(3)
  })
})

describe('keeping up with unsaved edits', () => {
  it('sends the text of a document with edits, after typing pauses, and shows the new heading', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    expect(asked).toHaveLength(1)
    const follower = activeFollower()
    // "# Alpha" becomes "# Alpha renamed".
    follower.dispatch({ changes: { from: 7, insert: ' renamed' } })
    await flush()
    // Not yet: the typing has not paused.
    expect(asked).toHaveLength(1)
    expect(texts()[0]).toBe('Alpha')
    await pause()
    expect(asked).toHaveLength(2)
    expect(asked[1]?.text).toContain('# Alpha renamed')
    expect(asked[1]?.path).toBeUndefined()
    expect(texts()[0]).toBe('Alpha renamed')
  })

  it('shows a heading that was added or removed', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    activeFollower().dispatch({ changes: { from: 0, insert: '# First\n\n' } })
    await pause()
    expect(texts()).toEqual(['First', 'Alpha', 'Beta bold', 'Gamma link', 'Delta'])
    expect(rows()[0]?.dataset.line).toBe('1')
    expect(rows()[1]?.dataset.line).toBe('3')
  })

  it('scans a burst of edits once, when it ends', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    const follower = activeFollower()
    for (let i = 0; i < 6; i++) {
      follower.dispatch({ changes: { from: 0, insert: 'x' } })
      await sleep(40)
    }
    expect(asked).toHaveLength(1)
    await pause()
    expect(asked).toHaveLength(2)
  })

  it('does not scan for a caret move or a save that changes no text', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    activeFollower().dispatch({ changes: { from: 0, insert: 'x' } })
    await pause()
    expect(asked).toHaveLength(2)
    activeFollower().dispatch({ selection: { anchor: 3 } })
    await pause()
    const doc = activeDocument()
    if (doc === undefined) throw new Error('no document')
    await saveDocument(doc.id)
    await pause()
    expect(asked).toHaveLength(2)
  })

  it('scans an untitled document by its text', async () => {
    await start()
    await runCommand(COMMAND_IDS.newFile)
    await flush()
    await openOutline()
    activeFollower().dispatch({ changes: { from: 0, insert: '# New heading\n' } })
    await pause()
    expect(texts()).toEqual(['New heading'])
    expect(asked.at(-1)?.text).toBe('# New heading\n')
  })

  it('scans nothing while the panel is not on screen, and scans again when it comes back', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    showSidebar('folders')
    await flush()
    const before = asked.length
    activeFollower().dispatch({ changes: { from: 0, insert: '# Hidden\n\n' } })
    await pause()
    await openFile('/work/b.md')
    await pause()
    expect(asked).toHaveLength(before)
    await openOutline()
    expect(asked).toHaveLength(before + 1)
    expect(texts()).toEqual(['Other', 'Second'])
  })

  it('drops the answer of a scan that was replaced by a newer one', async () => {
    await start()
    await openFile('/work/a.md')
    const real = host.outlineScan.bind(host)
    let release: (() => void) | undefined
    let calls = 0
    host.outlineScan = (request) => {
      calls += 1
      if (calls === 1) {
        // The first answer arrives last, and says something stale.
        return new Promise<OutlineAnswer>((resolve) => {
          release = () =>
            resolve({
              id: request.id,
              truncated: false,
              headings: [{ level: 1, line: 1, text: 'STALE' }],
            })
        })
      }
      return real(request)
    }
    await openOutline()
    await openFile('/work/b.md')
    await flush()
    expect(texts()).toEqual(['Other', 'Second'])
    release?.()
    await flush()
    expect(texts()).toEqual(['Other', 'Second'])
  })

  it('scans an untitled document with no edits by its (empty) text, not by a path it does not have', async () => {
    await start()
    await runCommand(COMMAND_IDS.newFile)
    await flush()
    await openOutline()
    expect(asked).toHaveLength(1)
    expect(asked[0]?.text).toBe('')
    expect(asked[0]?.path).toBeUndefined()
    expect(message()).toBe('This file has no headings.')
  })

  it('drops the selection when a shorter list no longer has that heading', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    list().focus()
    await press('End')
    expect(selectedHeading.value).toBe(3)
    const length = activeFollower().state.doc.length
    // The last heading, "# Delta", goes.
    activeFollower().dispatch({ changes: { from: length - '# Delta'.length - 1, to: length } })
    await pause()
    expect(texts()).toEqual(['Alpha', 'Beta bold', 'Gamma link'])
    expect(selectedHeading.value).toBe(-1)
  })

  it('shows nothing of an answer that arrives after the panel was closed', async () => {
    await start()
    await openFile('/work/a.md')
    let release: (() => void) | undefined
    host.outlineScan = (request) =>
      new Promise<OutlineAnswer>((resolve) => {
        release = () =>
          resolve({
            id: request.id,
            truncated: false,
            headings: [{ level: 1, line: 1, text: 'LATE' }],
          })
      })
    await openOutline()
    showSidebar('folders')
    await flush()
    release?.()
    await flush()
    expect(outlineState.value.headings).toEqual([])
  })

  it('closing the last tab empties the list', async () => {
    await start()
    await openFile('/work/a.md')
    await openOutline()
    expect(texts()).toHaveLength(4)
    resetDocuments()
    resetWorkbench()
    await flush()
    expect(message()).toBe('Open a Markdown file to see its headings.')
  })
})

// ---- the layout (P9.1-T14) ----

const LAYOUT_FILES: Record<string, string> = {
  ...FILES,
  '/work/h123.md': '# One\n\n## Two\n\n### Three\n',
  '/work/h2.md': '## Only\n\n## Also\n',
  '/work/h23.md': '## Top\n\n### Under\n',
  '/work/h24.md': '## Top\n\n#### Deep\n',
  '/work/h16.md': '# a\n## b\n### c\n#### d\n##### e\n###### f\n',
  '/work/pre.md': 'lead words\n\n# First\n\nbody\n\n## Second\n\nmore\n',
}

const row = (at: number): HTMLElement => {
  const found = rows()[at]
  if (found === undefined) throw new Error(`no row ${String(at)}`)
  return found
}
const indents = (): number[] => rows().map((el) => Number.parseFloat(el.style.paddingLeft))
const sizes = (): string[] => rows().map((el) => el.style.fontSize)
const weights = (): number[] => rows().map((el) => Number(el.style.fontWeight || 400))

async function showLayout(path: string): Promise<void> {
  await start(LAYOUT_FILES)
  await openFile(path)
  await openOutline()
}

describe('indent by rank (ISC-606)', () => {
  it('gives H1 to H3 one step each, bigger than the old 12 px', async () => {
    await showLayout('/work/h123.md')
    const [a = 0, b = 0, c = 0] = indents()
    expect(b - a).toBeGreaterThan(12)
    expect(c - b).toBe(b - a)
  })

  it('gives a lone level no extra indent, whichever level it is', async () => {
    await showLayout('/work/h2.md')
    expect(new Set(indents()).size).toBe(1)
    const base = indents()[0] ?? 0
    await openFile('/work/h123.md')
    await flush()
    expect(indents()[0]).toBe(base)
  })

  it('counts the levels the document uses: H2 with H4 is two steps, like H2 with H3', async () => {
    await showLayout('/work/h23.md')
    const withH3 = indents()
    await openFile('/work/h24.md')
    await flush()
    expect(indents()).toEqual(withH3)
  })

  it('steps evenly through all six levels', async () => {
    await showLayout('/work/h16.md')
    const all = indents()
    expect(all).toHaveLength(6)
    const first = all[0] ?? 0
    const step = (all[1] ?? 0) - first
    all.forEach((value, at) => {
      expect(value).toBe(first + at * step)
    })
  })
})

describe('sizes (ISC-607)', () => {
  it('gives H1, H2 and H3 three different sizes and H4 to H6 the H3 size', async () => {
    await showLayout('/work/h16.md')
    const all = sizes()
    expect(new Set(all.slice(0, 3)).size).toBe(3)
    expect(all.slice(3)).toEqual([all[2], all[2], all[2]])
  })
})

describe('bold (ISC-639, ISC-640)', () => {
  /** Which rows are bold, top to bottom, for a document's headings. */
  async function boldRows(source: string): Promise<boolean[]> {
    await start({ ...LAYOUT_FILES, '/work/bold.md': source })
    await openFile('/work/bold.md')
    await openOutline()
    return weights().map((weight) => weight >= 600)
  }

  describe('the lowest level used is always bold (ISC-639)', () => {
    it('bolds the top level when it is the only one, H2 here', async () => {
      expect(await boldRows('## Only\n\n## Also\n')).toEqual([true, true])
    })

    it('bolds a lone heading', async () => {
      expect(await boldRows('# Alone\n')).toEqual([true])
    })

    it('bolds H1 and H2 documents from H1 down', async () => {
      expect((await boldRows('# a\n## b\n# c\n'))[0]).toBe(true)
    })

    it('bolds H3 when it is the only level', async () => {
      expect(await boldRows('### a\n### b\n')).toEqual([true, true])
    })

    it('bolds H4 when it is the only level', async () => {
      expect(await boldRows('#### a\n#### b\n')).toEqual([true, true])
    })

    it('does not bold the level under it when the lowest level occurs more than once', async () => {
      expect(await boldRows('## a\n## b\n### c\n')).toEqual([true, true, false])
    })
  })

  describe('a lowest level that occurs once also bolds the next level (ISC-640)', () => {
    it('one H1 with many H2 and H3 bolds H1 and H2 and not H3', async () => {
      expect(await boldRows('# T\n## a\n## b\n### c\n### d\n')).toEqual([
        true,
        true,
        true,
        false,
        false,
      ])
    })

    it('one H2 and no H1, with H3 and H4, bolds H2 and H3 and not H4', async () => {
      expect(await boldRows('## T\n### a\n#### b\n')).toEqual([true, true, false])
    })

    it('one H2 and many H3 bolds all of them', async () => {
      expect(await boldRows('## T\n### a\n### b\n### c\n')).toEqual([true, true, true, true])
    })

    it('two H1 with H2 bolds H1 only', async () => {
      expect(await boldRows('# a\n## x\n# b\n')).toEqual([true, false, true])
    })

    it('one H1 with one H2 and an H3 bolds H1 and H2 and does not chain on to H3', async () => {
      expect(await boldRows('# a\n## b\n### c\n')).toEqual([true, true, false])
    })

    it('counts a level that is not next to the lowest: one H2 with H4 bolds H4 too', async () => {
      expect(await boldRows('## a\n#### b\n#### c\n')).toEqual([true, true, true])
    })
  })

  describe('boldLevels, the rule on its own', () => {
    const heading = (level: number): { level: number; text: string; line: number } => ({
      level,
      text: 'x',
      line: 1,
    })
    const bold = async (...levels: number[]): Promise<number[]> => {
      const { boldLevels } = await import('@/features/outline/layout')
      return [...boldLevels(levels.map(heading))].sort((a, b) => a - b)
    }

    it('has no bold level for no headings', async () => {
      expect(await bold()).toEqual([])
    })

    it('bolds the one level of a document that has one', async () => {
      expect(await bold(3)).toEqual([3])
      expect(await bold(1, 1, 1)).toEqual([1])
    })

    it('takes one step and no more', async () => {
      expect(await bold(1, 2, 3)).toEqual([1, 2])
      expect(await bold(1, 2, 2, 3)).toEqual([1, 2])
      expect(await bold(2, 3, 3, 4)).toEqual([2, 3])
      expect(await bold(1, 1, 2, 3)).toEqual([1])
    })

    it('does not depend on the order of the headings', async () => {
      expect(await bold(3, 2, 2, 1)).toEqual([1, 2])
      expect(await bold(2, 1, 2)).toEqual([1, 2])
    })
  })
})

describe('row height and muting (ISC-608)', () => {
  it('has its own height from a token, taller than the tree, and the list uses it', async () => {
    const { OUTLINE_ROW_HEIGHT } = await import('@/features/outline/layout')
    const { ROW_HEIGHT } = await import('@/features/tree/model')
    expect(OUTLINE_ROW_HEIGHT).toBeGreaterThan(ROW_HEIGHT)
    expect(OUTLINE_ROW_HEIGHT).toBeGreaterThanOrEqual(28)
    expect(OUTLINE_ROW_HEIGHT).toBeLessThanOrEqual(32)
    const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')
    const rem = /--spacing-outline-row:\s*([\d.]+)rem/.exec(tokens)?.[1]
    expect(Number(rem) * 16).toBe(OUTLINE_ROW_HEIGHT)
    await showLayout('/work/h123.md')
    for (const el of rows()) expect(el.style.height).toBe(`${String(OUTLINE_ROW_HEIGHT)}px`)
    expect(rows().map((el) => el.style.top)).toEqual(
      rows().map((_, at) => `${String(at * OUTLINE_ROW_HEIGHT)}px`),
    )
    const spacer = list().firstElementChild as HTMLElement
    expect(spacer.style.height).toBe(`${String(rows().length * OUTLINE_ROW_HEIGHT)}px`)
  })

  it('mutes deeper ranks step by step, from the sidebar text color to the muted one', async () => {
    await showLayout('/work/h16.md')
    const inks = rows().map((el) =>
      [...el.classList].find((name) => /^(text-|outline-ink-)/.test(name)),
    )
    expect(inks.slice(0, 4)).toEqual([
      'text-sidebar-foreground',
      'outline-ink-1',
      'outline-ink-2',
      'text-muted-foreground',
    ])
    // Past the fourth rank the text stays at the most muted step.
    expect(inks.slice(3)).toEqual(Array<string>(3).fill('text-muted-foreground'))
    const css = readFileSync(join(process.cwd(), 'src/styles/outline.css'), 'utf8')
    expect(css).toContain(
      'color-mix(in oklab, var(--sidebar-foreground) 67%, var(--muted-foreground))',
    )
    expect(css).toContain(
      'color-mix(in oklab, var(--sidebar-foreground) 33%, var(--muted-foreground))',
    )
  })

  it('leaves the selected row to the selection color', async () => {
    await showLayout('/work/h16.md')
    list().focus()
    await press('ArrowDown')
    await press('ArrowDown')
    expect(row(1).className).toContain('text-sidebar-accent-foreground')
    expect(row(1).className).not.toContain('text-muted')
    expect(row(1).className).not.toContain('outline-ink')
  })

  it('holds the contrast of the muted text on the sidebar and its selected row in every theme', () => {
    for (const name of ['dark', 'light', 'sepia']) {
      const css = readFileSync(join(process.cwd(), `src/styles/themes/${name}.css`), 'utf8')
      const value = (token: string): string => {
        let found = new RegExp(`--${token}:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? ''
        for (let hops = 0; hops < 4; hops++) {
          const next = /^var\(--([\w-]+)\)$/.exec(found)?.[1]
          if (next === undefined) break
          found = new RegExp(`--${next}:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? ''
        }
        return found
      }
      for (const [text, surface] of [
        ['muted-foreground', 'sidebar'],
        ['muted-foreground', 'sidebar-accent'],
        ['sidebar-foreground', 'sidebar'],
      ] as const) {
        const ratio = contrast(parseColor(value(text)), parseColor(value(surface)))
        expect(ratio, `${name}: ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('the current section (ISC-609)', () => {
  const marked = (): string | undefined =>
    document.querySelector('[data-outline-heading][aria-current=true]')?.textContent.trim()

  async function caretAt(line: number): Promise<void> {
    const follower = activeFollower()
    follower.dispatch({ selection: { anchor: follower.state.doc.line(line).from } })
    await flush()
  }

  it('marks the section that holds the caret, and moves with it', async () => {
    await showLayout('/work/pre.md')
    await caretAt(5)
    expect(marked()).toBe('First')
    await caretAt(9)
    expect(marked()).toBe('Second')
    await caretAt(3)
    expect(marked()).toBe('First')
  })

  it('marks the heading line itself, and nothing above the first heading', async () => {
    await showLayout('/work/pre.md')
    await caretAt(3)
    expect(marked()).toBe('First')
    await caretAt(1)
    expect(marked()).toBeUndefined()
  })

  it('follows the caret when the outline puts it on a heading', async () => {
    await showLayout('/work/pre.md')
    list().focus()
    await press('ArrowDown')
    await press('ArrowDown')
    await press(' ')
    expect(marked()).toBe('Second')
  })

  it('follows a heading edit: a new heading above the caret takes the mark', async () => {
    await showLayout('/work/pre.md')
    await caretAt(9)
    expect(marked()).toBe('Second')
    const follower = activeFollower()
    follower.dispatch({
      changes: { from: follower.state.doc.line(9).from, insert: '# Inserted\n' },
    })
    await pause()
    expect(marked()).toBe('Inserted')
  })

  it('marks nothing in a file with no headings', async () => {
    await showLayout('/work/pre.md')
    await caretAt(5)
    expect(marked()).toBe('First')
    await openFile('/work/none.md')
    await pause()
    expect(marked()).toBeUndefined()
  })
})
