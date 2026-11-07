import { forceParsing, syntaxTree } from '@codemirror/language'
import { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import { scanPreview } from '@/editor/livePreview/scan'
import type { ScenarioContext, ScenarioOutput } from './params'
import { decodeUtf8, framePresented, mountEditorHost, sleep } from './support'

/**
 * One scan takes microseconds and the page clock ticks in tenths of a millisecond, so a sample is
 * a batch of scans divided by its size. A median that is still zero fails the run.
 */
const SCANS_PER_SAMPLE = 500
const SCAN_SAMPLES = 40
const UPDATES_PER_SAMPLE = 20
const UPDATE_SAMPLES = 15
/** The pair of documents is measured this many times, in alternating order, so drift cancels. */
const ROUNDS = 3
/** ISC-63: the two sizes' decoration time must agree to within this share. */
const TOLERANCE = 0.2
/** A scan of the whole document is the control: it grows with the file, so it must not look flat. */
const CONTROL_MIN_RATIO = 3

/** The spot in a document `share` of the way down where a long, formatted line starts the view. */
function formattedSpot(doc: Text, share: number): number {
  const start = Math.max(1, Math.floor(doc.lines * share))
  for (let n = start; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (line.length > 120 && (line.text.includes('**') || line.text.includes('`'))) return line.from
  }
  return doc.line(start).from
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
}

interface Place {
  scanMs: number[]
  updateMs: number[]
  controlMs: number[]
  items: number
  visibleChars: number
  parsedTo: number
}

/**
 * Measures the layer at one place in one document: the scan over the visible ranges, a whole view
 * update (a selection move that makes the plugin rebuild), and, as the control, a scan of the whole
 * document. The tree is parsed up to the end of the viewport first, so a flat time cannot come from
 * the parser not having got there.
 */
async function measureAt(view: EditorView, at: number, withControl: boolean): Promise<Place> {
  view.dispatch({
    selection: { anchor: at },
    effects: EditorView.scrollIntoView(at, { y: 'start' }),
  })
  await framePresented()
  await sleep(200)
  forceParsing(view, view.viewport.to, 60_000)
  const parsedTo = syntaxTree(view.state).length
  if (parsedTo < view.viewport.to) throw new Error('the parse did not reach the viewport')

  const scanMs: number[] = []
  let items = 0
  for (let s = 0; s < SCAN_SAMPLES; s++) {
    const t0 = performance.now()
    for (let i = 0; i < SCANS_PER_SAMPLE; i++) {
      items = scanPreview(view.state, view.visibleRanges).length
    }
    scanMs.push((performance.now() - t0) / SCANS_PER_SAMPLE)
  }

  // Two lines inside the view, so each move changes what is revealed and the plugin rebuilds.
  const first = view.state.doc.lineAt(at)
  const spots = [
    first.from,
    view.state.doc.line(Math.min(first.number + 6, view.state.doc.lines)).from,
  ]
  const updateMs: number[] = []
  for (let s = 0; s < UPDATE_SAMPLES; s++) {
    const t0 = performance.now()
    for (let i = 0; i < UPDATES_PER_SAMPLE; i++) {
      view.dispatch({ selection: { anchor: spots[i % 2] ?? at } })
    }
    updateMs.push((performance.now() - t0) / UPDATES_PER_SAMPLE)
  }

  const controlMs: number[] = []
  if (withControl) {
    const whole = [{ from: 0, to: view.state.doc.length }]
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      scanPreview(view.state, whole)
      controlMs.push(performance.now() - t0)
    }
  }
  const visibleChars = view.visibleRanges.reduce((sum, r) => sum + (r.to - r.from), 0)
  return { scanMs, updateMs, controlMs, items, visibleChars, parsedTo }
}

/**
 * ISC-63: decoration time stays flat from 1 MB to 10 MB. The same relative places in both files
 * are scanned, and the run fails if the medians differ by more than 20%. It also prints the item
 * and visible-character counts for both, because a flat time over a different amount of work would
 * mean nothing, and a control that scans the whole document, which must grow with the file or the
 * check could not tell flat from not flat. The 10 MB file is above the app's size cutoff, so the
 * parser is forced on here.
 */
