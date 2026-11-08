import { forceParsing } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import type { ScenarioContext, ScenarioOutput } from './params'
import { decodeUtf8, framePresented, mountEditorHost, observeNextFrame, sleep } from './support'

/** Moves kept per direction, after `WARMUP` that are dropped. */
const MOVES = 80
const WARMUP = 10

interface Spot {
  /** Inside a bold span on a line with several formatted elements. */
  inside: number
  /** The start of a line a few lines further down, in the same view. */
  outside: number
  /** The start of the line the span is on. */
  lineFrom: number
  /** The raw text of the line, and of the bold span the caret goes into. */
  raw: string
  span: string
}

/** A long formatted line in the middle of the document, where live preview has the most to do. */
function pickSpot(view: EditorView): Spot {
  const doc = view.state.doc
  for (let n = Math.floor(doc.lines / 2); n < doc.lines - 8; n++) {
    const line = doc.line(n)
    const at = line.text.indexOf('**')
    const close = at < 0 ? -1 : line.text.indexOf('**', at + 2)
    // The span must have text, so that hiding its markers shows in the line's own text.
    if (line.length > 120 && close > at + 2) {
      return {
        inside: line.from + at + 3,
        outside: doc.line(n + 6).from,
        lineFrom: line.from,
        raw: line.text,
        span: line.text.slice(at, close + 2),
      }
    }
  }
  throw new Error('no formatted line in the fixture')
}

/** What the page shows for the document line that starts at `from`. */
function shownText(view: EditorView, from: number): string {
  const { node } = view.domAtPos(from)
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest('.cm-line')?.textContent ?? ''
}

/**
 * ISC-58: syntax hides again within 16 ms of the caret leaving. On the 1 MB fixture, with the
 * caret moving between a bold span in a long formatted line and a line below it, each move is
 * measured as the main-thread work it causes: the dispatch that moves the caret (which updates the
 * decorations and the page) plus the next frame's style, layout and paint. After every move the
 * page is read back, so a fast time cannot come from the layer being off: leaving must hide the
 * line's syntax and entering must show it.
 */
export async function reveal(ctx: ScenarioContext): Promise<ScenarioOutput> {
  const text = decodeUtf8(await ctx.host.readFile(ctx.fixture('realistic-1mb.md')))
  const view = createView(
    mountEditorHost(),
    createState(text, [], { parser: true, preview: ctx.params.preview === 1 }),
  )
  view.focus()
  const spot = pickSpot(view)
  view.dispatch({
    selection: { anchor: spot.outside },
    effects: EditorView.scrollIntoView(spot.inside, { y: 'center' }),
  })
  await framePresented()
  await sleep(200)
  forceParsing(view, view.viewport.to, 60_000)
  if (view.visibleRanges.every((r) => r.to < spot.outside)) {
    throw new Error('the line below the span is not in the view')
  }

  const samples: Record<string, number[]> = {
    leaveWorkMs: [],
    leaveUpdateMs: [],
    leaveRenderMs: [],
    enterWorkMs: [],
    enterUpdateMs: [],
    enterRenderMs: [],
  }
  let wrong = 0
  const move = async (to: number, prefix: 'leave' | 'enter', expectRaw: boolean): Promise<void> => {
    const frame = observeNextFrame()
    const t0 = performance.now()
    view.dispatch({ selection: { anchor: to } })
    const updated = performance.now()
    const { start, end } = await frame
    // Entering must show the span's markers. Leaving must hide them, so the line is shorter than
    // its source. With the layer off (the baseline) there is nothing to check.
    if (ctx.params.preview === 1) {
      const shown = shownText(view, spot.lineFrom)
      const ok = expectRaw
        ? shown.includes(spot.span)
        : !shown.includes(spot.span) && shown.length < spot.raw.length
      if (!ok) wrong++
    }
    samples[`${prefix}WorkMs`]?.push(updated - t0 + (end - start))
    samples[`${prefix}UpdateMs`]?.push(updated - t0)
    samples[`${prefix}RenderMs`]?.push(end - start)
  }

  // The first moves warm the paths and are dropped.
  for (let i = 0; i < WARMUP + MOVES; i++) {
    await move(spot.inside, 'enter', true)
    await sleep(40 + Math.random() * 30)
    await move(spot.outside, 'leave', false)
    await sleep(40 + Math.random() * 30)
    if (i === WARMUP - 1) for (const list of Object.values(samples)) list.length = 0
  }

  view.destroy()
  view.dom.parentElement?.remove()
  // A timed scenario has no pass/fail channel, so a page in the wrong state fails the run.
  if (wrong > 0) throw new Error(`${String(wrong)} moves left the page in the wrong state`)
  return {
    samples,
    values: {
      movesPerDirection: MOVES,
      wrongStates: wrong,
      docChars: text.length,
      lineChars: spot.raw.length,
      spanChars: spot.span.length,
    },
  }
}
