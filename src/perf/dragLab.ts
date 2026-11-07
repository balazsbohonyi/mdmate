import { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import { setDropCaret, textDrag } from '@/editor/textDrag'
import type { PerfDragDrop, PerfHost } from '@/platform'
import { el } from './lab'
import type { ScenarioContext, ScenarioOutput } from './params'
import { snapshotEnv } from './support'

/**
 * P5-T7 spike, in the real WebView2 with native file drops on.
 *
 * `drag-auto` runs the cases with trusted mouse and key events that the harness sends through the
 * DevTools port: the page hands out a plan for each case, the harness plays it, and the page checks
 * the result. It includes a control, CodeMirror's own drag without the extension, to show the same
 * input reproduces the failure P0-T9 found by hand.
 *
 * `lab-drag` is the one short sitting for a person: everything the harness cannot send, in one
 * numbered list. Nothing here ships: it loads only in a perf build.
 */

const LINES = 60
const line = (n: number) =>
  `line ${String(n).padStart(2, '0')}: the quick brown fox jumps over the lazy dog`
const DOC = Array.from({ length: LINES }, (_, i) => line(i + 1)).join('\n')

type Action =
  | { t: 'down' | 'move' | 'hover' | 'up'; x: number; y: number }
  | { t: 'key'; key: string; code: string; vk: number; modifiers?: number }
  | { t: 'wait'; ms: number }

interface Point {
  x: number
  y: number
}
interface Verdict {
  pass: boolean
  detail: string
}

const frame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()))

/** Everything the page can see about a drag, for the cases to check. */
interface Probe {
  /** The last place the drop caret was put, null once it is cleared. */
  caretNow: number | null
  /** The last non-null place, kept after the caret clears so a case can compare it with the landing. */
  lastCaret: number | null
  moves: number
  native: { dragstart: number; dragenter: number; dragover: number; drop: number }
}

function newProbe(): Probe {
  return {
    caretNow: null,
    lastCaret: null,
    moves: 0,
    native: { dragstart: 0, dragenter: 0, dragover: 0, drop: 0 },
  }
}

/** The editor box, its probe, and the counters for the browser's own drag events. */
function mountEditor(root: HTMLElement, box: HTMLElement) {
  const probe = newProbe()
  const recorder = EditorView.updateListener.of((update) => {
    for (const tr of update.transactions) {
      if (tr.isUserEvent('move.drop')) probe.moves++
      for (const effect of tr.effects) {
        if (!effect.is(setDropCaret)) continue
        probe.caretNow = effect.value
        if (effect.value !== null) probe.lastCaret = effect.value
      }
    }
  })
  const stateFor = (withDrag: boolean) =>
    createState(DOC, [withDrag ? textDrag() : [], recorder], { parser: true })
  const view = createView(box, stateFor(true))
  for (const type of ['dragstart', 'dragenter', 'dragover', 'drop'] as const) {
    document.addEventListener(type, () => void probe.native[type]++, true)
  }
  root.append(box)
  return {
    view,
    probe,
    /** A fresh document, history, scroll position and counters. */
    reset: async (withDrag = true): Promise<void> => {
      view.setState(stateFor(withDrag))
      view.scrollDOM.scrollTop = 0
      view.focus()
      probe.caretNow = null
      probe.lastCaret = null
      probe.moves = 0
      probe.native = { dragstart: 0, dragenter: 0, dragover: 0, drop: 0 }
      view.requestMeasure()
      await frame()
      await frame()
    },
  }
}

const BOX_CSS =
  'position:absolute;left:24px;top:48px;width:600px;height:168px;border:1px solid var(--border);'

// --- drag-auto -----------------------------------------------------------------------------------

