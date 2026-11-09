import { describe, expect, it } from 'vitest'
import {
  parseDroppedItems,
  parsePaths,
  parseTreeEntries,
  toCssPosition,
} from '@/platform/workspace'

describe('toCssPosition', () => {
  it('divides physical pixels by the display scale', () => {
    expect(toCssPosition({ x: 250, y: 125 }, 1.25)).toEqual({ x: 200, y: 100 })
    expect(toCssPosition({ x: 300, y: 150 }, 1.5)).toEqual({ x: 200, y: 100 })
    expect(toCssPosition({ x: 40, y: 20 }, 1)).toEqual({ x: 40, y: 20 })
  })

  it('treats a missing or nonsense ratio as 1', () => {
    for (const ratio of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toCssPosition({ x: 10, y: 20 }, ratio)).toEqual({ x: 10, y: 20 })
    }
  })
})

describe('reply validators', () => {
  it('accept the shapes Rust sends', () => {
    expect(
      parseTreeEntries([
        { name: 'a.md', kind: 'file' },
        { name: 'd', kind: 'folder' },
      ]),
    ).toEqual([
      { name: 'a.md', kind: 'file' },
      { name: 'd', kind: 'folder' },
    ])
    expect(parseDroppedItems([{ path: 'C:/x', kind: 'other' }])).toEqual([
      { path: 'C:/x', kind: 'other' },
    ])
    expect(parsePaths(['C:/a', 'C:/b'])).toEqual(['C:/a', 'C:/b'])
  })

  it('fail loudly on a reply of the wrong shape', () => {
    expect(() => parseTreeEntries({})).toThrow()
    expect(() => parseTreeEntries([{ name: 'a', kind: 'link' }])).toThrow(/unknown entry kind/)
    expect(() => parseTreeEntries([{ name: 1, kind: 'file' }])).toThrow()
    expect(() => parseDroppedItems([{ path: 'x', kind: 'dir' }])).toThrow(/unknown drop kind/)
    expect(() => parseDroppedItems('x')).toThrow()
    expect(() => parsePaths(['a', 1])).toThrow()
    expect(() => parsePaths(null)).toThrow()
  })
})
