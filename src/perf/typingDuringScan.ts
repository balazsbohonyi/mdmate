import type { ScenarioContext, ScenarioOutput } from './params'
import { typing } from './typing'

/**
 * ISC-129: typing while a rewrite scan runs over a large workspace. It is the `typing-1mb`
 * scenario, unchanged (same document, same caret, same keys, measured the same way), with a real
 * `rewritePlan` scan running the whole time: when one scan ends the next starts at once, so every
 * key, warm-up keys included, is typed while Rust reads the workspace. The scans only plan; each is
 * discarded, so nothing on disk changes.
 *
 * The workspace is `tests/fixtures/generated/workspace-large`, written by
 * `scripts/lib/workspaceFixture.ts`: 8,001 notes (9.6 MB) in 80 folders, about 825 of them linking
 * to `target.md`, the file the scans plan to rename.
 */
export async function typingDuringScan(ctx: ScenarioContext): Promise<ScenarioOutput> {
  const perf = ctx.host.perf
  if (perf === undefined) throw new Error('this scenario needs the perf bridge')
  const root = ctx.fixture('workspace-large')
  await perf.grantRoot(root)
  const target = `${root}/target.md`

  const scanMs: number[] = []
  // Every scan as [start, end] in performance.now() time; the one still running when the keys end
  // gets its end when it is cancelled. The share of the keys' window these cover is the evidence
  // that the keys were typed while Rust was reading.
  const spans: [number, number][] = []
  let longestGapMs = 0
  let found = { links: 0, files: 0, scanned: 0 }
  let cancelledScans = 0
  let lastPlanned: unknown = null
  let running = true
  let lastEnd = performance.now()

  const scans = (async () => {
    while (running) {
      const started = performance.now()
      longestGapMs = Math.max(longestGapMs, started - lastEnd)
      const planned = await ctx.host.rewritePlan(
        target,
        { kind: 'rename', name: 'renamed.md' },
        [],
        () => undefined,
      )
      lastEnd = performance.now()
      spans.push([started, lastEnd])
      lastPlanned = planned
      if (planned.cancelled) {
        cancelledScans++
        continue
      }
      scanMs.push(lastEnd - started)
      found = { links: planned.links, files: planned.files, scanned: planned.scanned }
      if (planned.token !== 0) await ctx.host.rewriteDiscard(planned.token)
    }
  })()

  let out: ScenarioOutput
  const typingStart = performance.now()
  let typingEnd = typingStart
  try {
    out = await typing(ctx, 'dispatch')
    typingEnd = performance.now()
  } finally {
    running = false
    await ctx.host.rewriteCancel()
    await scans
  }
  // A run in which no scan finished measured nothing: say what the scans came back as.
  if (scanMs.length === 0) {
    throw new Error(
      `no scan finished while typing (${String(cancelledScans)} cancelled, ${String(spans.length)} started); the last answer was ${JSON.stringify(lastPlanned)}`,
    )
  }
  const window = Math.max(typingEnd - typingStart, 1)
  const covered = spans.reduce(
    (sum, [from, to]) => sum + Math.max(0, Math.min(to, typingEnd) - Math.max(from, typingStart)),
    0,
  )
  return {
    samples: { ...out.samples, scanMs },
    values: {
      ...out.values,
      scansCompleted: scanMs.length,
      scanShareOfTypingWindow: covered / window,
      linksFound: found.links,
      filesWithLinks: found.files,
      filesScanned: found.scanned,
      longestGapBetweenScansMs: longestGapMs,
    },
  }
}