export async function dragAuto(): Promise<ScenarioOutput> {
  const root = el(
    'div',
    'position:fixed;inset:0;z-index:20;background:var(--background);color:var(--foreground);' +
      'font:13px/1.4 system-ui,sans-serif;overflow:hidden;',
  )
  document.body.append(root)
  root.append(
    el('div', 'position:absolute;left:24px;top:16px;', 'drag-auto: do not touch the mouse'),
  )
  root.append(
    el(
      'div',
      'position:absolute;left:24px;top:232px;width:600px;height:56px;border:1px dashed var(--border);' +
        'display:flex;align-items:center;justify-content:center;',
      'outside the editor',
    ),
  )
  const { view, probe, reset } = mountEditor(root, el('div', BOX_CSS))

  const wordAt = (n: number, word: string) => {
    const l = view.state.doc.line(n)
    const i = l.text.indexOf(word)
    if (i < 0) throw new Error(`no "${word}" on line ${String(n)}`)
    return { from: l.from + i, to: l.from + i + word.length }
  }
  const coords = (pos: number, side: -1 | 1) => {
    const c = view.coordsAtPos(pos, side)
    if (!c) throw new Error(`no coordinates for position ${String(pos)}`)
    return c
  }
  const middleOf = (from: number, to: number): Point => {
    const a = coords(from, 1)
    const b = coords(to, -1)
    return { x: (a.left + b.right) / 2, y: (a.top + a.bottom) / 2 }
  }
  const boundary = (pos: number): Point => {
    const c = coords(pos, 1)
    return { x: c.left, y: (c.top + c.bottom) / 2 }
  }
  const path = (a: Point, b: Point, steps = 8): Action[] =>
    Array.from({ length: steps }, (_, i): Action[] => {
      const f = (i + 1) / steps
      return [
        { t: 'move', x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f },
        { t: 'wait', ms: 16 },
      ]
    }).flat()
  const drag = (press: Point, drop: Point, between: Action[] = []): Action[] => [
    { t: 'down', ...press },
    { t: 'wait', ms: 30 },
    ...path(press, drop),
    { t: 'wait', ms: 40 },
    ...between,
    { t: 'up', ...drop },
  ]

  const verdict = (problems: string[], extra = ''): Verdict => ({
    pass: problems.length === 0,
    detail: [...problems, extra].filter(Boolean).join('; ') || 'ok',
  })
  const stuck = () => view.dom.classList.contains('cm-text-dragging')
  const unchanged = (sel: { from: number; to: number }): string[] => {
    const now = view.state.selection.main
    const problems: string[] = []
    if (view.state.doc.toString() !== DOC) problems.push('the text changed')
    if (now.from !== sel.from || now.to !== sel.to) problems.push('the selection changed')
    if (probe.moves !== 0) problems.push(`${String(probe.moves)} moves`)
    if (probe.caretNow !== null) problems.push('the drop caret was left showing')
    if (stuck()) problems.push('the drag state is stuck')
    return problems
  }
  const select = (range: { from: number; to: number }): void => {
    view.dispatch({ selection: { anchor: range.from, head: range.to } })
  }
  /** A cancelled drag only means something if the drag really started first. */
  const started = (): string[] =>
    probe.lastCaret === null ? ['the drag never started (no drop caret was shown)'] : []
  const nativeNote = () => `native events ${JSON.stringify(probe.native)}`

  /** What a move of [from,to] to `at` must do, worked out with plain string arithmetic. */
  const checkMove = (from: number, to: number, at: number): Verdict => {
    const moved = DOC.slice(from, to)
    const expected =
      at > to
        ? DOC.slice(0, from) + DOC.slice(to, at) + moved + DOC.slice(at)
        : DOC.slice(0, at) + moved + DOC.slice(at, from) + DOC.slice(to)
    const sel = view.state.selection.main
    const landed = at > to ? sel.to : sel.from
    const problems: string[] = []
    if (view.state.doc.toString() !== expected) problems.push('the text is not the expected move')
    if (view.state.sliceDoc(sel.from, sel.to) !== moved)
      problems.push('the moved text is not selected')
    if (probe.moves !== 1) problems.push(`${String(probe.moves)} moves, expected 1`)
    if (probe.lastCaret !== landed) {
      problems.push(
        `caret showed ${String(probe.lastCaret)} but the text landed at ${String(landed)}`,
      )
    }
    if (probe.caretNow !== null) problems.push('the drop caret was left showing')
    if (stuck()) problems.push('the drag state is stuck')
    if (probe.native.dragstart > 0) problems.push('the browser started its own drag')
    return verdict(problems, nativeNote())
  }

  interface Case {
    setup: () => Promise<void>
    plan: () => Action[]
    check: () => Verdict
  }
  const cases: Record<string, Case> = {}
  const state = { from: 0, to: 0, at: 0 }

  /** A drag of one word, or a span, to a boundary: the common shape of the move cases. */
  function moveCase(
    pick: () => { from: number; to: number },
    target: () => number,
    pressWidth?: number,
  ): Case {
    return {
      async setup() {
        await reset(true)
        const sel = pick()
        state.from = sel.from
        state.to = sel.to
        state.at = target()
        select(sel)
      },
      plan() {
        const press = middleOf(state.from, pressWidth ? state.from + pressWidth : state.to)
        return drag(press, boundary(state.at))
      },
      check: () => checkMove(state.from, state.to, state.at),
    }
  }
  const fox = (n: number) => wordAt(n, 'fox')

  cases['forward-same-line'] = moveCase(
    () => wordAt(2, 'quick'),
    () => wordAt(2, 'dog').from,
  )
  cases['backward-across-lines'] = moveCase(
    () => wordAt(5, 'jumps'),
    () => wordAt(2, 'brown').from,
  )
  cases['spans-line-breaks'] = moveCase(
    () => ({ from: fox(3).from, to: wordAt(4, 'over').from }),
    () => wordAt(6, 'lazy').from,
    3,
  )
  cases['drop-inside-selection'] = {
    async setup() {
      await reset(true)
      const a = wordAt(2, 'quick')
      const b = wordAt(2, 'brown')
      state.from = a.from
      state.to = b.to
      select({ from: a.from, to: b.to })
    },
    plan: () => drag(middleOf(state.from, state.from + 5), middleOf(state.from + 6, state.to)),
    check: () => verdict(unchanged(state), nativeNote()),
  }
  cases['click-in-selection'] = {
    async setup() {
      await reset(true)
      const a = wordAt(2, 'quick')
      state.from = a.from
      state.to = a.to
      select(a)
    },
    plan() {
      const p = middleOf(state.from, state.to)
      return [
        { t: 'down', ...p },
        { t: 'wait', ms: 30 },
        { t: 'up', ...p },
      ]
    },
    check() {
      const now = view.state.selection.main
      const problems: string[] = []
      if (!now.empty) problems.push('the selection did not collapse to a caret')
      if (now.from < state.from || now.from > state.to)
        problems.push('the caret is outside the old selection')
      if (view.state.doc.toString() !== DOC) problems.push('the text changed')
      if (probe.moves !== 0) problems.push('it moved text')
      return verdict(problems, nativeNote())
    },
  }
  cases['escape-cancels'] = {
    async setup() {
      await reset(true)
      const a = wordAt(2, 'quick')
      state.from = a.from
      state.to = a.to
      select(a)
    },
    plan() {
      const press = middleOf(state.from, state.to)
      const there = boundary(wordAt(2, 'dog').from)
      const escape: Action = { t: 'key', key: 'Escape', code: 'Escape', vk: 27 }
      return [
        { t: 'down', ...press },
        { t: 'wait', ms: 30 },
        ...path(press, there),
        { t: 'wait', ms: 40 },
        escape,
        { t: 'wait', ms: 40 },
        ...path(there, { x: there.x - 40, y: there.y }, 3),
        { t: 'up', x: there.x - 40, y: there.y },
      ]
    },
    check: () => verdict([...unchanged(state), ...started()], nativeNote()),
  }
  cases['release-outside-editor'] = {
    async setup() {
      await reset(true)
      const a = wordAt(2, 'quick')
      state.from = a.from
      state.to = a.to
      select(a)
    },
    plan() {
      const press = middleOf(state.from, state.to)
      const box = view.scrollDOM.getBoundingClientRect()
      return drag(press, { x: press.x, y: box.bottom + 40 })
    },
    check: () => verdict([...unchanged(state), ...started()], nativeNote()),
  }
  cases['lost-mouse-up'] = {
    async setup() {
      await reset(true)
      const a = wordAt(2, 'quick')
      state.from = a.from
      state.to = a.to
      select(a)
    },
    plan() {
      // The button comes up where the page cannot see it: a move arrives with no button held.
      const press = middleOf(state.from, state.to)
      const there = boundary(wordAt(2, 'dog').from)
      return [
        { t: 'down', ...press },
        { t: 'wait', ms: 30 },
        ...path(press, there),
        { t: 'wait', ms: 40 },
        { t: 'hover', ...there },
        { t: 'wait', ms: 60 },
        { t: 'hover', ...boundary(wordAt(3, 'lazy').from) },
        { t: 'wait', ms: 60 },
        { t: 'up', ...there },
      ]
    },
    check: () => verdict([...unchanged(state), ...started()], nativeNote()),
  }
  cases['autoscroll-to-bottom-edge'] = {
    async setup() {
      await reset(true)
      const a = wordAt(2, 'quick')
      state.from = a.from
      state.to = a.to
      select(a)
    },
    plan() {
      const press = middleOf(state.from, state.to)
      const box = view.scrollDOM.getBoundingClientRect()
      const edge = { x: press.x, y: box.bottom - 8 }
      return drag(press, edge, [{ t: 'wait', ms: 900 }])
    },
    check() {
      const sel = view.state.selection.main
      const problems: string[] = []
      if (view.scrollDOM.scrollTop <= 0) problems.push('the editor did not scroll')
      if (probe.moves !== 1) problems.push(`${String(probe.moves)} moves, expected 1`)
      if (view.state.doc.length !== DOC.length) problems.push('characters were lost or added')
      if (view.state.sliceDoc(sel.from, sel.to) !== 'quick')
        problems.push('the moved text is not selected')
      if (probe.lastCaret !== sel.to) problems.push('the text did not land where the caret was')
      const lineNumber = view.state.doc.lineAt(sel.from).number
      if (lineNumber < 10) problems.push(`it landed on line ${String(lineNumber)}, not far down`)
      if (probe.caretNow !== null) problems.push('the drop caret was left showing')
      return verdict(
        problems,
        `scrollTop ${view.scrollDOM.scrollTop.toFixed(0)}, landed on line ${String(lineNumber)}`,
      )
    },
  }
  const forwardMove = moveCase(
    () => wordAt(2, 'quick'),
    () => wordAt(2, 'dog').from,
  )
  cases['undo-is-one-step'] = {
    setup: forwardMove.setup,
    plan: () => [
      ...forwardMove.plan(),
      { t: 'wait', ms: 80 },
      { t: 'key', key: 'z', code: 'KeyZ', vk: 90, modifiers: 2 },
    ],
    check() {
      const sel = view.state.selection.main
      const problems: string[] = []
      if (view.state.doc.toString() !== DOC) problems.push('one Ctrl+Z did not restore the text')
      if (probe.moves !== 1) problems.push(`${String(probe.moves)} moves, expected 1`)
      if (sel.from !== state.from || sel.to !== state.to)
        problems.push('the old selection did not come back')
      return verdict(problems, nativeNote())
    },
  }
  cases['control-native-drag'] = {
    async setup() {
      await reset(false)
      const a = wordAt(2, 'quick')
      state.from = a.from
      state.to = a.to
      state.at = wordAt(2, 'dog').from
      select(a)
    },
    plan: () => drag(middleOf(state.from, state.to), boundary(state.at)),
    check() {
      // Informational. CodeMirror's own drag, same input, no extension. If it fails the way the
      // by-hand test did, this input stands in for a real mouse; if it works, it does not.
      const moved = view.state.doc.toString() !== DOC
      return {
        pass: true,
        detail: `without the extension the text ${moved ? 'MOVED' : 'did not move'}; ${nativeNote()}`,
      }
    },
  }

  const names = Object.keys(cases)
  const results: Record<string, Verdict> = {}
  let finish: () => void = () => undefined
  const finished = new Promise<void>((done) => {
    finish = done
  })
  const find = (name: string): Case => {
    const found = cases[name]
    if (!found) throw new Error(`unknown case ${name}`)
    return found
  }
  Reflect.set(window, '__dragLab', {
    names: () => names,
    async prepare(name: string): Promise<Action[]> {
      const c = find(name)
      await c.setup()
      return c.plan()
    },
    async check(name: string): Promise<void> {
      await frame()
      await frame()
      results[name] = find(name).check()
    },
    finish: () => void finish(),
  })
  Reflect.set(window, '__dragReady', true)

  await Promise.race([
    finished,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('the harness never finished the drag cases')), 150_000),
    ),
  ])
  view.destroy()

  const values: Record<string, number> = {}
  let passed = 0
  for (const name of names) {
    const pass = results[name]?.pass === true
    values[name] = pass ? 1 : 0
    if (pass) passed++
  }
  values.passed = passed
  values.failed = names.length - passed
  const env = snapshotEnv()
  return {
    samples: {},
    values,
    notes: {
      devicePixelRatio: env.devicePixelRatio,
      results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.detail])),
    },
  }
}

