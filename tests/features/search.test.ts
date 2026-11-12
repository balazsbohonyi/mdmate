// @vitest-environment jsdom
/**
 * Search in folders (P7-T2): the sidebar's Search tab, its query box and toggles, the list of
 * results and what a click, Enter or a double click do with one. The panel is drawn inside the
 * real sidebar frame next to the real panes, on the browser mock's folder search. The engine
 * itself (what is read, columns, caps) is proven in Rust; this checks the page around it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { followerOfTab, openPath, problem, resetDocuments } from '@/documents/store'
import { resetSearch, searchOptions, searchState, setSearchOptions } from '@/features/search/store'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import {
  setHost,
  type SearchBatch,
  type SearchHit,
  type SearchRequest,
  type SearchSummary,
} from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import SidebarFrame from '@/shell/SidebarFrame.vue'
import { clearCommands, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { editorFocusRequest } from '@/workbench/focus'
import { resetFind } from '@/workbench/find'
import { resetSidebar, sidebarPanel } from '@/workbench/sidebar'
import { findPane, panesOf } from '@/workbench/splitTree'
import { focusPane, resetWorkbench, workbenchLayout } from '@/workbench/store'
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

const FILES: Record<string, string> = {
  '/work/a.md': 'one needle\ntwo\nthree Needle here\n',
  '/work/notes/b.md': 'no match\n  indented needle\n',
  '/work/notes/c.txt': 'concatenate cat\n',
  '/work/node_modules/pkg/x.md': 'needle in a dependency\n',
}

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined
let removeCommands: (() => void) | undefined

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

async function start(files: Record<string, string> = FILES, roots = ['/work']): Promise<void> {
  host = createMockHost({ files, roots })
  setHost(host)
  await restoreWorkspace([])
  mount()
  await flush()
}

const box = (): HTMLInputElement => {
  const element = document.querySelector<HTMLInputElement>('[data-search-input]')
  if (element === null) throw new Error('no query box')
  return element
}
const results = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[data-search-results]')
  if (element === null) throw new Error('no results list')
  return element
}
const summary = (): string =>
  document.querySelector('[data-search-summary]')?.textContent?.trim() ?? ''
const hits = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-search-hit]')]
/** The text of a result row before its marked match, the line number included. */
function textBeforeMark(row: HTMLElement | undefined): string {
  const mark = row?.querySelector('[data-search-match]')
  if (row === undefined || mark === null || mark === undefined) return ''
  let before = ''
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (mark.contains(node)) break
    before += node.textContent ?? ''
  }
  return before
}
const hitLines = (): string[] => hits().map((row) => row.dataset.line ?? '')
const fileNames = (): string[] =>
  [...document.querySelectorAll('[data-search-file]')].map(
    (row) => row.querySelector('span')?.textContent ?? '',
  )
const fileCounts = (): string[] =>
  [...document.querySelectorAll('[data-search-file]')].map(
    (row) => row.lastElementChild?.textContent ?? '',
  )

/** Waits for something the lazy panel draws; its module loads the first time it is shown. */
async function until(ready: () => boolean): Promise<void> {
  for (let tries = 0; tries < 400 && !ready(); tries++) await settle()
  await flush()
}

async function openSearch(): Promise<void> {
  await runCommand(COMMAND_IDS.findInFolders)
  await until(() => document.querySelector('[data-search-input]') !== null)
}

async function type(text: string): Promise<void> {
  box().value = text
  box().dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}

async function enter(): Promise<void> {
  box().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
  await flush()
}

async function search(text: string): Promise<void> {
  await openSearch()
  await type(text)
  await enter()
}

async function pressInList(key: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  results().dispatchEvent(event)
  await flush()
  return event
}

const allPanes = () => panesOf(workbenchLayout.value)
const editorHasFocus = (): boolean => document.activeElement?.closest('.cm-editor') != null
const shownTabs = (): number =>
  findPane(workbenchLayout.value, workbenchLayout.value.activePane)?.tabs.length ?? 0

beforeEach(() => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  resetSidebar()
  resetSearch()
  resetFind()
  clearCommands()
  removeCommands = registerDefaultCommands()
  problem.value = null
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
  resetSearch()
})

