import { describe, expect, it } from 'vitest'
import {
  REPEATABILITY_RULE,
  median,
  percentile,
  repeatability,
  summarize,
} from '../../scripts/lib/perfStats.ts'

const ascending = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe('percentile (nearest rank)', () => {
  it('picks the value at ceil(p/100 * n)', () => {
    const hundred = ascending(100)
    expect(percentile(hundred, 50)).toBe(50)
    expect(percentile(hundred, 95)).toBe(95)
    expect(percentile(hundred, 99)).toBe(99)
    expect(percentile(hundred, 100)).toBe(100)
  })

  it('rounds up, so a small sample never flatters the result', () => {
    // 5 values: rank ceil(0.95 * 5) = 5, the maximum.
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100)
    expect(percentile([7], 95)).toBe(7)
  })

  it('returns NaN for an empty list', () => {
    expect(percentile([], 95)).toBeNaN()
  })
})

describe('median', () => {
  it('takes the middle of an odd count and the mean of the middle two otherwise', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it('does not reorder the caller list', () => {
    const values = [3, 1, 2]
    median(values)
    expect(values).toEqual([3, 1, 2])
  })

  it('returns NaN for an empty list', () => {
    expect(median([])).toBeNaN()
  })
})

describe('summarize', () => {
  it('reports count, extremes, mean and percentiles', () => {
    const s = summarize(ascending(100))
    expect(s).toEqual({ n: 100, min: 1, mean: 50.5, p50: 50, p95: 95, p99: 99, max: 100 })
  })

  it('handles an empty list without throwing', () => {
    const s = summarize([])
    expect(s.n).toBe(0)
    expect(s.p95).toBeNaN()
  })
})

describe('repeatability', () => {
  it('states the rule that was fixed before the first run', () => {
    expect(REPEATABILITY_RULE).toEqual({ percent: 10, floorMs: 1 })
  })

  it('accepts runs within 10% of the median', () => {
    const result = repeatability([100, 105, 95, 108, 92])
    expect(result.median).toBe(100)
    expect(result.repeatable).toBe(true)
    expect(result.worstDeviationPct).toBeCloseTo(8)
  })

  it('rejects one run more than 10% from the median', () => {
    const result = repeatability([100, 100, 100, 100, 125])
    expect(result.repeatable).toBe(false)
    expect(result.max).toBe(125)
  })

  it('allows 1 ms on small numbers, where 10% is below the clock resolution', () => {
    expect(repeatability([5, 5.8, 4.2, 5, 5.9]).repeatable).toBe(true)
    expect(repeatability([5, 6.5, 5, 5, 5]).repeatable).toBe(false)
  })

  it('is not repeatable without any runs', () => {
    expect(repeatability([]).repeatable).toBe(false)
  })
})
