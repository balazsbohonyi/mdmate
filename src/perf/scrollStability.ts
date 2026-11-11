import { ensureSyntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import {
  imageContext,
  resetImageSizes,
  scanBlocks,
  type ImageItem,
} from '@/editor/livePreview/blocks'
import type { ScenarioContext, ScenarioOutput } from './params'
import { decodeUtf8, framePresented, mountEditorHost, sleep } from './support'

/** How far each step moves the scroll position, in px. A fast flick of a wheel or a trackpad. */
const STEP = 60
/** The limit on how far the top line may move beyond what the scroll itself explains. */
const LIMIT_PX = 2
/** The control must drift at least this much, or the measurement cannot see a shift at all. */
const CONTROL_MIN_PX = 10
/** The walk must have asked for at least this many of the images, or the page never loaded them. */
const MIN_IMAGES = 40

/**
 * What an image widget does without any of the care the real one takes: no reserved space, no
 * measure request, the image just appears when it loads. It is the control: the measurement below
 * must show it moving the text, or a flat result for the real widget proves nothing.
 */
class NaiveImage extends WidgetType {
  readonly src: string
  constructor(src: string) {
    super()
    this.src = src
  }
  override eq(other: WidgetType): boolean {
    return other instanceof NaiveImage && other.src === this.src
  }
  override toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    const img = document.createElement('img')
    img.src = this.src
    img.style.display = 'block'
    img.style.maxWidth = '100%'
    wrap.append(img)
    return wrap
  }
}

function naiveImages(): Extension {
  const build = (state: EditorState): DecorationSet => {
    const items = scanBlocks(state, [{ from: 0, to: state.doc.length }]).filter(
      (item): item is ImageItem => item.kind === 'image' && item.block && item.src !== null,
    )
    return Decoration.set(
      items.map((item) =>
        Decoration.replace({
          widget: new NaiveImage(item.src ?? ''),
          block: true,
        }).range(item.from, item.to),
      ),
    )
  }
  return StateField.define<DecorationSet>({
    create: build,
    // The document never changes here.
    update: (value) => value,
    provide: (field) => EditorView.decorations.from(field),
  })
}

interface Step {
  step: number
  drift: number
  scrollTopBefore: number
  scrollTopAfter: number
  heightBefore: number
  heightAfter: number
  /** After the first of the two frames: scroll position, height and where the line was. */
  midway: { scrollTop: number; height: number; top: number | null }
}

interface Walk {
  /** The three steps that moved the top line most, for reading when a run fails. */
  worst: Step[]
  /** The largest the top line moved beyond what the scroll explains, in px. */
  max: number
  p99: number
  frames: number
}

/** The first line that is fully in view, as a document position and where it is on screen. */
function topLine(view: EditorView): { pos: number; top: number } | undefined {
  const edge = view.scrollDOM.getBoundingClientRect().top
  for (const line of view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')) {
    if (line.getBoundingClientRect().top < edge) continue
    const pos = view.posAtDOM(line)
    const at = view.coordsAtPos(pos)
    if (at !== null) return { pos, top: at.top }
  }
  return undefined
}

/**
 * Scrolls in steps and, after each, asks where the top line went. The scroll moves it by exactly
 * the step, so whatever else moved it (an image that finished loading above it, a height that was
 * guessed wrong) is the drift. Every step is measured against the line that was on top before it.
 */
async function walk(view: EditorView, direction: 'up' | 'down'): Promise<Walk> {
  const scroller = view.scrollDOM
  const drifts: number[] = []
  const steps: Step[] = []
  for (let i = 0; i < 2000; i++) {
    const before = scroller.scrollTop
    const room = scroller.scrollHeight - scroller.clientHeight
    if (direction === 'up' ? before < STEP : before + STEP > room) break
    const anchor = topLine(view)
    if (anchor === undefined) {
      await framePresented()
      continue
    }
    const delta = direction === 'up' ? -STEP : STEP
    const heightBefore = scroller.scrollHeight
    scroller.scrollTop = before + delta
    await framePresented()
    const midway = {
      scrollTop: scroller.scrollTop,
      height: scroller.scrollHeight,
      top: view.coordsAtPos(anchor.pos)?.top ?? null,
    }
    await framePresented()
    const now = view.coordsAtPos(anchor.pos)
    if (now === null) continue
    // Scrolling down by `STEP` moves a line up by `STEP`.
    const drift = Math.abs(now.top - anchor.top + delta)
    drifts.push(drift)
    steps.push({
      step: i,
      drift,
      scrollTopBefore: before,
      scrollTopAfter: scroller.scrollTop,
      heightBefore,
      heightAfter: scroller.scrollHeight,
      midway,
    })
  }
  const sorted = [...drifts].sort((a, b) => a - b)
  return {
    worst: steps.sort((a, b) => b.drift - a.drift).slice(0, 3),
    max: sorted[sorted.length - 1] ?? Number.NaN,
    p99: sorted[Math.floor(sorted.length * 0.99)] ?? Number.NaN,
    frames: drifts.length,
  }
}