describe('the Search tab', () => {
  it('is always in the sidebar header next to Folders, and shows its panel when pressed', async () => {
    await start()
    const tabs = [...document.querySelectorAll('[data-sidebar-tab]')].map(
      (tab) => (tab as HTMLElement).dataset.sidebarTab,
    )
    expect(tabs).toEqual(['folders', 'search', 'outline'])
    expect(document.querySelector('[data-search]')).toBeNull()
    document.querySelector<HTMLElement>('[data-sidebar-tab="search"]')?.click()
    await until(() => document.querySelector('[data-search]') !== null)
    expect(sidebarPanel.value).toBe('search')
    expect(document.querySelector('[data-search]')).not.toBeNull()
    document.querySelector<HTMLElement>('[data-sidebar-tab="folders"]')?.click()
    await flush()
    expect(sidebarPanel.value).toBe('folders')
    expect(document.querySelector('[data-search]')).toBeNull()
  })

  it('Search in Folders shows the panel with the caret in the query box, even from a hidden sidebar', async () => {
    await start()
    await openSearch()
    expect(sidebarPanel.value).toBe('search')
    expect(document.activeElement).toBe(box())
  })

  it('takes the selected line of the active editor as the query', async () => {
    await start()
    const tab = await openPath('/work/a.md')
    await flush()
    followerOfTab(tab)?.dispatch({ selection: { anchor: 4, head: 10 } })
    await openSearch()
    expect(box().value).toBe('needle')
    expect(searchState.value.phase).toBe('idle')
  })

  it('escapes a selection with symbols when the pattern option is on, so it matches as written', async () => {
    await start({ '/work/sym.md': 'x a.b y\n' })
    const tab = await openPath('/work/sym.md')
    await flush()
    followerOfTab(tab)?.dispatch({ selection: { anchor: 2, head: 5 } })
    setSearchOptions({ regexp: true })
    await openSearch()
    expect(box().value).toBe(String.raw`a\.b`)
  })
})

describe('running a search', () => {
  it('runs on Enter, not while typing, and lists files and their hits with line numbers', async () => {
    await start()
    let asked = 0
    const real = host.searchFolders.bind(host)
    host.searchFolders = (request, buffers, onBatch) => {
      asked += 1
      return real(request, buffers, onBatch)
    }
    await openSearch()
    await type('needle')
    expect(asked).toBe(0)
    expect(hits()).toHaveLength(0)
    await enter()
    expect(asked).toBe(1)
    expect(fileNames()).toEqual(['a.md', 'b.md'])
    expect(fileCounts()).toEqual(['2', '1'])
    expect(hitLines()).toEqual(['1', '3', '2'])
    expect(summary()).toBe('3 results in 2 files')
  })

  it('never reads node_modules', async () => {
    await start()
    await search('dependency')
    expect(hits()).toHaveLength(0)
    expect(summary()).toBe('No results in 3 files')
  })

  it('marks the match inside the line and trims the line start', async () => {
    await start()
    await search('needle')
    const marked = [...document.querySelectorAll('[data-search-match]')].map((m) => m.textContent)
    expect(marked).toEqual(['needle', 'Needle', 'needle'])
    const third = hits()[2]
    // The line number, then the line with its leading white space cut.
    expect(third?.textContent).toBe('2indented needle')
  })

  it('searching again with an emptied box clears the list', async () => {
    await start()
    await search('needle')
    expect(hits().length).toBeGreaterThan(0)
    await type('')
    await enter()
    expect(hits()).toHaveLength(0)
    expect(summary()).toBe('Press Enter to search')
  })

  it('says so when no folder is open, without asking the host', async () => {
    await start({}, [])
    let asked = 0
    const real = host.searchFolders.bind(host)
    host.searchFolders = (request, buffers, onBatch) => {
      asked += 1
      return real(request, buffers, onBatch)
    }
    await search('needle')
    expect(asked).toBe(0)
    expect(summary()).toBe('Open a folder to search its files.')
  })

  it('explains a pattern the engine cannot run', async () => {
    await start()
    setSearchOptions({ regexp: true })
    await search('(')
    expect(summary()).toBe('This is not a valid regular expression.')
    expect(hits()).toHaveLength(0)
  })
})

