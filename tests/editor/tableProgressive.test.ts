// @vitest-environment jsdom
/**
 * ISC-6 (tab switch under 50 ms): a table too big to lay out inside a frame is drawn in two steps,
 * the header and the first rows at once and the rest after the frame. This pins the steps; the
 * time itself is `pnpm perf tab-switch`, and the look is checked in the real window.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { blocksOf } from '@/editor/livePreview/blocks'
import { FILLED_KEY, FIRST_ROWS, ROW_HEIGHT } from '@/editor/livePreview/blocks/widgets'
import { blockStateOf, mountPreview } from '../helpers/blocks'

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

/** A table of `rows` body rows, `r<row>c<column>` in each cell, with a paragraph after it. */
function tableDoc(rows: number): string {
  const lines = ['| c0 | c1 | c2 |', '|---|---|---|']
  for (let r = 0; r < rows; r++)
    lines.push(`| r${String(r)}c0 | r${String(r)}c1 | r${String(r)}c2 |`)
  return `${lines.join('\n')}\n\nafter\n`
}

/** The page with the caret on the paragraph after the table, so the table is drawn. */
function mount(rows: number): { view: EditorView; doc: string } {
  const doc = tableDoc(rows)
  const view = mountPreview(doc, doc.length - 2)
  views.push(view)
  return { view, doc }
}

const bodyRows = (view: EditorView): HTMLElement[] => [
  ...view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-table tbody tr:not(.cm-md-table-rest)'),
]
const spacer = (view: EditorView): HTMLElement | null =>
  view.contentDOM.querySelector<HTMLElement>('.cm-md-table-rest')
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('a big table, drawn in two steps (ISC-6)', () => {
  it('draws a table of FIRST_ROWS rows or fewer whole, with nothing left for later', () => {
    const { view } = mount(FIRST_ROWS)
    expect(bodyRows(view)).toHaveLength(FIRST_ROWS)
    expect(spacer(view)).toBeNull()
  })

  it('draws the header and the first rows at once for a bigger table, and a spacer for the rest', () => {
    const { view } = mount(FIRST_ROWS + 250)
    expect(view.contentDOM.querySelectorAll('.cm-md-table thead th')).toHaveLength(3)
    expect(bodyRows(view)).toHaveLength(FIRST_ROWS)
    const rest = spacer(view)
    expect(rest).not.toBeNull()
    expect(rest?.querySelector('td')?.style.height).toBe(`${String(250 * ROW_HEIGHT)}px`)
    expect(rest?.querySelector('td')?.colSpan).toBe(3)
  })

  it('adds the rest after the frame, in order, and takes the spacer away', async () => {
    const { view } = mount(FIRST_ROWS + 250)
    await vi.waitFor(() => {
      expect(bodyRows(view)).toHaveLength(FIRST_ROWS + 250)
    })
    expect(spacer(view)).toBeNull()
    const first = bodyRows(view).map((row) => row.firstElementChild?.textContent)
    expect(first).toEqual(Array.from({ length: FIRST_ROWS + 250 }, (_, r) => `r${String(r)}c0`))
    // Every cell of the last row, with its alignment and offset attribute, as in a whole build.
    const last = bodyRows(view).at(-1)
    expect([...(last?.children ?? [])].map((cell) => cell.textContent)).toEqual([
      `r${String(FIRST_ROWS + 249)}c0`,
      `r${String(FIRST_ROWS + 249)}c1`,
      `r${String(FIRST_ROWS + 249)}c2`,
    ])
    expect(last?.firstElementChild?.getAttribute('data-offset')).not.toBeNull()
  })

  it('asks CodeMirror to measure again when the rest arrives, so the height is the real one', async () => {
    const doc = tableDoc(FIRST_ROWS + 250)
    const view = mountPreview(doc, doc.length - 2)
    views.push(view)
    const measure = vi.spyOn(view, 'requestMeasure')
    await vi.waitFor(() => {
      expect(bodyRows(view)).toHaveLength(FIRST_ROWS + 250)
    })
    // CodeMirror asks to measure on its own after a DOM change, so look for the table's own request.
    expect(measure).toHaveBeenCalledWith(expect.objectContaining({ key: FILLED_KEY }))
  })

  it('swaps the rows in during the editor write phase, so its scroll anchoring sees the change', async () => {
    const doc = tableDoc(FIRST_ROWS + 250)
    const view = mountPreview(doc, doc.length - 2)
    views.push(view)
    const requests: { key?: unknown; write?: () => void }[] = []
    vi.spyOn(view, 'requestMeasure').mockImplementation((request) => {
      if (request !== undefined) requests.push(request as never)
    })
    await vi.waitFor(() => {
      expect(requests.some((request) => request.key === FILLED_KEY)).toBe(true)
    })
    // The request is made, but until CodeMirror runs its write step the page still has the spacer.
    expect(bodyRows(view)).toHaveLength(FIRST_ROWS)
    requests.find((request) => request.key === FILLED_KEY)?.write?.()
    expect(bodyRows(view)).toHaveLength(FIRST_ROWS + 250)
    expect(spacer(view)).toBeNull()
  })

  it('keeps the height it gives CodeMirror, whatever has been drawn so far', () => {
    const doc = tableDoc(FIRST_ROWS + 250)
    const widget = blocksOf(blockStateOf(doc, doc.length - 2))[0]
    expect(widget?.estimatedHeight).toBe((FIRST_ROWS + 250 + 1) * ROW_HEIGHT + 16)
  })

  it('stops filling when the table goes away, and does not touch the page afterwards', async () => {
    const { view, doc } = mount(FIRST_ROWS + 250)
    const oldBody = view.contentDOM.querySelector('.cm-md-table tbody')
    expect(oldBody?.children).toHaveLength(FIRST_ROWS + 1)
    // The caret enters the table, which gives way to its source and removes the widget.
    view.dispatch({ selection: { anchor: doc.indexOf('| c0') + 2 } })
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    await sleep(60)
    expect(oldBody?.children).toHaveLength(FIRST_ROWS + 1)
  })

  it('puts the caret in the right row when the click lands on rows not drawn yet', () => {
    const { view, doc } = mount(FIRST_ROWS + 250)
    const rest = spacer(view)?.querySelector('td')
    // jsdom has no layout, so the spacer starts at 0: 3.5 rows down is the fourth undrawn row.
    rest?.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientY: 3.5 * ROW_HEIGHT,
      }),
    )
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    const head = view.state.selection.main.head
    expect(doc.slice(head).startsWith(`r${String(FIRST_ROWS + 3)}c0`)).toBe(true)
  })

  it('draws a table again from its first rows when the caret leaves it', async () => {
    const { view, doc } = mount(FIRST_ROWS + 250)
    await vi.waitFor(() => {
      expect(bodyRows(view)).toHaveLength(FIRST_ROWS + 250)
    })
    view.dispatch({ selection: { anchor: doc.indexOf('| c0') + 2 } })
    view.dispatch({ selection: { anchor: doc.length - 2 } })
    expect(bodyRows(view)).toHaveLength(FIRST_ROWS)
    await vi.waitFor(() => {
      expect(bodyRows(view)).toHaveLength(FIRST_ROWS + 250)
    })
  })
})
