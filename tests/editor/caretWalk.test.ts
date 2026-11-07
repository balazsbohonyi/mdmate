// @vitest-environment jsdom
/**
 * ISC-59: the caret never sticks inside hidden syntax.
 *
 * Scripted walks drive a real view with the real caret commands, one step at a time, and check two
 * things after every step. The head moved (unless it is at an end of the document), and no
 * selection end lies strictly inside a hidden range. The second is the invariant that makes a
 * stuck caret impossible: every range the layer hides sits inside the span whose touch reveals it,
 * so a caret in or on the edge of an element always shows that element's syntax.
 *
 * Vertical moves need layout, which jsdom does not have; ISC-60 checks them in a browser and in
 * the real window.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  cursorCharLeft,
  cursorCharRight,
  cursorGroupLeft,
  cursorGroupRight,
  selectCharRight,
} from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import { livePreview } from '@/editor/livePreview'
import { scanPreview } from '@/editor/livePreview/scan'

const FIXTURES = join(__dirname, '..', 'fixtures')
const views: EditorView[] = []

beforeAll(() => {
  // jsdom has no layout. CodeMirror asks ranges for their rectangles when it measures.
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

/** The text as the editor holds it: decoded, with every line ending as `\n`. */
function decode(name: string, bytes: Buffer): string {
  let label = 'utf-8'
  if (name.startsWith('utf16le')) label = 'utf-16le'
  else if (name.startsWith('utf16be')) label = 'utf-16be'
  else if (name.startsWith('latin1')) label = 'windows-1252'
  // The UTF-16 files carry a byte order mark, which the decoder strips.
  return new TextDecoder(label).decode(bytes).replace(/\r\n?/g, '\n')
}

/**
 * The walks run without atomic ranges. Atomic ranges make the caret jump over a position that is
 * hidden, which would hide a broken reveal rule; without them the walk tests the rule itself. The
 * last tests then show that adding them changes nothing.
 */
function mount(doc: string, atomic = false): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const state = createState(doc, [livePreview({ atomic })], { preview: false })
  const view = createView(parent, state)
  views.push(view)
  return view
}

/** Fails when any end of any selection range lies strictly inside a range the layer hides. */
function assertNotInsideHidden(view: EditorView, label: string): void {
  for (const range of view.state.selection.ranges) {
    for (const end of new Set([range.anchor, range.head])) {
      const items = scanPreview(view.state, [{ from: end, to: end }])
      for (const item of items) {
        if (item.type === 'hide' && item.from < end && end < item.to) {
          const shown = view.state.doc.sliceString(item.from, item.to)
          throw new Error(
            `${label}: selection end ${String(end)} is inside hidden ${JSON.stringify(shown)} ` +
              `(${String(item.from)}-${String(item.to)})`,
          )
        }
      }
    }
  }
}

type Command = (view: EditorView) => boolean

/** Heads visited by repeating `command` from `start` until the head reaches `end`. */
function walk(
  view: EditorView,
  command: Command,
  start: number,
  end: number,
  label: string,
): number[] {
  view.dispatch({ selection: { anchor: start } })
  const heads = [start]
  const limit = Math.abs(end - start) + 2
  for (let step = 0; step < limit; step++) {
    const before = view.state.selection.main.head
    if (before === end) return heads
    command(view)
    const after = view.state.selection.main.head
    if (after === before)
      throw new Error(`${label}: stuck at ${String(before)} after ${String(step)} steps`)
    expect(
      (after - before) * Math.sign(end - start),
      `${label}: wrong direction at ${String(before)}`,
    ).toBeGreaterThan(0)
    // A walk over positions that were never decorated proves nothing.
    expect(
      view.visibleRanges.some((r) => r.from <= after && after <= r.to),
      `${label}: head ${String(after)} outside the scanned viewport`,
    ).toBe(true)
    assertNotInsideHidden(view, label)
    heads.push(after)
  }
  throw new Error(`${label}: did not reach ${String(end)} within ${String(limit)} steps`)
}

const COMMANDS: { name: string; command: Command; forward: boolean }[] = [
  { name: 'char right', command: cursorCharRight, forward: true },
  { name: 'char left', command: cursorCharLeft, forward: false },
  { name: 'word right', command: cursorGroupRight, forward: true },
  { name: 'word left', command: cursorGroupLeft, forward: false },
]

