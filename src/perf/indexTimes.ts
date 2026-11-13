import type { ScenarioContext, ScenarioOutput } from './params'
import { sleep } from './support'

/** What the index holds for `workspace-100k` (`scripts/lib/indexWorkspace.ts`). */
const EXPECTED_FILES = 100_000

/**
 * How long the index takes on the 100,000-file workspace. Recorded and printed, never gated: it is
 * what the disk and the virus scanner make of it.
 *
 * Two launches share one data folder, told apart by `phase`:
 *
 * - **1, the first index.** The root has no cache, so mdmate reads the whole workspace. The time
 *   from granting the root to the index going quiet is `firstIndexMs`. The cache is written, and the
 *   run reports.
 * - **2, the start-up reconcile.** The same root again, with the cache the first run left. The time
 *   until the index holds the cached list is `cacheAnswerMs` (what Ctrl+P can answer from), and the
 *   time until the reconcile against the disk ends is `reconcileMs`.
 *
 * The wording of the scenario was written into `ai-docs/phases/phase-07.1/decisions.md` before its
 * first run.
 */
export async function indexTimes(ctx: ScenarioContext): Promise<ScenarioOutput> {
  const perf = ctx.host.perf
  if (perf === undefined) throw new Error('this scenario needs the perf bridge')
  const root = ctx.fixture('workspace-100k')
  const second = ctx.params.phase === 2
  if (ctx.params.phase !== 1 && !second) throw new Error('index-times runs as phase 1 or phase 2')

  const started = performance.now()
  await perf.grantRoot(root)
  let cacheAnswerMs = Number.NaN
  if (second) {
    // The list appears while the walk is still running: that is the cache answering.
    for (;;) {
      const state = await perf.indexState()
      if (state.files > 0) {
        cacheAnswerMs = performance.now() - started
        break
      }
      if (!state.indexing) throw new Error('the index went quiet without ever holding the cache')
      await sleep(1)
    }
  }
  const idle = await perf.indexIdle()
  const doneMs = performance.now() - started
  if (idle.files !== EXPECTED_FILES) {
    throw new Error(
      `the index held ${String(idle.files)} files; expected ${String(EXPECTED_FILES)}`,
    )
  }
  if (!second) {
    await perf.indexFlush()
    // The cache file is written by now; a moment more lets the disk finish before the app quits.
    await sleep(300)
  }
  return {
    samples: {},
    values: second
      ? { cacheAnswerMs, reconcileMs: doneMs, filesIndexed: idle.files }
      : { firstIndexMs: doneMs, filesIndexed: idle.files },
  }
}