// --- lab-drag ------------------------------------------------------------------------------------

type Answer = 'yes' | 'no' | 'unanswered'

const STEPS: readonly (readonly [string, string])[] = [
  [
    'sameLine',
    'Select a word (double-click it). Press on it, drag it a few words along the same line and let go. Did it move?',
  ],
  [
    'caret',
    'While you dragged, did a thin caret show where the text would land, and follow the pointer?',
  ],
  ['otherLine', 'Select another word and drag it to a different line. Did it move there?'],
  ['undo', 'Press Ctrl+Z once. Did that one press undo the whole move?'],
  [
    'multiLine',
    'Select text across two lines (drag over it, or Shift+Down) and drag it up or down a few lines. Did the whole span move intact?',
  ],
  [
    'autoscroll',
    'Drag a selected word to the very bottom edge of the editor box and hold the button for a second. Did the box scroll, and when you let go did the text land where the caret was?',
  ],
  ['escape', 'Start a drag and press Esc while holding the button, then let go. Did nothing move?'],
  [
    'outsideBox',
    'Start a drag and let go over the dashed "outside the editor" area. Did nothing move?',
  ],
  [
    'outsideWindow',
    'Start a drag, move the pointer out of the whole app window and let go there. Back inside the window, move the mouse WITHOUT pressing. Is the drag gone (no caret following)?',
  ],
  [
    'clickCollapses',
    'Select a word, then click once on it without moving. Did the selection collapse to a caret at the click?',
  ],
  [
    'fileDrop',
    'Drag a file from Explorer onto the "file drop zone" box. Did the counter under it go up?',
  ],
  ['smooth', 'Overall, did dragging feel smooth, with no lag, flicker or jumpiness?'],
]