describe('the options', () => {
  it('match case, whole word and pattern change what is found, and run the search again once one was made', async () => {
    await start()
    await search('needle')
    expect(hits()).toHaveLength(3)
    document.querySelector<HTMLElement>('[data-search-case]')?.click()
    await flush()
    expect(hits()).toHaveLength(2)
    expect(document.querySelector('[data-search-case]')?.getAttribute('aria-pressed')).toBe('true')
    document.querySelector<HTMLElement>('[data-search-case]')?.click()
    await flush()
    await type('cat')
    await enter()
    // Each match is a result: "cat" is twice in "concatenate cat".
    expect(hits()).toHaveLength(2)
    document.querySelector<HTMLElement>('[data-search-word]')?.click()
    await flush()
    // Whole word drops the "cat" inside "concatenate" and keeps the last word of the line.
    expect(hits()).toHaveLength(1)
    expect(document.querySelectorAll('[data-search-match]')).toHaveLength(1)
    // The one match is the last word, not the "cat" inside "concatenate".
    expect(textBeforeMark(hits()[0])).toBe('1concatenate ')
    // Whole word off again, or "ndented need" (inside a word at both ends) would not count.
    document.querySelector<HTMLElement>('[data-search-word]')?.click()
    await flush()
    document.querySelector<HTMLElement>('[data-search-regexp]')?.click()
    await flush()
    // As plain text "^no " would find nothing; as a pattern it is the start of b.md's first line.
    await type('^no ')
    await enter()
    expect(hits().map((row) => row.dataset.line)).toEqual(['1'])
    expect(textBeforeMark(hits()[0])).toBe('1')
    document.querySelector<HTMLElement>('[data-search-regexp]')?.click()
    await flush()
    expect(hits()).toHaveLength(0)
  })

  it('a toggle pressed before any search only sets the option', async () => {
    await start()
    let asked = 0
    const real = host.searchFolders.bind(host)
    host.searchFolders = (request, buffers, onBatch) => {
      asked += 1
      return real(request, buffers, onBatch)
    }
    await openSearch()
    // A query is typed but Enter was never pressed, so there is nothing to run again.
    await type('needle')
    document.querySelector<HTMLElement>('[data-search-word]')?.click()
    await flush()
    expect(asked).toBe(0)
    expect(searchOptions.value.wholeWord).toBe(true)
  })
})

describe('opening a result (Q2, Q4)', () => {
  it('a click shows the file at the match and leaves focus in the list', async () => {
    await start()
    await search('needle')
    results().focus()
    hits()[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await flush()
    expect(shownTabs()).toBe(1)
    expect(document.querySelector('.cm-editor')).not.toBeNull()
    expect(editorHasFocus()).toBe(false)
    expect(document.activeElement).toBe(results())
    const tab = findPane(workbenchLayout.value, workbenchLayout.value.activePane)?.activeTab
    const state = followerOfTab(tab ?? '')?.state
    // Line 3 is "three Needle here"; the match starts at column 6.
    expect(state?.doc.lineAt(state.selection.main.head).number).toBe(3)
    expect(state?.selection.main.head).toBe((state?.doc.line(3).from ?? 0) + 6)
  })

  it('Enter and a double click put the caret in the file', async () => {
    await start()
    await search('needle')
    results().focus()
    await pressInList('ArrowDown')
    const before = editorFocusRequest.value
    await pressInList('Enter')
    expect(shownTabs()).toBe(1)
    expect(editorFocusRequest.value).toBeGreaterThan(before)
    expect(editorHasFocus()).toBe(true)

    results().focus()
    const row = hits()[2]
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))
    await flush()
    expect(shownTabs()).toBe(2)
    expect(editorHasFocus()).toBe(true)
  })

  it('opens the hit in the active pane even when another pane shows the file', async () => {
    await start()
    await openPath('/work/a.md')
    await flush()
    await runCommand(COMMAND_IDS.splitRight)
    await flush()
    const panes = allPanes()
    expect(panes).toHaveLength(2)
    const [first, second] = panes
    if (first === undefined || second === undefined) throw new Error('no panes')
    focusPane(first.id)
    await search('needle')
    // The hit is in a.md, which the second pane shows; the active pane is the first.
    hits()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await flush()
    const after = allPanes()
    expect(after[0]?.tabs).toHaveLength(1)
    expect(after[1]?.tabs).toHaveLength(1)
    expect(workbenchLayout.value.activePane).toBe(first.id)
    // Now a file neither pane shows: b.md goes to the active pane only.
    hits()[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await flush()
    expect(allPanes()[0]?.tabs).toHaveLength(2)
    expect(allPanes()[1]?.tabs).toHaveLength(1)
  })

  it('arrow keys move the selection and open nothing; Up from the first hit goes back to the box', async () => {
    await start()
    await search('needle')
    results().focus()
    await pressInList('ArrowDown')
    expect(results().getAttribute('aria-activedescendant')).toBe('search-hit-0')
    await pressInList('ArrowDown')
    await pressInList('ArrowDown')
    expect(results().getAttribute('aria-activedescendant')).toBe('search-hit-2')
    await pressInList('ArrowDown')
    expect(results().getAttribute('aria-activedescendant')).toBe('search-hit-2')
    await pressInList('Home')
    expect(results().getAttribute('aria-activedescendant')).toBe('search-hit-0')
    await pressInList('End')
    expect(results().getAttribute('aria-activedescendant')).toBe('search-hit-2')
    expect(shownTabs()).toBe(0)
    await pressInList('Home')
    await pressInList('ArrowUp')
    expect(document.activeElement).toBe(box())
  })

  it('a key with Ctrl passes through to the app', async () => {
    await start()
    await search('needle')
    results().focus()
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    results().dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('ArrowDown in the box moves into the list on the first hit', async () => {
    await start()
    await search('needle')
    box().focus()
    box().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    )
    await flush()
    expect(document.activeElement).toBe(results())
    expect(results().getAttribute('aria-activedescendant')).toBe('search-hit-0')
  })

  it('Escape in the box sends the caret back to the editor', async () => {
    await start()
    await openPath('/work/a.md')
    await flush()
    await openSearch()
    const before = editorFocusRequest.value
    box().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await flush()
    expect(editorFocusRequest.value).toBeGreaterThan(before)
  })
})

describe('unsaved text', () => {
  it('sends the text of a document with unsaved edits, so the lines are the ones on screen', async () => {
    await start()
    const tab = await openPath('/work/a.md')
    await flush()
    followerOfTab(tab)?.dispatch({ changes: { from: 0, insert: 'top\n\n' } })
    let sent: readonly { id: number; text: string }[] = []
    const real = host.searchFolders.bind(host)
    host.searchFolders = (request, buffers, onBatch) => {
      sent = buffers
      return real(request, buffers, onBatch)
    }
    await search('needle')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text.startsWith('top\n\none needle')).toBe(true)
    // The two new lines push both hits of a.md down by two.
    expect(hitLines().slice(0, 2)).toEqual(['3', '5'])
  })

  it('a document that is not dirty is left to the files', async () => {
    await start()
    await openPath('/work/a.md')
    await flush()
    let sent = -1
    const real = host.searchFolders.bind(host)
    host.searchFolders = (request, buffers, onBatch) => {
      sent = buffers.length
      return real(request, buffers, onBatch)
    }
    await search('needle')
    expect(sent).toBe(0)
  })
})

