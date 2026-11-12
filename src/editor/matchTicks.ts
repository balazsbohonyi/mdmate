import { getSearchQuery } from '@codemirror/search'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/**
 * Where the matches are, drawn along the scrollbar (P7-T6): a small tick for every place in the file
 * the Find bar's query matches, and for every place the folder search found a hit, so the whole
 * file shows at a glance and a tick points to where the thumb must go. The ticks sit in a strip
 * behind the scrollbar, so the thumb (a translucent one) passes over them, and a tick is one pixel
 * row per few pixels of track however many matches share it, so ten thousand matches draw a few
 * hundred small boxes.
 */

/** A place the folder search found in this file. */
export interface SearchHitRange {
  readonly from: number
  readonly to: number
}

/** The places the folder search found in this file; an empty list takes the marks away. */
export const setSearchHits = StateEffect.define<readonly SearchHitRange[]>()

const hitsField = StateField.define<readonly SearchHitRange[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSearchHits)) return effect.value
    }
    // An edit moves the places with the text, so a mark keeps covering its match.
    return tr.docChanged && value.length > 0
      ? value.map((hit) => ({
          from: tr.changes.mapPos(hit.from, 1),
          to: tr.changes.mapPos(hit.to, -1),
        }))
      : value
  },
  // Every hit shows in the text in the muted Find color; the one a click opened is drawn over it.
  provide: (field) =>
    EditorView.decorations.from(field, (hits) =>
      Decoration.set(
        hits.filter((hit) => hit.to > hit.from).map((hit) => hitMark.range(hit.from, hit.to)),
        true,
      ),
    ),
})
const hitMark = Decoration.mark({ class: 'cm-md-hit' })

/** The places set by `setSearchHits`, mapped through every edit since. */
export function searchHitsOf(state: EditorState): readonly SearchHitRange[] {
  return state.field(hitsField, false) ?? []
}

/** Most matches looked for, and the time the search of the text may take before it gives up. */
const FIND_CAP = 10_000
const FIND_BUDGET_MS = 30
/** The text is read in pieces this long, so the clock can be read between them. */
const FIND_CHUNK = 128 * 1024

/**
 * Where the matches of the state's find query start, in order. Stops at `cap` matches or when
 * `budgetMs` has run out, so a common letter in a 10 MB file costs a bounded time and the ticks
 * show what was found by then.
 */
export function matchPositions(
  state: EditorState,
  options: { readonly cap?: number; readonly budgetMs?: number } = {},
): number[] {
  const query = getSearchQuery(state)
  if (!query.valid) return []
  const cap = options.cap ?? FIND_CAP
  const budget = options.budgetMs ?? FIND_BUDGET_MS
  const started = performance.now()
  const found: number[] = []
  const doc = state.doc
  for (let pos = 0; pos < doc.length;) {
    const end = doc.lineAt(Math.min(pos + FIND_CHUNK, doc.length)).to
    const cursor = query.getCursor(state, pos, end)
    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      const { from, to } = step.value
      if (from === to) continue
      found.push(from)
      if (found.length >= cap) return found
      if ((found.length & 127) === 0 && performance.now() - started > budget) return found
    }
    pos = end
    if (pos < doc.length && performance.now() - started > budget) return found
  }
  return found
}

/** A tick is this many pixels tall, and ticks never sit closer than this. */
export const TICK_STEP = 3

/**
 * The rows (from 0, each `TICK_STEP` pixels of the track) that hold a tick, for places at these
 * fractions of the document's height. Places that share a row share its tick.
 */
export function tickRows(fractions: readonly number[], trackHeight: number): number[] {
  const rows = Math.max(1, Math.floor(trackHeight / TICK_STEP))
  const used = new Set<number>()
  for (const fraction of fractions) {
    if (!Number.isFinite(fraction)) continue
    used.add(Math.min(rows - 1, Math.max(0, Math.floor((fraction * trackHeight) / TICK_STEP))))
  }
  return [...used].sort((a, b) => a - b)
}