export function dragByHand(ctx: ScenarioContext): Promise<ScenarioOutput> {
  const perf: PerfHost | undefined = ctx.host.perf
  if (!perf) throw new Error('this scenario needs the perf bridge')

  const root = el(
    'div',
    'position:fixed;inset:0;z-index:20;background:var(--background);color:var(--foreground);' +
      'font:13px/1.4 system-ui,sans-serif;overflow:hidden;',
  )
  document.body.append(root)
  root.append(
    el('div', 'position:absolute;left:24px;top:16px;font-weight:600;', 'Drag-to-move lab'),
  )
  root.append(
    el(
      'div',
      'position:absolute;left:24px;top:232px;width:600px;height:56px;border:1px dashed var(--border);' +
        'display:flex;align-items:center;justify-content:center;',
      'outside the editor',
    ),
  )
  const fileZone = el(
    'div',
    'position:absolute;left:24px;top:304px;width:600px;height:72px;border:2px dashed var(--foreground);' +
      'background:var(--muted);display:flex;align-items:center;justify-content:center;',
    'file drop zone',
  )
  fileZone.dataset.labBox = 'zone'
  root.append(fileZone)
  const { view, probe, reset } = mountEditor(root, el('div', BOX_CSS))
  void reset(true)

  // --- file drops: the native path must still work with the drag extension on --------------------
  const fileEvents: Record<string, unknown>[] = []
  let overs = 0
  const stop = perf.onDragDrop((event: PerfDragDrop) => {
    if (event.type === 'over') overs++
    else fileEvents.push({ type: event.type, paths: event.paths?.length })
  })
  const status = el(
    'div',
    'position:absolute;left:24px;top:388px;width:600px;font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;',
  )
  const refresh = () => {
    const drops = fileEvents.filter((e) => e.type === 'drop').length
    status.textContent =
      `file drops: ${String(drops)}   (over events: ${String(overs)})\n` +
      `moves: ${String(probe.moves)}   caret: ${String(probe.caretNow)}   ` +
      `browser drag events: ${JSON.stringify(probe.native)}`
  }
  const timer = setInterval(refresh, 250)
  root.append(status)

  // --- the one numbered list -------------------------------------------------------------------
  const answers: Record<string, Answer> = {}
  const column = el(
    'div',
    'position:absolute;left:660px;top:16px;right:16px;bottom:16px;overflow:auto;padding-right:6px;',
  )
  column.append(
    el(
      'div',
      'font-weight:600;margin-bottom:6px;',
      'Answer yes or no to each step, in order. Then press Finish.',
    ),
  )
  STEPS.forEach(([id, text], index) => {
    answers[id] = 'unanswered'
    const row = el('div', 'margin:8px 0;')
    row.append(el('div', '', `${String(index + 1)}. ${text}`))
    const buttons = el('div', 'display:flex;gap:6px;margin-top:3px;')
    const made = (['yes', 'no'] as const).map((choice) => {
      const button = el(
        'button',
        'padding:2px 14px;border:1px solid var(--border);background:var(--background);color:inherit;',
        choice,
      )
      button.addEventListener('click', () => {
        answers[id] = choice
        for (const other of made) {
          other.style.background = 'var(--background)'
          other.style.color = 'inherit'
        }
        button.style.background = 'var(--primary)'
        button.style.color = 'var(--primary-foreground)'
      })
      return button
    })
    buttons.append(...made)
    row.append(buttons)
    column.append(row)
  })
  const notes = el(
    'textarea',
    'width:100%;height:70px;margin-top:8px;background:var(--background);color:inherit;border:1px solid var(--border);',
  )
  notes.placeholder = 'Anything odd? (optional)'
  const finish = el(
    'button',
    'margin:8px 0 4px;padding:6px 18px;border:1px solid var(--border);background:var(--primary);color:var(--primary-foreground);',
    'Finish and save',
  )
  column.append(notes, finish)
  root.append(column)

  return new Promise((resolve) => {
    finish.addEventListener('click', () => {
      clearInterval(timer)
      void stop.then((unlisten) => unlisten())
      const env = snapshotEnv()
      const values: Record<string, number> = {}
      for (const [id, answer] of Object.entries(answers)) {
        values[id] = answer === 'yes' ? 1 : answer === 'no' ? 0 : -1
      }
      resolve({
        samples: {},
        values,
        notes: {
          devicePixelRatio: env.devicePixelRatio,
          answers,
          freeText: notes.value,
          moves: probe.moves,
          browserDragEvents: probe.native,
          fileEvents,
          docChanged: view.state.doc.toString() !== DOC,
        },
      })
    })
  })
}