describe('a big result', () => {
  const MANY = 6000

  it('draws only the rows on screen', async () => {
    const big = Array.from({ length: MANY }, (_, line) => `needle ${String(line)}`).join('\n')
    await start({ '/work/big.md': big })
    await search('needle')
    expect(summary()).toBe('6,000 results in 1 file')
    expect(hits().length).toBeGreaterThan(0)
    expect(hits().length).toBeLessThan(60)
    expect(results().firstElementChild?.getAttribute('style')).toContain(
      `height: ${String((MANY + 1) * 24)}px`,
    )
  })

  it('scrolling draws the rows that come into view', async () => {
    const big = Array.from({ length: MANY }, (_, line) => `needle ${String(line)}`).join('\n')
    await start({ '/work/big.md': big })
    await search('needle')
    results().scrollTop = 24 * 3000
    results().dispatchEvent(new Event('scroll'))
    await flush()
    const lines = hitLines().map(Number)
    expect(Math.min(...lines)).toBeGreaterThan(2900)
    expect(Math.max(...lines)).toBeLessThan(3100)
  })

  it('moving the selection with the keys scrolls the row into view', async () => {
    const big = Array.from({ length: MANY }, (_, line) => `needle ${String(line)}`).join('\n')
    await start({ '/work/big.md': big })
    await search('needle')
    results().focus()
    await pressInList('End')
    expect(results().getAttribute('aria-activedescendant')).toBe(`search-hit-${String(MANY - 1)}`)
    expect(document.getElementById(`search-hit-${String(MANY - 1)}`)).not.toBeNull()
  })

  it('says when there were more results than are listed', async () => {
    const huge = Array.from({ length: 10_050 }, () => 'needle').join('\n')
    await start({ '/work/huge.md': huge })
    await search('needle')
    expect(summary()).toBe('10,000 results in 1 file')
    expect(document.querySelector('[data-search-note]')?.textContent).toContain(
      'Only the first 10,000 results are listed.',
    )
  })
})

