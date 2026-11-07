import { flushSession, journalStats } from '@/documents/session'
import { followerOfTab, openPath } from '@/documents/store'
import type { ScenarioContext, ScenarioOutput } from './params'
import { sleep } from './support'

const REPEATS = 12
/** How long to watch frames after each flush starts. */
const WATCH_MS = 250

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
}

/** Largest gap between animation frames until `stop` is called. A frame is 16.7 ms when nothing blocks. */
function watchFrames(): { stop(): number } {
  let last = performance.now()
  let worst = 0
  let live = true
  const tick = (): void => {
    if (!live) return
    const now = performance.now()
    worst = Math.max(worst, now - last)
    last = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return {
    stop: () => {
      live = false
      return worst
    },
  }
}

/**
 * What one journal write costs the page, by how much unsaved text there is: the time to build the
 * snapshot, the time until the host confirms it, and the longest stretch the page went without a
 * frame while it happened. Each repeat edits first, so the snapshot always changed.
 */
export async function journalCost(ctx: ScenarioContext): Promise<ScenarioOutput> {
  // Each step adds a document and leaves the earlier ones edited, so the totals are about
  // nothing, 1 MB and 4 MB of unsaved text.
  const sizes: [string, string][] = [
    ['tiny', `${ctx.config.fixturesDir}/lf.md`],
    ['1mb', ctx.fixture('realistic-1mb.md')],
    ['4mb', ctx.fixture('realistic-3mb.md')],
  ]
  const samples: Record<string, number[]> = {}
  const values: Record<string, number> = {}
  for (const [label, path] of sizes) {
    const tab = await openPath(path)
    const build: number[] = []
    const write: number[] = []
    const gap: number[] = []
    const bytes: number[] = []
    for (let i = 0; i < REPEATS; i++) {
      followerOfTab(tab)?.dispatch({ changes: { from: 0, insert: 'x' } })
      await sleep(50)
      const frames = watchFrames()
      await flushSession()
      await sleep(WATCH_MS)
      const worst = frames.stop()
      if (journalStats.lastError !== null) throw new Error(journalStats.lastError)
      if (i === 0) continue // the first one pays for warming up
      build.push(journalStats.lastBuildMs)
      write.push(journalStats.lastWriteMs)
      gap.push(worst)
      bytes.push(journalStats.lastBytes)
    }
    samples[`${label}-buildMs`] = build
    samples[`${label}-writeMs`] = write
    samples[`${label}-worstFrameGapMs`] = gap
    values[`${label}-snapshotBytes`] = median(bytes)
    values[`${label}-buildMs-median`] = median(build)
    values[`${label}-writeMs-median`] = median(write)
    values[`${label}-worstFrameGapMs-median`] = median(gap)
    values[`${label}-worstFrameGapMs-max`] = Math.max(...gap)
  }
  return { samples, values }
}
