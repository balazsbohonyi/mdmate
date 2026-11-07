import { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import type { PerfDragDrop, PerfHost } from '@/platform'
import type { ScenarioContext, ScenarioOutput } from './params'
import { snapshotEnv } from './support'

/**
 * P0 lab, by hand: the questions that need a person at the keyboard and mouse.
 *
 * - Does CodeMirror's own text drag work while the window accepts native file drops?
 * - Are Tauri's drop positions physical pixels?
 * - Do Windows 11 snap layouts, Win+Z and edge snapping work on this undecorated window?
 *
 * The page records what it can see and asks yes/no for what only a person can. "Finish" saves it
 * all through the perf bridge, which quits the app. Nothing here ships: it loads only in a perf
 * build.
 */
const SENTENCE = 'Select the word DRAG with the mouse, then drag it to the end of this line.'

type Answer = 'yes' | 'no' | 'unanswered'

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.style.cssText = css
  node.textContent = text
  return node
}

const BOX_CSS =
  'position:absolute;width:220px;height:80px;display:flex;align-items:center;justify-content:center;' +
  'border:2px dashed var(--foreground);background:var(--muted);font-size:13px;'

export function labByHand(ctx: ScenarioContext): Promise<ScenarioOutput> {
  const perf: PerfHost | undefined = ctx.host.perf
  if (!perf) throw new Error('this scenario needs the perf bridge')

  const root = el(
    'div',
    'position:fixed;inset:0;z-index:20;background:var(--background);color:var(--foreground);' +
      'font:13px/1.4 system-ui,sans-serif;overflow:hidden;',
  )
  document.body.append(root)

  // --- title bar: the snap-layout and edge-snap tests -------------------------------------
  const bar = el('div', 'display:flex;height:36px;border-bottom:1px solid var(--border);')
  const grip = el(
    'div',
    'flex:1;display:flex;align-items:center;padding-left:12px;user-select:none;',
    'mdmate lab — drag this bar',
  )
  const maximize = el(
    'button',
    'width:46px;border:0;background:transparent;color:inherit;font-size:14px;',
    '▢',
  )
  maximize.title = 'maximize'
  maximize.addEventListener('click', () => void perf.toggleMaximize())
  grip.addEventListener('mousedown', (event) => {
    if (event.buttons === 1) void perf.startDragging()
  })
  bar.append(grip, maximize)

  // --- yes/no questions -------------------------------------------------------------------
  const answers: Record<string, Answer> = {}
  function ask(id: string, question: string): HTMLElement {
    answers[id] = 'unanswered'
    const row = el('div', 'display:flex;gap:8px;align-items:center;margin:4px 0;')
    row.append(el('span', 'flex:1;', question))
    const buttons = (['yes', 'no'] as const).map((choice) => {
      const button = el(
        'button',
        'padding:2px 10px;border:1px solid var(--border);background:var(--background);color:inherit;',
        choice,
      )
      button.addEventListener('click', () => {
        answers[id] = choice
        for (const other of buttons) other.style.background = 'var(--background)'
        button.style.background = 'var(--primary)'
        button.style.color = 'var(--primary-foreground)'
      })
      return button
    })
    row.append(...buttons)
    return row
  }

  // --- step 1: text drag ------------------------------------------------------------------
  const counts = { dragstart: 0, dragover: 0, drop: 0, docDragenter: 0, docDrop: 0 }
  const editorBox = el('div', 'border:1px solid var(--border);margin:4px 0;height:48px;')
  const view = createView(
    editorBox,
    createState(SENTENCE, [
      EditorView.domEventHandlers({
        dragstart: () => void counts.dragstart++,
        dragover: () => void counts.dragover++,
        drop: () => void counts.drop++,
      }),
    ]),
  )
  document.addEventListener('dragenter', () => void counts.docDragenter++, true)
  document.addEventListener('drop', () => void counts.docDrop++, true)

  // --- step 2: file drops -----------------------------------------------------------------
  const boxA = el('div', `${BOX_CSS}left:16px;top:230px;`, 'A: drop a file here')
  boxA.dataset.labBox = 'A'
  const boxB = el('div', `${BOX_CSS}right:16px;bottom:16px;`, 'B: drop a file here')
  boxB.dataset.labBox = 'B'
  const status = el(
    'div',
    'font:11px/1.4 ui-monospace,Consolas,monospace;white-space:pre-wrap;margin-top:6px;height:84px;overflow:hidden;',
  )

  const drops: Record<string, unknown>[] = []
  const hit = (x: number, y: number) => {
    const found = document.elementFromPoint(x, y)
    return found?.closest<HTMLElement>('[data-lab-box]')?.dataset.labBox ?? found?.tagName ?? 'none'
  }
  let overs = 0
  let lastOver: PerfDragDrop['position']
  const stop = perf.onDragDrop((event) => {
    const dpr = window.devicePixelRatio
    if (event.type === 'over') {
      overs++
      lastOver = event.position
    } else if (event.type === 'drop' || event.type === 'enter') {
      const at = event.position
      drops.push({
        type: event.type,
        x: at?.x,
        y: at?.y,
        paths: event.paths?.length,
        hitIfPhysical: at ? hit(at.x / dpr, at.y / dpr) : 'n/a',
        hitIfLogical: at ? hit(at.x, at.y) : 'n/a',
        dprAtTheTime: dpr,
      })
    }
    status.textContent = `file events: ${String(overs)} over, ${String(drops.length)} enter/drop. last: ${JSON.stringify(drops.at(-1) ?? lastOver ?? {})}`
  })

  // --- layout -----------------------------------------------------------------------------
  const body = el('div', 'padding:12px 16px;')
  body.append(
    el('div', 'font-weight:600;margin-top:2px;', 'Step 1 — text drag'),
    el(
      'div',
      '',
      'Select the word DRAG, press on the selection and drag it to the end of the line, then release.',
    ),
    editorBox,
    ask('textMoved', 'Did the selected text move?'),
    el('div', 'font-weight:600;margin-top:12px;', 'Step 2 — file drops'),
    el(
      'div',
      '',
      'Drag one file from Explorer onto box A (left), then one onto box B (bottom right).',
    ),
    el('div', `margin-top:92px;`),
    status,
    el(
      'div',
      'font-weight:600;margin-top:12px;',
      'Step 3 — snapping (this window has no system title bar)',
    ),
    ask(
      'hoverFlyout',
      'Hover the ▢ button (top right) for 2 seconds. Did the snap layouts flyout appear?',
    ),
    ask('winZ', 'Press Win+Z with this window focused. Did the snap layouts flyout appear?'),
    ask('dragTopEdge', 'Drag the title bar to the very top edge. Did it preview a maximize?'),
    ask('dragLeftEdge', 'Drag the title bar to the left edge. Did it preview a left-half snap?'),
  )

  const finish = el(
    'button',
    'position:absolute;right:16px;bottom:110px;padding:6px 18px;border:1px solid var(--border);background:var(--primary);color:var(--primary-foreground);',
    'Finish and save',
  )
  root.append(bar, body, boxA, boxB, finish)

  return new Promise((resolve) => {
    finish.addEventListener('click', () => {
      void stop.then((unlisten) => unlisten())
      const env = snapshotEnv()
      const notes = {
        devicePixelRatio: env.devicePixelRatio,
        viewport: { width: env.innerWidth, height: env.innerHeight },
        textDrag: { before: SENTENCE, after: view.state.doc.toString(), counts },
        fileDrops: { overEvents: overs, lastOver, events: drops },
        answers,
      }
      resolve({ samples: {}, values: {}, notes })
    })
  })
}
