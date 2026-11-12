import type { ScenarioContext, ScenarioOutput } from './params'
import { sleep } from './support'
import { typing, type TypingMode } from './typing'

/** The plain text the searches look for: spread through the whole workspace. */
const QUERY = 'target.md'

/** The most result rows the virtual list may have in the DOM at once. */
const MAX_ROWS_DRAWN = 100

/**
 * ISC-138: typing while a folder search runs over a large workspace. It is the `typing-1mb`
 * scenario, unchanged (same document, same caret, same keys, measured the same way), with a real
 * folder search running the whole time: when one search ends the next starts at once, so every key,
 * warm-up keys included, is typed while Rust reads the workspace and the page takes batches.
 *
 * The page's own work is inside the measurement. The real Search panel is mounted beside the
 * editor and the searches go through the real search store, so batches are parsed, kept, and drawn
 * as rows while the keys land. The scenario samples the result rows in the DOM and fails if it
 * never sees one.
 *
 * The workspace is `tests/fixtures/generated/workspace-large` (8,001 notes, about 825 linking to
 * `target.md`), the one `typing-during-scan` uses. The wording of the scenario was written into
 * `ai-docs/phases/phase-07/decisions.md` before its first run.
 */
export async function typingDuringSearch(
  ctx: ScenarioContext,
  mode: TypingMode,
): Promise<ScenarioOutput> {
  const perf = ctx.host.perf
  if (perf === undefined) throw new Error('this scenario needs the perf bridge')
  const root = ctx.fixture('workspace-large')
  await perf.grantRoot(root)

  // Loaded now, not at the top: the panel and its store are for this scenario only, and the app
  // loads them on first use too (check-arch: search-lazy).
  const [{ createApp, h }, { TooltipProvider }, { default: SearchPanel }, search, tree] =
    await Promise.all([
      import('vue'),
      import('@/components/ui/tooltip'),
      import('@/features/search/SearchPanel.vue'),
      import('@/features/search/store'),
      import('@/features/tree/store'),
    ])
  // The page's workspace takes the root Rust now holds, which is what the search asks for.
  await tree.restoreWorkspace([])
  if (tree.workspaceRoots.value.length === 0) throw new Error('the workspace has no root')

  const column = document.createElement('div')
  column.style.cssText =
    // A flex column, like the sidebar the panel lives in: its root is `flex-1` and needs one, or the
    // list grows to the height of its content and draws every result.
    'position:fixed;top:0;right:0;bottom:0;width:320px;z-index:5;overflow:hidden;display:flex;flex-direction:column;background:var(--color-sidebar)'
  document.body.append(column)
  const app = createApp({
    render: () => h(TooltipProvider, { delayDuration: 0 }, () => h(SearchPanel)),
  })
  app.mount(column)

  search.setSearchOptions({ query: QUERY, caseSensitive: false, wholeWord: false, regexp: false })

  const searchMs: number[] = []
  // Every search as [start, end] in performance.now() time; the one still running when the keys end
  // gets its end when it is cancelled. The share of the keys' window these cover is the evidence
  // that the keys were typed while Rust was reading.
  const spans: [number, number][] = []
  let longestGapMs = 0
  let found = { hits: 0, files: 0, scanned: 0 }
  let running = true
  let lastEnd = performance.now()
  let rowsSeen = 0

  const searches = (async () => {
    while (running) {
      const started = performance.now()
      longestGapMs = Math.max(longestGapMs, started - lastEnd)
      await search.runSearch()
      lastEnd = performance.now()
      spans.push([started, lastEnd])
      const state = search.searchState.value
      // A search that could not run must end the scenario with its reason. Looping on it would
      // never give the event loop a turn, and the run would hang instead of failing.
      if (state.phase === 'failed') {
        running = false
        throw new Error(`the search failed: ${state.message ?? 'no reason given'}`)
      }
      if (state.summary === null || state.summary.stopped) continue
      searchMs.push(lastEnd - started)
      found = {
        hits: state.summary.hits,
        files: state.summary.files,
        scanned: state.summary.scanned,
      }
    }
  })()

  // How many result rows are in the DOM while the keys land.
  const looking = (async () => {
    while (running) {
      rowsSeen = Math.max(rowsSeen, column.querySelectorAll('[data-search-hit]').length)
      await sleep(200)
    }
  })()

  let out: ScenarioOutput
  const typingStart = performance.now()
  let typingEnd = typingStart
  try {
    out = await typing(ctx, mode)
    typingEnd = performance.now()
  } finally {
    running = false
    await search.cancelSearch()
    await Promise.all([searches, looking])
    app.unmount()
    column.remove()
  }
  if (rowsSeen === 0) throw new Error('the panel never drew a result row; nothing was measured')
  // The list draws only the rows on screen (about 30 in a 720 px window). Hundreds in the DOM mean
  // the panel was mounted without a height and the run measured something the app never does.
  if (rowsSeen > MAX_ROWS_DRAWN) {
    throw new Error(
      `the panel drew ${String(rowsSeen)} result rows; it should draw under ${String(MAX_ROWS_DRAWN)}`,
    )
  }
  const window = Math.max(typingEnd - typingStart, 1)
  const covered = spans.reduce(
    (sum, [from, to]) => sum + Math.max(0, Math.min(to, typingEnd) - Math.max(from, typingStart)),
    0,
  )
  return {
    samples: { ...out.samples, searchMs },
    values: {
      ...out.values,
      searchesCompleted: searchMs.length,
      searchShareOfTypingWindow: covered / window,
      resultsFound: found.hits,
      filesWithResults: found.files,
      filesScanned: found.scanned,
      longestGapBetweenSearchesMs: longestGapMs,
      resultRowsDrawnMax: rowsSeen,
    },
  }
}
