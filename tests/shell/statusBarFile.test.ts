// @vitest-environment jsdom
// ISC-769 to ISC-773: what the status bar says about the file in the focused tab.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { documentOfTab, followerOfTab, openPath, resetDocuments } from '@/documents/store'
import { previewEffect } from '@/editor/previewMode'
import { textStats } from '@/editor/textStats'
import { paletteMode, closePalette } from '@/features/palette/state'
import { indexStatus } from '@/features/index/status'
import { STATUS_COUNT_DELAY_MS } from '@/features/status/fileStatus'
import { IDLE_INDEX } from '@/platform/indexStatus'
import type { Host, OpenedFile } from '@/platform'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import StatusBar from '@/shell/StatusBar.vue'
import { clearCommands } from '@/workbench/commands'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { findCounts } from '@/workbench/find'
import { findPane } from '@/workbench/splitTree'
import {
  closeTabById,
  openSettingsTab,
  openThemePreviewTab,
  resetWorkbench,
  selectTab,
  splitActivePane,
  workbenchLayout,
} from '@/workbench/store'
import { Text } from '@codemirror/state'

const FILES: Record<string, string> = {
  '/work/a.md': '# Title\n\n- **one** two\n[a](b.md) -- 42\n',
  '/work/b.md': 'a \u{1F600} b\r\nsecond\r\n',
  '/work/mixed.md': 'lf\ncrlf\r\nlf\nend',
  '/work/old.txt': 'one\rtwo\r',
  '/work/main.rs': 'fn main() {}\n',
  '/work/data.json': '{}\n',
  '/work/odd.zzz': 'who knows\n',
  '/work/logo.png': 'not really a png',
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
/** Past the frame that places the caret, and the wait before anything is counted. */
const settle = async (): Promise<void> => {
  await sleep(STATUS_COUNT_DELAY_MS + 80)
  await nextTick()
}

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined

beforeEach(async () => {
  resetDocuments()
  resetWorkbench()
  host = createMockHost({ files: FILES, roots: ['/work'] })
  setHost(host)
  clearCommands()
  registerDefaultCommands()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(StatusBar)
  app.mount(root)
  mounted = { app, root }
  await nextTick()
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  closePalette()
  resetDocuments()
  resetWorkbench()
  findCounts.clear()
  indexStatus.value = IDLE_INDEX
  setHost(undefined)
  document.body.replaceChildren()
})

const item = (name: string): string | null =>
  document.querySelector(`[data-status-item="${name}"]`)?.textContent.trim() ?? null

const items = (): Record<string, string> =>
  Object.fromEntries(
    [...document.querySelectorAll<HTMLElement>('[data-status-item]')].map((element) => [
      element.dataset.statusItem ?? '',
      element.textContent.trim(),
    ]),
  )

async function open(path: string): Promise<string> {
  const tab = await openPath(path)
  await settle()
  return tab
}

async function select(tab: string, anchor: number, head = anchor): Promise<void> {
  followerOfTab(tab)!.dispatch({ selection: { anchor, head } })
  await settle()
}

const startOf = (tab: string, line: number): number => followerOfTab(tab)!.state.doc.line(line).from

describe('Ln and Col (ISC-769)', () => {
  it('follow the caret, counting an emoji as one column', async () => {
    const tab = await open('/work/b.md')
    expect(item('position')).toBe('Ln 1, Col 1')
    await select(tab, 4)
    expect(item('position')).toBe('Ln 1, Col 4')
    await select(tab, startOf(tab, 2) + 3)
    expect(item('position')).toBe('Ln 2, Col 4')
  })

  it('open Go to line when clicked, without taking the focus first', async () => {
    await open('/work/a.md')
    const button = document.querySelector<HTMLElement>('[data-status-item="position"]')!
    expect(button.tagName).toBe('BUTTON')
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
    button.click()
    await nextTick()
    expect(paletteMode.value).toBe('line')
  })
})

describe('in raw Markdown (ISC-769)', () => {
  it('says the same line and column as in live preview', async () => {
    const tab = await open('/work/a.md')
    // Just after the hidden marks of the bold word.
    await select(tab, startOf(tab, 3) + 4)
    expect(item('position')).toBe('Ln 3, Col 5')
    const follower = followerOfTab(tab)!
    follower.reconfigure(previewEffect(follower.state, false)!)
    await settle()
    expect(item('position')).toBe('Ln 3, Col 5')
  })
})

describe('the selection (ISC-770)', () => {
  it('says how many characters and lines, only while text is selected', async () => {
    const tab = await open('/work/b.md')
    await select(tab, 0, 4)
    expect(item('position')).toBe('Ln 1, Col 4 (3 chars, 1 line)')
    // From the start into the second line: the emoji and the line break are one each.
    await select(tab, 0, startOf(tab, 2) + 2)
    expect(item('position')).toBe('Ln 2, Col 3 (8 chars, 2 lines)')
    // To the start of the next line: nothing of that line is selected.
    await select(tab, 0, startOf(tab, 2))
    expect(item('position')).toBe('Ln 2, Col 1 (6 chars, 1 line)')
    await select(tab, 1, 2)
    expect(item('position')).toBe('Ln 1, Col 3 (1 char, 1 line)')
    await select(tab, 2)
    expect(item('position')).toBe('Ln 1, Col 3')
  })
})

describe('the word count (ISC-771)', () => {
  it('counts the words of a Markdown file, and of the selection while there is one', async () => {
    const tab = await open('/work/a.md')
    // Title, **one**, two, [a](b.md), 42: the marks that stand alone are not words.
    expect(item('words')).toBe('5 words')
    await select(tab, 0, startOf(tab, 2))
    expect(item('words')).toBe('1 word')
    await select(tab, 0)
    expect(item('words')).toBe('5 words')
    followerOfTab(tab)!.dispatch({ changes: { from: 0, insert: 'more words ' } })
    await settle()
    expect(item('words')).toBe('7 words')
  })

  it('is absent for a file that is not Markdown', async () => {
    await open('/work/main.rs')
    expect(item('words')).toBeNull()
    expect(item('position')).toBe('Ln 1, Col 1')
  })

  it('counts a long text a part at a time, to the same total', () => {
    const lines = Array.from({ length: 5000 }, (_, at) => `line ${String(at)} has - words`)
    const text = Text.of(lines)
    expect(textStats(text, { leaves: 3 })).toBeNull()
    let stats = null
    for (let round = 0; stats === null && round < 100; round++)
      stats = textStats(text, { leaves: 40 })
    expect(stats?.words).toBe(5000 * 4)
    // After an edit only the changed part is read again.
    const edited = text.replace(0, 4, Text.of(['one two']))
    expect(textStats(edited, { leaves: 3 })?.words).toBe(5000 * 4 + 1)
  })
})

describe('the ending, the encoding and the language (ISC-772)', () => {
  it.each([
    ['/work/a.md', 'LF', 'Markdown'],
    ['/work/b.md', 'CRLF', 'Markdown'],
    ['/work/mixed.md', 'Mixed', 'Markdown'],
    ['/work/old.txt', 'CR', 'Plain Text'],
    ['/work/main.rs', 'LF', 'Rust'],
    ['/work/data.json', 'LF', 'JSON'],
    ['/work/odd.zzz', 'LF', 'Plain Text'],
  ])('%s shows %s and %s as plain text', async (path, eol, language) => {
    await open(path)
    await sleep(50)
    await nextTick()
    expect(item('eol')).toBe(eol)
    expect(item('encoding')).toBe('UTF-8')
    expect(item('language')).toBe(language)
    expect(document.querySelectorAll('footer button')).toHaveLength(1)
  })

  it('drops Mixed once the odd ending is gone', async () => {
    const tab = await open('/work/mixed.md')
    const doc = followerOfTab(tab)!.state.doc
    followerOfTab(tab)!.dispatch({ changes: { from: doc.line(2).from, to: doc.line(3).from } })
    await settle()
    expect(item('eol')).toBe('LF')
  })

  it.each([
    ['utf-16le', 'UTF-16 LE'],
    ['utf-16be', 'UTF-16 BE'],
    ['unsupported', 'Unknown encoding'],
  ] as const)('names %s', async (encoding, shown) => {
    const real: Host['openFile'] = host.openFile.bind(host)
    host.openFile = async (...args): Promise<OpenedFile> => ({
      ...(await real(...args)),
      encoding,
    })
    await open('/work/a.md')
    expect(item('encoding')).toBe(shown)
  })
})

describe('what it leaves to the title bar (ISC-236)', () => {
  it('names neither the open file nor its folder', async () => {
    await open('/work/a.md')
    const text = document.querySelector('footer')!.textContent
    expect(text).toContain('Ln 1')
    expect(text).not.toMatch(/a\.md|\/work/)
  })
})

describe('after a Save As', () => {
  it('names the encoding that was written', async () => {
    const real: Host['openFile'] = host.openFile.bind(host)
    host.openFile = async (...args): Promise<OpenedFile> => ({
      ...(await real(...args)),
      encoding: 'utf-16le',
    })
    const tab = await open('/work/a.md')
    const doc = documentOfTab(tab)!
    doc.relocate(doc.snapshot(), {
      path: '/work/copy.md',
      name: 'copy.md',
      hash: '',
      size: 0,
      kind: 'markdown',
      encoding: 'utf-8',
      bom: false,
      renamedImages: [],
      imagesFolder: 'assets',
    })
    await settle()
    expect(item('encoding')).toBe('UTF-8')
  })
})

describe('which tab they are about (ISC-773)', () => {
  it('follows the focused pane', async () => {
    await open('/work/a.md')
    const first = workbenchLayout.value.activePane
    splitActivePane('row')
    const second = await open('/work/main.rs')
    expect(item('language')).toBe('Rust')
    const other = workbenchLayout.value.activePane
    expect(other).not.toBe(first)
    selectTab(findPane(workbenchLayout.value, first)!.activeTab!)
    await settle()
    expect(item('language')).toBe('Markdown')
    selectTab(second)
    await settle()
    expect(item('language')).toBe('Rust')
  })

  it.each([
    ['an image', () => openPath('/work/logo.png')],
    ['the Settings tab', () => Promise.resolve(openSettingsTab())],
    ['the theme preview', () => Promise.resolve(openThemePreviewTab())],
  ])('shows nothing for %s', async (_what, show) => {
    await open('/work/a.md')
    await show()
    await settle()
    expect(items()).toEqual({})
  })

  it('shows nothing in an empty pane', async () => {
    const tab = await open('/work/a.md')
    closeTabById(tab)
    await settle()
    expect(items()).toEqual({})
    expect(document.querySelectorAll('footer > *')).toHaveLength(1)
  })

  it('keeps the message and the indexing bar, and cuts the message first', async () => {
    await open('/work/a.md')
    findCounts.set(workbenchLayout.value.activePane, '3 of 12')
    indexStatus.value = { ...IDLE_INDEX, indexing: true, percent: 40 }
    await nextTick()
    const message = document.querySelector('[data-status-text]')!
    expect(message.textContent.trim()).toBe('3 of 12')
    expect(message.className).toMatch(/\bmin-w-0\b/)
    expect(message.className).toMatch(/\btruncate\b/)
    expect(document.querySelector('[data-index-bar]')).not.toBeNull()
    expect(Object.keys(items())).toEqual(['position', 'words', 'eol', 'encoding', 'language'])
    // Past that, the position is cut and nothing else is.
    const position = document.querySelector('[data-status-item="position"]')!
    expect(position.className).toMatch(/\bmin-w-0\b/)
    expect(position.className).toMatch(/\btruncate\b/)
    for (const name of ['words', 'eol', 'encoding', 'language']) {
      const fact = document.querySelector(`[data-status-item="${name}"]`)!
      expect(fact.className, name).toMatch(/\bshrink-0\b/)
    }
  })
})
