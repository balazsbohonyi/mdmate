import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import {
  SCROLL_LAB_IMAGES,
  gradientPng,
  imageSize,
  scrollLabDocument,
  writeScrollLab,
} from '../../scripts/lib/scrollLab'

const dir = mkdtempSync(join(tmpdir(), 'mdmate-scroll-lab-'))
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the scroll-stability lab', () => {
  it('writes a real png of the size it says', () => {
    const png = gradientPng(37, 21, 3)
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.readUInt32BE(16)).toBe(37)
    expect(png.readUInt32BE(20)).toBe(21)
    // The pixel data inflates to one filter byte plus three bytes a pixel, per row.
    const idat = png.indexOf('IDAT')
    const length = png.readUInt32BE(idat - 4)
    expect(inflateSync(png.subarray(idat + 4, idat + 4 + length)).length).toBe(21 * (1 + 37 * 3))
  })

  it('gives each image its own size, within the range the check relies on', () => {
    const sizes = new Set<string>()
    for (let i = 0; i < SCROLL_LAB_IMAGES; i++) {
      const { width, height } = imageSize(i)
      expect(width).toBeGreaterThanOrEqual(320)
      expect(height).toBeGreaterThanOrEqual(140)
      sizes.add(`${String(width)}x${String(height)}`)
    }
    expect(sizes.size).toBeGreaterThan(SCROLL_LAB_IMAGES * 0.9)
  })

  it('references exactly the files it writes, one figure per section', () => {
    const doc = writeScrollLab(dir, 12)
    const files = readdirSync(dir).filter((name) => name.endsWith('.png'))
    expect(files).toHaveLength(12)
    const text = readFileSync(doc, 'utf8')
    for (const file of files) expect(text).toContain(`](${file})`)
    expect(text.match(/^!\[Figure \d+\]/gm)).toHaveLength(12)
    expect(scrollLabDocument(12)).toBe(text)
  })
})
