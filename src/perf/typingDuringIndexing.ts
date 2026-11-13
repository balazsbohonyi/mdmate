import type { ScenarioContext, ScenarioOutput } from './params'
import { typing, type TypingMode } from './typing'

/** What the index holds for `workspace-100k` (`scripts/lib/indexWorkspace.ts`). */
const EXPECTED_FILES = 100_000

/** The share of the typing window the index must have been reading, or the run measured nothing. */
const MIN_SHARE = 0.9

/**
 * ISC-292: typing while a 100,000-file workspace is indexed. It is the `typing-1mb` scenario,
 * unchanged (same document, same caret, same keys, measured the same way), with Rust reading the
 * workspace the whole time: the root is granted first, which starts a first index (no cache), and
 * when that ends a reconcile of the same root starts at once, and so on until the keys are done. So
 * every key, warm-up keys included, is typed while a walk of 100,000 files runs.
 *
 * The page's own work is inside the measurement. The real status bar is mounted and listens to the
 * real status channel, so the Indexing label and its percent bar are redrawn while the keys land.
 * The scenario fails if the bar never showed Indexing.
 *
 * The wording of the scenario was written into `ai-docs/phases/phase-07.1/decisions.md` before its
 * first run.
 */
export async function typingDuringIndexing(
  ctx: ScenarioContext,
  mode: TypingMode,
): Promise<ScenarioOutput> {
  const perf = ctx.host.perf
  if (perf === undefined) throw new Error('this scenario needs the perf bridge')
  const root = ctx.fixture('workspace-100k')

  // Loaded now, not at the top: the bar and its store are only for this scenario here, and the app
  // loads them in its own shell.
  const [{ createApp }, { default: StatusBar }, status] = await Promise.all([
    import('vue'),
    import('@/shell/StatusBar.vue'),
    import('@/features/index/status'),
  ])
  const footer = document.createElement('div')
  footer.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:5;display:flex;flex-direction:column;background:var(--color-statusbar)'
  document.body.append(footer)
  const app = createApp(StatusBar)
  app.mount(footer)
  await status.watchIndexStatus()

  const indexMs: number[] = []
  let filesIndexed = 0
  let running = true
  let labelSeen = false
  let percentSeen = 0

  const indexing = (async () => {
    // The first walk starts with the grant: this root has no cache, so it is a first index.
    let started = performance.now()
    await perf.grantRoot(root)
    for (;;) {
      const idle = await perf.indexIdle()
      indexMs.push(performance.now() - started)
      filesIndexed = idle.files
      if (!running) return
      // The next walk is a reconcile of the same root, started the moment the last one ended. It
      // fails if Rust does not know the root, so this loop cannot spin without walking.
      started = performance.now()
      await perf.indexReconcile(root)
    }
  })()

  const looking = (async () => {
    while (running) {
      const bar = footer.querySelector('[data-index-status]')
      if (bar !== null) {
        labelSeen = true
        const now = Number(
          footer.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),
        )
        if (Number.isFinite(now)) percentSeen = Math.max(percentSeen, now)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })()

  let out: ScenarioOutput
  // The evidence that the keys landed while Rust was reading is Rust's own clock: the time its
  // worker spent walking between the first key and the last, and the walks it finished meanwhile.
  const before = await perf.indexState()
  const typingStart = performance.now()
  let typingEnd: number
  let after: typeof before
  try {
    out = await typing(ctx, mode)
    typingEnd = performance.now()
    after = await perf.indexState()
  } finally {
    running = false
    await Promise.all([indexing, looking])
    app.unmount()
    footer.remove()
  }
  if (!labelSeen) throw new Error('the status bar never showed Indexing; nothing was measured')
  if (filesIndexed !== EXPECTED_FILES) {
    throw new Error(
      `the index held ${String(filesIndexed)} files; expected ${String(EXPECTED_FILES)}`,
    )
  }
  const window = Math.max(typingEnd - typingStart, 1)
  const share = Math.min(1, (after.walkingMs - before.walkingMs) / window)
  if (share < MIN_SHARE) {
    throw new Error(
      `the index was reading for ${(share * 100).toFixed(0)}% of the typing window; it must be at least ${String(MIN_SHARE * 100)}%`,
    )
  }
  return {
    samples: { ...out.samples, indexMs },
    values: {
      ...out.values,
      firstIndexMs: indexMs[0] ?? Number.NaN,
      indexesCompleted: after.walks - before.walks,
      indexShareOfTypingWindow: share,
      filesIndexed,
      statusPercentSeenMax: percentSeen,
    },
  }
}
