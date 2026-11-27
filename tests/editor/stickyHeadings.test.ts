// @vitest-environment jsdom
// ISC-762 to ISC-766: the sticky headings, on a page with no layout: CodeMirror gives every line the
// same estimated height there, and the view is scrolled by moving the top of its document.
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { followerOfTab, openInActivePane, resetDocuments } from '@/documents/store'
import { createState, createView } from '@/editor/create'
import { findEffect, findNext, EMPTY_FIND } from '@/editor/find'
import { jumpSpec } from '@/editor/goToLine'
import { headingSource, refreshStickyHeadings, ROW_FALLBACK } from '@/editor/stickyHeadings'
import { flipSetting } from '@/features/settings/quick'
import { resetSettingsState } from '@/features/settings/store'
import { resetSettings, settings } from '@/lib/settings'
import { HEADING_SCAN_DELAY_MS } from '@/lib/headingScan'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { clearCommands, getCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetWorkbench } from '@/workbench/store'

const ROW = ROW_FALLBACK

const section = (heading: string): string[] => [
  heading,
  ...Array.from({ length: 15 }, (_, at) => `body ${String(at)} of ${heading.replace(/#/g, '')}`),
]

const DOC = [
  'before any heading',
  ...section('# One'),
  ...section('## Two'),
  ...section('### Three'),
  ...section('#### Four'),
  ...section('##### Five'),
  ...section('###### Six'),
  ...section('## Again'),
  ...section('#### Skipped'),
  ...section('# Last'),
  ...section('### Deep'),
].join('\n')

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
/** The scan answers on a timer and the stack is drawn in the next frame. */
const flush = (ms = 60): Promise<void> => sleep(ms)

let host: MockHost
const views: EditorView[] = []
const tops = new WeakMap<EditorView, number>()

beforeEach(() => {
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  resetSettings()
  resetSettingsState()
  resetDocuments()
  resetWorkbench()
  host = createMockHost({
    files: { '/work/a.md': DOC, '/work/data.json': '# not a heading\n'.repeat(40) },
  })
  setHost(host)
})

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  setHost(undefined)
  document.body.replaceChildren()
})

const source = (view: () => EditorView) =>
  headingSource.of(
    async () => (await host.outlineScan({ id: 1, text: view().state.doc.toString() })).headings,
  )

async function mount(text = DOC, preview = true): Promise<EditorView> {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view: EditorView = createView(parent, createState(text, [source(() => view)], { preview }))
  views.push(view)
  place(view)
  await flush()
  return view
}

/** Lets a test scroll a view that has no layout. */
function place(view: EditorView): void {
  tops.set(view, 0)
  Object.defineProperty(view, 'documentTop', { get: () => -(tops.get(view) ?? 0) })
}

async function scrollTo(view: EditorView, top: number): Promise<void> {
  tops.set(view, top)
  view.scrollDOM.dispatchEvent(new Event('scroll'))
  await flush()
}

const lineStart = (view: EditorView, text: string): number => {
  const at = view.state.doc.toString().split('\n').indexOf(text)
  expect(at, text).toBeGreaterThanOrEqual(0)
  return view.state.doc.line(at + 1).from
}

const blockTop = (view: EditorView, pos: number): number => view.lineBlockAt(pos).top

const rows = (view: EditorView): string[] =>
  [...view.dom.querySelectorAll('.cm-md-sticky-text')].map((row) => row.textContent ?? '')

/** Scrolls so the line stands just under a stack of `count` rows. */
const under = (view: EditorView, text: string, count: number): Promise<void> =>
  scrollTo(view, blockTop(view, lineStart(view, text)) - count * ROW)

const margin = (view: EditorView): number =>
  Math.max(0, ...view.state.facet(EditorView.scrollMargins).map((read) => read(view)?.top ?? 0))

describe('the rows (ISC-762)', () => {
  it.each([
    ['body 12 of  Six', ['# One', '## Two', '### Three', '#### Four', '##### Five', '###### Six']],
    ['body 12 of  Three', ['# One', '## Two', '### Three']],
    ['body 12 of  Skipped', ['# One', '## Again', '#### Skipped']],
    ['body 12 of  Deep', ['# Last', '### Deep']],
    ['body 12 of  One', ['# One']],
  ])('above %j are its ancestors in order', async (line, expected) => {
    const view = await mount()
    await under(view, line, expected.length)
    expect(rows(view)).toEqual(expected)
  })

  it('are none above the first heading', async () => {
    const view = await mount()
    expect(rows(view)).toEqual([])
    await scrollTo(view, blockTop(view, lineStart(view, '# One')))
    expect(rows(view)).toEqual([])
  })

  it('give way to the next heading of their level as it comes up', async () => {
    const view = await mount()
    await under(view, '## Again', 2)
    expect(rows(view)).toEqual(['# One', '## Two'])
    // Again has reached the second row: Two is over, and only the heading above both stays.
    await under(view, '## Again', 1)
    expect(rows(view)).toEqual(['# One'])
  })

  it('are the source lines, with their numbers while line numbers are on', async () => {
    settings.editor.lineNumbers = true
    const view = await mount()
    await under(view, 'body 12 of  Two', 2)
    expect(rows(view)).toEqual(['# One', '## Two'])
    expect(
      [...view.dom.querySelectorAll('.cm-md-sticky-number')].map((number) => number.textContent),
    ).toEqual(['2', '18'])
  })

  it('stay on their lines while the text above is edited, before the next scan', async () => {
    const view = await mount()
    view.dispatch({ changes: { from: 0, insert: 'new\nlines\nhere\n' } })
    await under(view, 'body 12 of  Two', 2)
    expect(rows(view)).toEqual(['# One', '## Two'])
  })

  it('follow a heading that is typed, once the typing pauses', async () => {
    const view = await mount()
    const at = lineStart(view, 'body 2 of  Two')
    view.dispatch({ changes: { from: at, insert: '### Typed\n' } })
    await flush(HEADING_SCAN_DELAY_MS + 100)
    await under(view, 'body 12 of  Two', 3)
    expect(rows(view)).toEqual(['# One', '## Two', '### Typed'])
  })
})

