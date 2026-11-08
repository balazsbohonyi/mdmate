import { EditorView } from '@codemirror/view'
import type { Text } from '@codemirror/state'
import { createState, createView } from '@/editor/create'
import type { ScenarioContext, ScenarioOutput } from './params'
import {
  type FrameMarks,
  decodeUtf8,
  framePresented,
  mountEditorHost,
  observeNextFrame,
  sleep,
  waitUntil,
} from './support'

export type TypingMode =
  /** The page inserts each character with `view.dispatch`. No OS or browser input path. */
  | 'dispatch'
  /** The harness injects real key events through the DevTools port; the page only listens. */
  | 'trusted'

/** One display frame at 60 Hz. Random gaps this wide spread the keys across the frame cycle. */
const FRAME_MS = 1000 / 60

/** A spot in the middle of a long, formatted line, where live preview would have most to do. */
function pickCaret(doc: Text): number {
  const middle = Math.floor(doc.lines / 2)
  for (let n = middle; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (line.length > 120 && (line.text.includes('**') || line.text.includes('`'))) {
      const target = line.from + Math.floor(line.length / 2)
      const space = line.text.indexOf(' ', target - line.from)
      return space < 0 ? target : line.from + space + 1
    }
  }
  return doc.line(middle).from
}

const letter = (i: number): string => String.fromCharCode(97 + (i % 26))

/**
 * Typing on the 1 MB fixture, with the caret in the middle of a formatted paragraph. Each key is
 * measured three ways, all in ms:
 *
 * - `workMs` is what the key cost the main thread: handling it and updating the editor, plus the
 *   next frame's style, layout and paint. The 16 ms budget applies to this.
 * - `latencyMs` is key to frame. It adds the idle wait for the frame to start, which is up to one
 *   frame (16.7 ms) and no fault of the editor.
 * - `renderMs` is the frame part of `workMs` alone.
 *
 * dispatch: the page inserts the character itself, so the work starts at `view.dispatch`.
 * trusted: the harness sends real key events, so the work starts at the event's own timestamp
 * and also covers delivery of the key to the page.
 */
export async function typing(
  ctx: ScenarioContext,
  mode: TypingMode,
  fixture = 'realistic-1mb.md',
): Promise<ScenarioOutput> {
  const { warmupKeys, keys, keyIntervalMs } = ctx.params
  const total = warmupKeys + keys
  const text = decodeUtf8(await ctx.host.readFile(ctx.fixture(fixture)))

  const workMs: number[] = []
  const latencyMs: number[] = []
  const renderMs: number[] = []
  /** Trusted mode: key to the editor being updated. Dispatch mode: `view.dispatch` itself. */
  const updateMs: number[] = []
  let pending: { keyTime: number; frame: Promise<FrameMarks> } | undefined

  const watchKeys = EditorView.updateListener.of((update) => {
    if (mode !== 'trusted' || !update.docChanged || !pending) return
    const { keyTime, frame } = pending
    pending = undefined
    const updatedAt = performance.now()
    void frame.then(({ start, end }) => {
      workMs.push(updatedAt - keyTime + (end - start))
      latencyMs.push(end - keyTime)
      renderMs.push(end - start)
      updateMs.push(updatedAt - keyTime)
    })
  })

  const view = createView(
    mountEditorHost(),
    createState(text, [watchKeys], {
      parser: ctx.params.parser !== 0,
      preview: ctx.params.preview !== 0,
    }),
  )
  const caret = pickCaret(view.state.doc)
  view.dispatch({
    selection: { anchor: caret },
    effects: EditorView.scrollIntoView(caret, { y: 'center' }),
  })
  view.focus()
  await framePresented()
  await sleep(300)

  const values = { caret, docBytes: text.length, warmupKeys }

  if (mode === 'dispatch') {
    for (let i = 0; i < total; i++) {
      const head = view.state.selection.main.head
      // Watch the frame first, so the editor's own frame callbacks land inside it.
      const frame = observeNextFrame()
      const t0 = performance.now()
      view.dispatch({
        changes: { from: head, insert: letter(i) },
        selection: { anchor: head + 1 },
        userEvent: 'input.type',
        scrollIntoView: true,
      })
      const t1 = performance.now()
      const { start, end } = await frame
      if (i >= warmupKeys) {
        workMs.push(t1 - t0 + (end - start))
        latencyMs.push(end - t0)
        renderMs.push(end - start)
        updateMs.push(t1 - t0)
      }
      // The gap is random, so keys do not line up with the frame clock the way a fixed 50 ms
      // gap (three frames, almost exactly) would make them.
      await sleep(keyIntervalMs + Math.random() * FRAME_MS)
    }
    return { samples: { workMs, latencyMs, renderMs, updateMs }, values }
  }

  view.contentDOM.addEventListener(
    'keydown',
    (event) => {
      // Watch the frame at the key, before the text changes, for the same reason as above.
      if (event.key.length === 1) pending = { keyTime: event.timeStamp, frame: observeNextFrame() }
    },
    { capture: true },
  )
  // The harness starts sending keys once it sees this flag.
  Reflect.set(window, '__perfReady', true)
  await waitUntil(
    () => workMs.length >= total,
    total * (keyIntervalMs + 40) + 20_000,
    `${String(total)} key events from the harness (got ${String(workMs.length)})`,
  )
  const kept = (list: number[]) => list.slice(warmupKeys)
  return {
    samples: {
      workMs: kept(workMs),
      latencyMs: kept(latencyMs),
      renderMs: kept(renderMs),
      updateMs: kept(updateMs),
    },
    values,
  }
}