export async function decorationScale(ctx: ScenarioContext): Promise<ScenarioOutput> {
  // The 10 MB document is the 1 MB fixture ten times over, so both views can show exactly the
  // same text, the second deep inside a tree ten times as big. Different content in the two views
  // would change the work and say nothing about size.
  const base = `${decodeUtf8(await ctx.host.readFile(ctx.fixture('realistic-1mb.md')))}\n`
  const baseDoc = Text.of(base.split('\n'))
  const sizes = [{ label: '1mb' }, { label: '10mb' }] as const
  const texts = new Map<string, string>([
    ['1mb', base],
    ['10mb', base.repeat(10)],
  ])

  const samples: Record<string, number[]> = {}
  const values: Record<string, number> = {}
  const places = [
    { name: 'middle', share: 0.5, copy: 4 },
    { name: 'late', share: 0.93, copy: 9 },
  ]
  const add = (key: string, list: number[]) => {
    samples[key] = [...(samples[key] ?? []), ...list]
  }
  for (let round = 0; round < ROUNDS; round++) {
    const order = round % 2 === 0 ? sizes : [...sizes].reverse()
    for (const { label } of order) {
      const text = texts.get(label) ?? ''
      const view = createView(
        mountEditorHost(),
        createState(text, [], { parser: true, preview: true }),
      )
      view.focus()
      for (const { name, share, copy } of places) {
        // The same spot in the first copy of the fixture, then moved to its place in a later copy.
        const spot = formattedSpot(baseDoc, share)
        const at = spot + (label === '1mb' ? 0 : copy * base.length)
        const place = await measureAt(view, at, name === 'middle')
        const key = `${label}-${name}`
        add(`${key}-scanMs`, place.scanMs)
        add(`${key}-updateMs`, place.updateMs)
        add(`${key}-controlMs`, place.controlMs)
        values[`${key}-items`] = place.items
        values[`${key}-visibleChars`] = place.visibleChars
        values[`${key}-parsedTo`] = place.parsedTo
      }
      values[`${label}-docChars`] = text.length
      view.destroy()
      view.dom.parentElement?.remove()
    }
  }

  let failed = false
  let worst = 0
  for (const { name } of places) {
    // Both sizes must be doing the same work, or the times say nothing about size.
    const sameWork = values[`1mb-${name}-items`] === values[`10mb-${name}-items`]
    values[`${name}-sameWork`] = sameWork ? 1 : 0
    if (!sameWork) failed = true
    const small = median(samples[`1mb-${name}-scanMs`] ?? [])
    const large = median(samples[`10mb-${name}-scanMs`] ?? [])
    values[`${name}-scanMedian-1mb`] = small
    values[`${name}-scanMedian-10mb`] = large
    values[`${name}-ratio`] = large / small
    values[`${name}-updateMedian-1mb`] = median(samples[`1mb-${name}-updateMs`] ?? [])
    values[`${name}-updateMedian-10mb`] = median(samples[`10mb-${name}-updateMs`] ?? [])
    // A zero or missing median means the clock could not see the work, so there is no verdict.
    if (!(small > 0) || !(large > 0)) failed = true
    else worst = Math.max(worst, Math.abs(large / small - 1))
  }
  values.worstDeviation = worst
  values.tolerance = TOLERANCE

  const controlSmall = median(samples['1mb-middle-controlMs'] ?? [])
  const controlLarge = median(samples['10mb-middle-controlMs'] ?? [])
  values.controlWholeScan1mbMs = controlSmall
  values.controlWholeScan10mbMs = controlLarge
  values.controlRatio = controlLarge / controlSmall
  // The control must grow with the file. If it does not, flat would prove nothing.
  if (!(controlLarge / controlSmall >= CONTROL_MIN_RATIO)) failed = true

  // The harness prints every value and exits non-zero when `checkFailed` is 1.
  values.checkFailed = failed || worst > TOLERANCE ? 1 : 0
  return { samples, values }
}
