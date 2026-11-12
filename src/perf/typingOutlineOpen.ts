import type { ScenarioContext, ScenarioOutput } from './params'
import { sleep } from './support'
import { typing, type TypingMode } from './typing'

/** The most heading rows the virtual list may have in the DOM at once. */
const MAX_ROWS_DRAWN = 100

/**
 * How often the scenario edits the open document. The outline waits 400 ms after an edit before it
 * scans, so a 700 ms rhythm puts a scan of the document's unsaved text (the whole 1 MB over IPC,
 * then the answer parsed and drawn) inside the key window several times a second.
 */
const EDIT_EVERY_MS = 700

/**
 * ISC-144's cost: typing with the Outline panel open. It is the `typing-1mb` scenario, unchanged
 * (same document, same caret, same keys, measured the same way), with the real Outline panel
 * mounted beside the editor on the same 1 MB file, opened as a real document, and that document
 * edited every 700 ms. Each edit makes the outline scan the unsaved text, so the work the outline
 * adds while someone types is inside the measurement: the watcher, the debounce, the text sent to
 * Rust, the answer parsed and the rows redrawn.
 *
 * The scenario counts the scans that completed during the keys and fails if none did, or if the
 * panel never drew a row, or if it drew more than 100. The wording was written into
 * `ai-docs/phases/phase-07/decisions.md` before its first run.
 */
export async function typingOutlineOpen(
  ctx: ScenarioContext,
  mode: TypingMode,
): Promise<ScenarioOutput> {
  const perf = ctx.host.perf
  if (perf === undefined) throw new Error('this scenario needs the perf bridge')
  const fixture = ctx.fixture('realistic-1mb.md')
  await perf.grantRoot(fixture.replace(/[\\/][^\\/]*$/, ''))

  // Loaded now, not at the top: the panel is for this scenario only, and the app loads it on first
  // use too (check-arch: outline-lazy).
  const [
    { createApp, h, watch },
    { TooltipProvider },
    { default: OutlinePanel },
    outline,
    docs,
    session,
  ] = await Promise.all([
    import('vue'),
    import('@/components/ui/tooltip'),
    import('@/features/outline/OutlinePanel.vue'),
    import('@/features/outline/store'),
    import('@/documents/store'),
    import('@/documents/session'),
  ])

  // `journal=0` is a second control: no session journal while the keys are typed.
  if (ctx.params.journal === 0) session.stopJournal()
  const tab = await docs.openPath(fixture)
  const follower = docs.followerOfTab(tab)
  if (follower === undefined) throw new Error('the fixture did not open')

  // `outline=0` is the control: the same edits to the same open document, with no panel.
  const panel = ctx.params.outline !== 0
  const column = document.createElement('div')
  column.style.cssText =
    // A flex column, like the sidebar the panel lives in: its root is `flex-1` and needs one.
    'position:fixed;top:0;right:0;bottom:0;width:320px;z-index:5;overflow:hidden;display:flex;flex-direction:column;background:var(--color-sidebar)'
  document.body.append(column)
  const app = createApp({
    render: () => h(TooltipProvider, { delayDuration: 0 }, () => h(OutlinePanel)),
  })
  if (panel) app.mount(column)

  // The first scan is the file by path; wait for it so only edits are measured.
  const deadline = performance.now() + 20_000
  while (panel && outline.outlineState.value.phase !== 'ready' && performance.now() < deadline)
    await sleep(50)
  if (panel && outline.outlineState.value.phase !== 'ready')
    throw new Error('the outline never listed the fixture')
  const headingsListed = outline.outlineState.value.headings.length

  let scansDuringKeys = 0
  let counting = false
  const stopWatching = watch(
    () => outline.outlineState.value,
    (state) => {
      if (counting && state.phase === 'ready') scansDuringKeys += 1
    },
  )

  let running = true
  let edits = 0
  let rowsSeen = 0
  const editing = (async () => {
    while (running) {
      await sleep(EDIT_EVERY_MS)
      if (!running) break
      // At the end of the file: no heading changes, the text does.
      follower.dispatch({ changes: { from: follower.state.doc.length, insert: ' ' } })
      edits += 1
    }
  })()
  const looking = (async () => {
    while (running) {
      rowsSeen = Math.max(rowsSeen, column.querySelectorAll('[data-outline-heading]').length)
      await sleep(200)
    }
  })()

  let journalWrites: number
  let out: ScenarioOutput
  const journalBefore = session.journalStats.writes
  counting = true
  try {
    out = await typing(ctx, mode)
  } finally {
    journalWrites = session.journalStats.writes - journalBefore
    counting = false
    running = false
    await Promise.all([editing, looking])
    stopWatching()
    if (panel) app.unmount()
    column.remove()
  }
  if (panel && rowsSeen === 0)
    throw new Error('the panel never drew a heading row; nothing was measured')
  if (panel && rowsSeen > MAX_ROWS_DRAWN) {
    throw new Error(
      `the panel drew ${String(rowsSeen)} heading rows; it should draw under ${String(MAX_ROWS_DRAWN)}`,
    )
  }
  if (panel && scansDuringKeys === 0) {
    throw new Error('no outline scan finished while the keys were typed; nothing was measured')
  }
  return {
    samples: out.samples,
    values: {
      ...out.values,
      headingsListed,
      editsDuringKeys: edits,
      journalWritesDuringKeys: journalWrites,
      outlineScansDuringKeys: scansDuringKeys,
      headingRowsDrawnMax: rowsSeen,
    },
  }
}