const ticksTheme = EditorView.baseTheme({
  '.cm-md-hit': { backgroundColor: 'var(--find-match)', borderRadius: '2px' },
  '.cm-md-ticks': {
    position: 'absolute',
    top: '0',
    bottom: '0',
    right: '0',
    pointerEvents: 'none',
    // Under the scroller, which comes after it: the translucent thumb passes over the ticks.
    zIndex: '0',
  },
  '.cm-md-tick': {
    position: 'absolute',
    right: '2px',
    width: '6px',
    height: `${String(TICK_STEP)}px`,
    borderRadius: '1px',
    backgroundColor: 'var(--find-match-active)',
  },
})

interface Measured {
  readonly rows: readonly number[]
  readonly barWidth: number
}

const ticks = ViewPlugin.fromClass(
  class {
    readonly #view: EditorView
    #overlay: HTMLElement | null = null
    /** Where the find query matches, from the last scan; edits move them until the next one. */
    #found: readonly number[] = []
    #timer: ReturnType<typeof setTimeout> | undefined
    /** A measure queued before a tab switch still runs after it; it must not draw for a gone plugin. */
    #gone = false

    constructor(view: EditorView) {
      this.#view = view
      if (getSearchQuery(view.state).valid) this.#scan(0)
      this.#measure()
    }

    update(update: ViewUpdate): void {
      const query = getSearchQuery(update.state)
      const before = getSearchQuery(update.startState)
      if (!query.eq(before)) {
        if (query.valid) this.#scan(0)
        else this.#drop()
      } else if (update.docChanged && query.valid) {
        this.#found = this.#found.map((at) => update.changes.mapPos(at, 1))
        this.#scan(250)
      }
      if (
        update.docChanged ||
        update.geometryChanged ||
        update.viewportChanged ||
        update.heightChanged ||
        searchHitsOf(update.state) !== searchHitsOf(update.startState)
      ) {
        this.#measure()
      }
    }

    destroy(): void {
      this.#gone = true
      clearTimeout(this.#timer)
      this.#overlay?.remove()
      this.#overlay = null
    }

    /** Looks for the matches on the next turn of the event loop, never inside a dispatch. */
    #scan(delay: number): void {
      clearTimeout(this.#timer)
      this.#timer = setTimeout(() => {
        if (!this.#view.dom.isConnected) return
        this.#found = matchPositions(this.#view.state)
        this.#measure()
      }, delay)
    }

    #drop(): void {
      clearTimeout(this.#timer)
      this.#found = []
      this.#measure()
    }

    #measure(): void {
      this.#view.requestMeasure<Measured | null>({
        key: this,
        read: (view) => {
          const marks = searchHitsOf(view.state).map((hit) => hit.from)
          if (this.#found.length === 0 && marks.length === 0) return null
          const scroller = view.scrollDOM
          const height = scroller.scrollHeight
          const track = scroller.clientHeight
          if (height <= 0 || track <= 0) return { rows: [], barWidth: 0 }
          const length = view.state.doc.length
          const top = view.documentPadding.top
          const fractions: number[] = []
          for (const list of [this.#found, marks]) {
            for (const at of list) {
              const block = view.lineBlockAt(Math.max(0, Math.min(at, length)))
              fractions.push((block.top + top) / height)
            }
          }
          return {
            rows: tickRows(fractions, track),
            barWidth: scroller.offsetWidth - scroller.clientWidth,
          }
        },
        write: (measured, view) => {
          if (this.#gone) return
          if (measured === null || measured.rows.length === 0) {
            this.#overlay?.remove()
            this.#overlay = null
            return
          }
          if (this.#overlay === null) {
            const overlay = document.createElement('div')
            overlay.className = 'cm-md-ticks'
            overlay.setAttribute('aria-hidden', 'true')
            overlay.dataset.scrollTicks = ''
            view.dom.insertBefore(overlay, view.scrollDOM)
            this.#overlay = overlay
          }
          this.#overlay.style.width = `${String(Math.max(measured.barWidth, 10))}px`
          const boxes = measured.rows.map((row) => {
            const tick = document.createElement('div')
            tick.className = 'cm-md-tick'
            tick.style.top = `${String(row * TICK_STEP)}px`
            return tick
          })
          this.#overlay.replaceChildren(...boxes)
        },
      })
    }
  },
)

/** The ticks along the scrollbar for the find query's matches and for the folder search's hits. */
export function matchTicks(): Extension {
  return [hitsField, ticks, ticksTheme]
}