describe('a search that is replaced or stopped', () => {
  it('a new search stops the one running, and only the new one is listed', async () => {
    await start()
    const ended = new Map<string, boolean>()
    const real = host.searchFolders.bind(host)
    host.searchFolders = async (
      request: SearchRequest,
      buffers,
      onBatch: (b: SearchBatch) => void,
    ) => {
      const summary = await real(request, buffers, onBatch)
      ended.set(request.query, summary.stopped)
      return summary
    }
    await openSearch()
    await type('needle')
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    // The first search is still reading files when the second begins.
    await settle()
    expect(searchState.value.phase).toBe('searching')
    // No wait between typing and Enter: a wait would let the first search finish.
    box().value = 'cat'
    box().dispatchEvent(new Event('input', { bubbles: true }))
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await until(() => ended.size === 2)
    expect(ended.get('needle')).toBe(true)
    expect(ended.get('cat')).toBe(false)
    expect(searchState.value.phase).toBe('done')
    const texts = hits().map((row) => row.textContent ?? '')
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('concatenate cat')
  })

  it('Escape while searching stops it and keeps what was found', async () => {
    await start()
    await openSearch()
    await type('needle')
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(searchState.value.phase).toBe('searching')
    box().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await flush()
    expect(searchState.value.phase).toBe('done')
    expect(searchState.value.summary?.stopped).toBe(true)
    expect(summary()).toMatch(/^Search stopped\. \d+ results? so far$/)
  })

  it('the Stop button shows while searching, stops it, and puts the caret back in the box', async () => {
    await start()
    await openSearch()
    expect(document.querySelector('[data-search-stop]')).toBeNull()
    await type('needle')
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(searchState.value.phase).toBe('searching')
    const stop = document.querySelector<HTMLButtonElement>('[data-search-stop]')
    expect(stop?.getAttribute('aria-label')).toBe('Stop search')
    stop?.click()
    await flush()
    expect(searchState.value.phase).toBe('done')
    expect(searchState.value.summary?.stopped).toBe(true)
    expect(summary()).toMatch(/^Search stopped\. \d+ results? so far$/)
    expect(document.querySelector('[data-search-stop]')).toBeNull()
    expect(document.activeElement).toBe(box())
  })
})

describe('what the host sends back', () => {
  const summaryOf = (over: Partial<SearchSummary>): SearchSummary => ({
    id: 0,
    scanned: 0,
    files: 0,
    hits: 0,
    skipped: 0,
    truncated: false,
    stopped: false,
    error: null,
    ...over,
  })
  const hit = (path: string, line: number): SearchHit => ({
    path,
    line,
    column: 0,
    text: 'needle',
    start: 0,
    length: 6,
  })

  it('a batch that belongs to a search that was replaced is dropped, and so is its answer', async () => {
    await start()
    const release: (() => void)[] = []
    host.searchFolders = async (request, _buffers, onBatch) => {
      if (request.query === 'old') {
        await new Promise<void>((resolve) => release.push(resolve))
        // A stopped search still sends what it had read when it noticed.
        onBatch({ id: request.id, scanned: 9, hits: [hit('/work/old.md', 7)] })
        return summaryOf({ id: request.id, scanned: 9, files: 1, hits: 1, stopped: true })
      }
      onBatch({ id: request.id, scanned: 1, hits: [hit('/work/new.md', 1)] })
      return summaryOf({ id: request.id, scanned: 1, files: 1, hits: 1 })
    }
    await openSearch()
    await type('old')
    await enter()
    expect(searchState.value.phase).toBe('searching')
    await type('new')
    await enter()
    expect(fileNames()).toEqual(['new.md'])
    release[0]?.()
    await flush()
    expect(fileNames()).toEqual(['new.md'])
    expect(hitLines()).toEqual(['1'])
    expect(searchState.value.summary?.stopped).toBe(false)
    expect(searchState.value.scanned).toBe(1)
    expect(summary()).toBe('1 result in 1 file')
  })

  it('says how many files could not be read', async () => {
    await start()
    host.searchFolders = (request, _buffers, onBatch) => {
      onBatch({ id: request.id, scanned: 3, hits: [hit('/work/a.md', 1)] })
      return Promise.resolve(
        summaryOf({ id: request.id, scanned: 3, files: 1, hits: 1, skipped: 2 }),
      )
    }
    await search('needle')
    const notes = [...document.querySelectorAll('[data-search-note]')].map((n) => n.textContent)
    expect(notes).toEqual(['2 files could not be read.'])
    host.searchFolders = (request, _buffers, onBatch) => {
      onBatch({ id: request.id, scanned: 1, hits: [hit('/work/a.md', 1)] })
      return Promise.resolve(
        summaryOf({ id: request.id, scanned: 1, files: 1, hits: 1, skipped: 1 }),
      )
    }
    await enter()
    expect([...document.querySelectorAll('[data-search-note]')].map((n) => n.textContent)).toEqual([
      '1 file could not be read.',
    ])
  })

  it('shows a failed host call as a plain message and no results', async () => {
    await start()
    host.searchFolders = () => Promise.reject(new Error('the engine fell over'))
    await search('needle')
    expect(searchState.value.phase).toBe('failed')
    expect(summary()).toContain('the engine fell over')
    expect(hits()).toHaveLength(0)
  })
})
