/**
 * The image tab's placement rules (P6-T3): fit to the pane (ISC-108), zoom (ISC-109) and pan
 * (ISC-110) as numbers. The tab itself is checked on screen.
 */
import { describe, expect, it } from 'vitest'
import { formatBytes } from '@/lib/bytes'
import { actualView, fitView, MAX_SCALE, MIN_SCALE, panBy, zoomAbout } from '@/workbench/imageView'

const PANE = { width: 800, height: 600 }

describe('fitting a picture to the pane', () => {
  it('shrinks a large picture until all of it shows, centred', () => {
    const view = fitView({ width: 2400, height: 1600 }, PANE)
    expect(view.scale).toBeCloseTo(1 / 3) // 800 / 2400 is tighter than 600 / 1600
    expect(2400 * view.scale).toBeCloseTo(PANE.width)
    expect(1600 * view.scale).toBeLessThanOrEqual(PANE.height)
    expect(view.x).toBeCloseTo(0)
    expect(view.y).toBeCloseTo((PANE.height - 1600 * view.scale) / 2)
  })

  it('fits a tall picture by its height and a wide one by its width', () => {
    expect(fitView({ width: 100, height: 3000 }, PANE).scale).toBeCloseTo(0.2)
    expect(fitView({ width: 4000, height: 100 }, PANE).scale).toBeCloseTo(0.2)
  })

  it('leaves a small picture at its own size instead of blowing it up', () => {
    const view = fitView({ width: 64, height: 64 }, PANE)
    expect(view.scale).toBe(1)
    expect(view.x).toBe(368)
    expect(view.y).toBe(268)
  })

  it('gives a neutral view while the pane or the picture has no size yet', () => {
    expect(fitView({ width: 0, height: 0 }, PANE)).toEqual({ scale: 1, x: 0, y: 0 })
    expect(fitView({ width: 10, height: 10 }, { width: 0, height: 0 })).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    })
  })

  it('shows the actual size centred, overflowing the pane when it is larger', () => {
    expect(actualView({ width: 2400, height: 1600 }, PANE)).toEqual({ scale: 1, x: -800, y: -500 })
  })
})

describe('zooming', () => {
  it('keeps the spot under the pointer where it was', () => {
    const before = { scale: 0.5, x: 40, y: 30 }
    const [cx, cy] = [300, 200]
    // The picture point under the pointer, before and after.
    const under = (view: typeof before): [number, number] => [
      (cx - view.x) / view.scale,
      (cy - view.y) / view.scale,
    ]
    const after = zoomAbout(before, 2, cx, cy)
    expect(after.scale).toBe(1)
    expect(under(after)[0]).toBeCloseTo(under(before)[0])
    expect(under(after)[1]).toBeCloseTo(under(before)[1])
  })

  it('changes the scale by the factor, in and out', () => {
    expect(zoomAbout({ scale: 1, x: 0, y: 0 }, 1.25, 0, 0).scale).toBeCloseTo(1.25)
    expect(zoomAbout({ scale: 1, x: 0, y: 0 }, 0.8, 0, 0).scale).toBeCloseTo(0.8)
  })

  it('stops at the limits', () => {
    expect(zoomAbout({ scale: 20, x: 0, y: 0 }, 10, 0, 0).scale).toBe(MAX_SCALE)
    expect(zoomAbout({ scale: 0.05, x: 0, y: 0 }, 0.001, 0, 0).scale).toBe(MIN_SCALE)
  })
})

describe('panning', () => {
  it('moves the picture by the drag and keeps the scale', () => {
    expect(panBy({ scale: 2, x: 10, y: 20 }, -5, 7)).toEqual({ scale: 2, x: 5, y: 27 })
  })
})

describe('a size in bytes', () => {
  it('reads as bytes, KB, MB and GB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(812)).toBe('812 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(6309)).toBe('6.2 KB')
    expect(formatBytes(150 * 1024)).toBe('150 KB')
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB')
  })

  it('says nothing for a size that is not a size', () => {
    expect(formatBytes(-1)).toBe('')
    expect(formatBytes(Number.NaN)).toBe('')
  })
})