describe('where they show (ISC-763)', () => {
  it('draws a stack for each view on its own, in preview and raw', async () => {
    const preview = await mount()
    const raw = await mount(DOC, false)
    await under(preview, 'body 12 of  Two', 2)
    await under(raw, 'body 12 of  Deep', 2)
    expect(rows(preview)).toEqual(['# One', '## Two'])
    expect(rows(raw)).toEqual(['# Last', '### Deep'])
  })

  it('takes no `#` line of frontmatter or code for a heading', async () => {
    const view = await mount(
      ['---', '# comment', '---', '# Real', '```sh', '# not', '```', ...section('text')].join('\n'),
    )
    await under(view, 'body 12 of text', 1)
    expect(rows(view)).toEqual(['# Real'])
  })

  it('gives a Markdown document a heading source and another file none', async () => {
    // A pane's view has no line heights on a page with no layout, so the rows are covered above.
    for (const [path, count] of [
      ['/work/a.md', 10],
      ['/work/data.json', null],
    ] as const) {
      const tab = await openInActivePane(path)
      const source = followerOfTab(tab)!.state.facet(headingSource)
      expect((await source?.())?.length ?? null, path).toBe(count)
    }
  })

  it('shares one scan between the tabs of a document, until its text changes', async () => {
    const first = await openInActivePane('/work/a.md')
    const doc = followerOfTab(first)!
    const source = doc.state.facet(headingSource)!
    const scans: unknown[] = []
    const scan = host.outlineScan.bind(host)
    host.outlineScan = (request) => {
      scans.push(request)
      return scan(request)
    }
    await Promise.all([source(), source()])
    expect(scans).toHaveLength(1)
    doc.dispatch({ changes: { from: 0, insert: '# New\n' } })
    expect((await source()).length).toBe(11)
    expect(scans).toHaveLength(2)
  })
})

describe('a click on a row (ISC-764)', () => {
  it('puts the caret on that heading, to be shown under its own ancestors', async () => {
    const view = await mount()
    for (const [index, heading] of ['# One', '## Two', '### Three'].entries()) {
      await under(view, 'body 12 of  Three', 3)
      const row = view.dom.querySelectorAll<HTMLElement>(
        '.cm-md-sticky-row:not(.cm-md-sticky-probe)',
      )[index]!
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      expect(view.state.selection.main.head, heading).toBe(lineStart(view, heading))
      expect(margin(view), heading).toBe(index * ROW)
    }
  })
})

describe('the caret and jumps stay below the stack (ISC-765)', () => {
  it('leaves room for as many rows as can stand above the caret, on every line', async () => {
    const view = await mount()
    for (let number = 1; number <= view.state.doc.lines; number++) {
      const line = view.state.doc.line(number)
      view.dispatch({ selection: { anchor: line.from } })
      const room = margin(view)
      tops.set(view, Math.max(0, blockTop(view, line.from) - room))
      view.scrollDOM.dispatchEvent(new Event('scroll'))
      await flush(20)
      expect(rows(view).length * ROW, line.text).toBeLessThanOrEqual(room)
    }
  }, 30_000)

  it('leaves that room after Go to line and a find match', async () => {
    const view = await mount()
    const number = view.state.doc.lineAt(lineStart(view, 'body 4 of  Skipped')).number
    view.dispatch(jumpSpec(view.state, { line: number, column: 1 }))
    expect(margin(view)).toBe(3 * ROW)
    view.dispatch({
      selection: { anchor: 0 },
      effects: findEffect({ ...EMPTY_FIND, search: 'body 4 of  Deep' }),
    })
    findNext(view)
    expect(margin(view)).toBe(2 * ROW)
  })
})

describe('the setting (ISC-766)', () => {
  it('takes the stack away and brings it back, in every view', async () => {
    const first = await mount()
    const second = await mount()
    for (const view of [first, second]) await under(view, 'body 12 of  Two', 2)
    settings.editor.stickyHeadings = false
    refreshStickyHeadings()
    await flush()
    expect([rows(first), rows(second), margin(first)]).toEqual([[], [], 0])
    settings.editor.stickyHeadings = true
    refreshStickyHeadings()
    await flush()
    expect(rows(second)).toEqual(['# One', '## Two'])
  })

  it('is on by default and has a palette command that writes it', async () => {
    expect(settings.editor.stickyHeadings).toBe(true)
    clearCommands()
    const remove = registerDefaultCommands()
    const command = getCommand(COMMAND_IDS.toggleStickyHeadings)!
    expect(command.title).toBe('Toggle Sticky Headings')
    expect(command.state?.()).toBe(true)
    await flipSetting('editor.stickyHeadings')
    expect(command.state?.()).toBe(false)
    remove()
  })
})