interface Variant {
  up: Walk
  down: Walk
  imagesRequested: number
}

async function measure(
  ctx: ScenarioContext,
  text: string,
  folder: string,
  naive: boolean,
): Promise<Variant> {
  const perf = ctx.host.perf
  if (!perf) throw new Error('this scenario needs the perf bridge')
  resetImageSizes()
  const requestsBefore = performance.getEntriesByType('resource').length
  // A new address each run, so the browser's cache cannot answer: every image loads for the first time.
  const run = `${String(Date.now())}${naive ? 'n' : 'r'}`
  const context = imageContext.of({
    folder: () => folder,
    boundary: () => null,
    url: (path) => `${perf.assetUrl(path)}?run=${run}`,
  })
  let state = createState(text, [context], { parser: true, preview: !naive })
  if (naive) {
    // The control reads the tree when it is built, so the parse must be whole before that.
    ensureSyntaxTree(state, state.doc.length, 60_000)
    // The state only picks up the finished tree on its next update.
    state = state.update({}).state
    state = state.update({ effects: StateEffect.appendConfig.of(naiveImages()) }).state
  }
  const view = createView(mountEditorHost(), state)
  await framePresented()
  await sleep(200)

  // Up first, from the bottom: every image on the way is one the page has not seen.
  view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight
  await framePresented()
  await sleep(300)
  const up = await walk(view, 'up')
  view.scrollDOM.scrollTop = 0
  await framePresented()
  await sleep(300)
  const down = await walk(view, 'down')

  const imagesRequested = performance
    .getEntriesByType('resource')
    .slice(requestsBefore)
    .filter((entry) => /img-\d+\.png/.test(entry.name)).length
  view.destroy()
  view.dom.parentElement?.remove()
  return { up, down, imagesRequested }
}

/**
 * ISC-72: late-rendering widgets never shift the scroll position. A document of 80 sections, each
 * with an image of its own size, is scrolled from the bottom to the top and back, in steps of
 * 60 px. After each step the line at the top of the view is looked for, and it must be exactly
 * where the scroll put it, to within 2 px, however many images finished loading in between.
 *
 * The same walk runs over a control, an image widget with no reserved space and no measure
 * request. That one must drift by at least 10 px, or the check could not see a shift and a pass for
 * the real widget would mean nothing.
 */
export async function scrollStability(ctx: ScenarioContext): Promise<ScenarioOutput> {
  const perf = ctx.host.perf
  if (!perf) throw new Error('this scenario needs the perf bridge')
  const root = ctx.config.fixturesDir.replace(/[\\/]tests[\\/]fixtures[\\/]?$/, '')
  const folder = `${root}\\perf-results\\scroll-lab`
  await perf.grantFile(`${folder}\\doc.md`)
  const text = decodeUtf8(await ctx.host.readFile(`${folder}\\doc.md`))
  await perf.allowAssetDirectory(folder)

  const real = await measure(ctx, text, folder, false)
  const control = await measure(ctx, text, folder, true)

  const worstReal = Math.max(real.up.max, real.down.max)
  const worstControl = Math.max(control.up.max, control.down.max)
  const problems: string[] = []
  if (!(worstReal < LIMIT_PX)) {
    problems.push(
      `the real widget moved the top line by ${worstReal.toFixed(1)} px (limit ${String(LIMIT_PX)})`,
    )
  }
  if (!(worstControl >= CONTROL_MIN_PX)) {
    problems.push(
      `the control moved it by only ${worstControl.toFixed(1)} px, so the check cannot see a shift`,
    )
  }
  if (real.imagesRequested < MIN_IMAGES) {
    problems.push(
      `only ${String(real.imagesRequested)} images were requested (need ${String(MIN_IMAGES)})`,
    )
  }
  if (real.up.frames < 100 || real.down.frames < 100) {
    problems.push('the walk measured too few steps')
  }

  return {
    samples: {},
    values: {
      checkFailed: problems.length > 0 ? 1 : 0,
      limitPx: LIMIT_PX,
      realMaxDriftUpPx: real.up.max,
      realMaxDriftDownPx: real.down.max,
      realP99DriftUpPx: real.up.p99,
      realStepsUp: real.up.frames,
      realStepsDown: real.down.frames,
      realImagesRequested: real.imagesRequested,
      controlMaxDriftUpPx: control.up.max,
      controlMaxDriftDownPx: control.down.max,
      controlStepsUp: control.up.frames,
      controlImagesRequested: control.imagesRequested,
    },
    notes: { problems, worstRealUp: real.up.worst, worstRealDown: real.down.worst },
  }
}
