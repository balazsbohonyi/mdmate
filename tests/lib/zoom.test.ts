import { describe, expect, it } from 'vitest'
import { clampZoom, stepZoom, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '@/lib/zoom'

describe('the zoom levels', () => {
  it('run from 50 to 300 percent in steps of 10, starting at 100', () => {
    expect([ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, ZOOM_DEFAULT]).toEqual([50, 300, 10, 100])
  })

  it('keeps a level inside the range', () => {
    expect(clampZoom(10)).toBe(50)
    expect(clampZoom(500)).toBe(300)
    expect(clampZoom(120)).toBe(120)
  })
})

describe('stepZoom', () => {
  it('goes one step up or down from a level on the grid', () => {
    expect(stepZoom(100, 1)).toBe(110)
    expect(stepZoom(100, -1)).toBe(90)
    expect(stepZoom(50, 1)).toBe(60)
    expect(stepZoom(300, -1)).toBe(290)
  })

  it('goes to the next multiple of the step from a level off the grid', () => {
    expect(stepZoom(105, 1)).toBe(110)
    expect(stepZoom(105, -1)).toBe(100)
    expect(stepZoom(101, 1)).toBe(110)
    expect(stepZoom(109, -1)).toBe(100)
    expect(stepZoom(251, -1)).toBe(250)
  })

  it('stays at the end of the range', () => {
    expect(stepZoom(300, 1)).toBe(300)
    expect(stepZoom(295, 1)).toBe(300)
    expect(stepZoom(50, -1)).toBe(50)
    expect(stepZoom(55, -1)).toBe(50)
  })

  it('always moves, until it reaches an end, and the result is always a level', () => {
    for (let level = ZOOM_MIN; level <= ZOOM_MAX; level += 1) {
      const up = stepZoom(level, 1)
      const down = stepZoom(level, -1)
      expect(up).toBeGreaterThanOrEqual(level)
      expect(down).toBeLessThanOrEqual(level)
      if (level < ZOOM_MAX) expect(up).toBeGreaterThan(level)
      if (level > ZOOM_MIN) expect(down).toBeLessThan(level)
      expect(up % ZOOM_STEP).toBe(0)
      expect(down % ZOOM_STEP).toBe(0)
    }
  })
})