function walkAll(doc: string, label: string, atomic = false): void {
  const view = mount(doc, atomic)
  for (const { name, command, forward } of COMMANDS) {
    walk(view, command, forward ? 0 : doc.length, forward ? doc.length : 0, `${label} ${name}`)
  }
  // Extending a selection moves only the head; the anchor stays where it was.
  view.dispatch({ selection: { anchor: 0 } })
  for (let step = 0; step <= doc.length; step++) {
    const before = view.state.selection.main.head
    if (before === doc.length) break
    selectCharRight(view)
    expect(
      view.state.selection.main.head,
      `${label} select right at ${String(before)}`,
    ).toBeGreaterThan(before)
    expect(view.state.selection.main.anchor).toBe(0)
    assertNotInsideHidden(view, `${label} select right`)
  }
}

/** A repeatable pick of windows: whole lines from a paragraph start, about `size` characters each. */
function windows(doc: string, count: number, size: number, seed: number): string[] {
  const all = doc.split('\n')
  let state = seed
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    let from = Math.floor(next() * Math.max(1, all.length - 40))
    while (from > 0 && all[from - 1] !== '') from--
    let text = ''
    for (let n = from; n < all.length && text.length < size; n++) text += `${all[n] ?? ''}\n`
    out.push(text)
  }
  return out
}

const small = readdirSync(FIXTURES).filter((name) => name.endsWith('.md'))
const large = readdirSync(join(FIXTURES, 'generated')).filter((name) => name.endsWith('.md'))

describe('caret walks never stick', () => {
  it.each(small)('walks every position of %s', { timeout: 60_000 }, (name) => {
    walkAll(decode(name, readFileSync(join(FIXTURES, name))), name)
  })

  // The generated files are 1 to 10 MB, far too many positions to walk one by one. Seeded windows
  // of whole lines from across each file stand in for them. The layer works from the viewport,
  // so a window shows it the same text the whole file would.
  it.each(large)('walks seeded windows of %s', { timeout: 60_000 }, (name) => {
    const text = decode(name, readFileSync(join(FIXTURES, 'generated', name)))
    for (const [n, window] of windows(text, 2, 4000, 1234 + name.length).entries()) {
      walkAll(window, `${name} window ${String(n)}`)
    }
  })

  // The fixtures hold most element kinds but not the odd shapes (an empty link, a bare `>`, a rule
  // spelled `- - -`, a quote around a heading), so this document is all of them in one place.
  it('walks a document of every element and edge case, with and without atomic ranges', () => {
    walkAll(EDGE_CASES, 'edge cases')
    walkAll(EDGE_CASES, 'edge cases (atomic)', true)
  })
})

const EDGE_CASES = [
  '# Heading ##',
  '',
  'Setext heading',
  '==============',
  '',
  'Some *em*, **strong**, ~~strike~~, `code`, ``a ` b``, ***both***, **bold *and* nested**.',
  '',
  '[link](http://x.com "title") [ref][r] [short] [](http://empty.com) <http://auto.com> http://bare.com',
  '[a **bold** link](http://x.com "a long',
  'title") ![image](img.png)',
  '',
  '- item **bold**',
  '  - nested',
  '1. one',
  '2) two',
  '- [ ] task',
  '',
  '> quote',
  '> > nested',
  '>',
  '> more',
  'lazy line',
  '',
  '> # quoted heading',
  '> - quoted item',
  '',
  '---',
  '***',
  '- - -',
  '_ _ _',
  '',
  '#',
  '##  spaced  ',
  '#hashtag',
  '',
  '[r]: http://r.com',
  '',
].join('\n')

describe('atomic ranges', () => {
  it('change no caret position today', () => {
    for (const name of ['lf.md', 'hostile.md']) {
      const doc = decode(name, readFileSync(join(FIXTURES, name)))
      const withAtomic = walk(mount(doc, true), cursorCharRight, 0, doc.length, name)
      const without = walk(mount(doc, false), cursorCharRight, 0, doc.length, name)
      expect(withAtomic).toEqual(without)
    }
  })
})
