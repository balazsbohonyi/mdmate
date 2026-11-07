/** Statistics for the perf harness. Pure functions, so tests can pin them. */

export interface Summary {
  n: number
  min: number
  mean: number
  p50: number
  p95: number
  p99: number
  max: number
}

/** Nearest-rank percentile of a list that is already sorted ascending. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? Number.NaN
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return Number.NaN
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? Number.NaN
  return ((sorted[middle - 1] ?? Number.NaN) + (sorted[middle] ?? Number.NaN)) / 2
}

export function summarize(values: readonly number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((total, value) => total + value, 0)
  return {
    n: sorted.length,
    min: sorted[0] ?? Number.NaN,
    mean: sorted.length === 0 ? Number.NaN : sum / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? Number.NaN,
  }
}

/**
 * Fixed before the first run, so the verdict cannot bend to the numbers: a metric is repeatable
 * when every one of the runs lands within 10% of the median of all runs, or within 1 ms of it,
 * whichever allows more. The 1 ms floor is the clock's own resolution.
 */
export const REPEATABILITY_RULE = { percent: 10, floorMs: 1 } as const

export interface Repeatability {
  median: number
  min: number
  max: number
  /** The widest distance from the median, as a percentage of the median. */
  worstDeviationPct: number
  repeatable: boolean
}

export function repeatability(
  runs: readonly number[],
  rule: { percent: number; floorMs: number } = REPEATABILITY_RULE,
): Repeatability {
  const center = median(runs)
  const allowed = Math.max((center * rule.percent) / 100, rule.floorMs)
  const worst = Math.max(0, ...runs.map((value) => Math.abs(value - center)))
  return {
    median: center,
    min: Math.min(...runs),
    max: Math.max(...runs),
    worstDeviationPct: center === 0 ? 0 : (worst / center) * 100,
    repeatable: runs.length > 0 && worst <= allowed,
  }
}
