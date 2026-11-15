/**
 * Showing a theme color in the other format (ISC-468): hex to oklch to hex and back, with alpha, with
 * the built-in palettes as the table, and every text it makes a color a theme file accepts.
 */
import { describe, expect, it } from 'vitest'
import { BUILT_IN_IDS, BUILT_IN_THEMES, resolveToken } from '@/lib/builtinThemes'
import {
  formatColor,
  fromHsv,
  parseColor,
  toHex,
  toHexString,
  toHsv,
  toOklchString,
  tryParseColor,
  withOpacity,
} from '@/lib/color'
import { checkThemeColor } from '@/lib/themeFile'

/** The 8-bit channels of a color, as the page would paint it. */
const channels = (value: string): number[] => {
  const hex = toHex(parseColor(value))
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
}

const farthest = (a: number[], b: number[]): number =>
  Math.max(...a.map((channel, at) => Math.abs(channel - (b[at] ?? 0))))

/** Every literal color the three built-in themes hold, as the CSS writes them. */
const PALETTE: string[] = BUILT_IN_IDS.flatMap((id) => {
  const theme = BUILT_IN_THEMES[id]
  return [...theme.tokens.keys()]
    .map((name) => resolveToken(theme.tokens, name))
    .filter((value): value is string => value !== undefined && tryParseColor(value) !== null)
})

const GREYS = ['#000000', '#ffffff', '#808080', '#010101', '#fefefe', '#333', '#ccc']
const PRIMARIES = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#ff8800']

describe('ISC-468: a color converts between hex and oklch within one 8-bit step', () => {
  it('has a palette to test with', () => {
    expect(PALETTE.length).toBeGreaterThan(150)
  })

  it.each([...GREYS, ...PRIMARIES, ...PALETTE])(
    '%s: oklch text reads back as the same color',
    (color) => {
      const text = toOklchString(parseColor(color))
      expect(farthest(channels(text), channels(color))).toBeLessThanOrEqual(1)
    },
  )

  it.each([...GREYS, ...PRIMARIES, ...PALETTE])(
    '%s: hex text reads back as the same color',
    (color) => {
      const text = toHexString(parseColor(color))
      expect(farthest(channels(text), channels(color))).toBeLessThanOrEqual(1)
    },
  )

  it('makes every hex of the sRGB cube come back from oklch with no step lost', () => {
    // A grid of 17 values a channel: 4913 colors, every one converted and read back.
    const steps = Array.from({ length: 17 }, (_, at) => Math.min(255, at * 16))
    for (const r of steps)
      for (const g of steps)
        for (const b of steps) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
          expect(toHexString(parseColor(toOklchString(parseColor(hex))))).toBe(hex)
        }
  })

  it('always makes text a theme file accepts', () => {
    for (const color of [...GREYS, ...PRIMARIES, ...PALETTE, 'oklch(0.9 0.4 150)', '#00000000']) {
      const parsed = parseColor(color)
      expect(checkThemeColor(toOklchString(parsed)).ok).toBe(true)
      expect(checkThemeColor(toHexString(parsed)).ok).toBe(true)
    }
  })

  it('keeps the alpha, in both formats', () => {
    expect(toHexString(parseColor('oklch(0.85 0.12 88 / 80%)'))).toMatch(/^#[0-9a-f]{6}cc$/)
    expect(toOklchString(parseColor('#12345680'))).toMatch(/ \/ 0\.502\)$/)
    expect(toHexString(parseColor('#12345680'))).toBe('#12345680')
    // An opaque color carries no alpha in either format.
    expect(toHexString(parseColor('oklch(0.5 0.1 200)'))).toMatch(/^#[0-9a-f]{6}$/)
    expect(toOklchString(parseColor('#123456'))).not.toContain('/')
  })

  it('writes a hue below 360 and a grey with hue 0', () => {
    for (const color of [...PALETTE, ...GREYS]) {
      const hue = Number(
        / ([\d.]+)\)$|([\d.]+)\)$/
          .exec(toOklchString(parseColor(color)))?.[0]
          ?.replace(/[^\d.]/g, ''),
      )
      expect(hue).toBeLessThan(360)
    }
    expect(toOklchString(parseColor('#808080'))).toMatch(/^oklch\(0.59987 0 0\)$/)
  })

  it('takes an out-of-gamut color to the nearest hex and keeps its exact oklch', () => {
    const wild = parseColor('oklch(0.9 0.4 150)')
    expect(toHexString(wild)).toMatch(/^#[0-9a-f]{6}$/)
    expect(toOklchString(wild)).toBe('oklch(0.9 0.4 150)')
  })
})

describe('formatColor shows a color in the format asked for', () => {
  it('leaves a color already in that format exactly as written', () => {
    expect(formatColor('#FFF', 'hex')).toBe('#FFF')
    expect(formatColor('  #12ab34 ', 'hex')).toBe('#12ab34')
    expect(formatColor('oklch(70% 0.1 200)', 'oklch')).toBe('oklch(70% 0.1 200)')
  })

  it('converts a color in the other format', () => {
    expect(formatColor('oklch(0.59987 0 0)', 'hex')).toBe('#808080')
    expect(formatColor('#808080', 'oklch')).toBe('oklch(0.59987 0 0)')
    expect(formatColor('#80808080', 'oklch')).toMatch(/^oklch\(0.59987 0 0 \/ 0\.502\)$/)
  })

  it('returns what it cannot read unchanged', () => {
    expect(formatColor('red', 'hex')).toBe('red')
    expect(formatColor('var(--x)', 'oklch')).toBe('var(--x)')
    expect(formatColor('', 'hex')).toBe('')
  })
})

describe('ISC-490: withOpacity changes only the opacity', () => {
  it.each(['hex', 'oklch'] as const)('keeps the color and sets the opacity in %s', (format) => {
    const color = parseColor('#336699')
    const text = withOpacity(color, 0.4, format)
    const back = parseColor(text)
    expect(toHex(back)).toBe('#336699')
    expect(back.alpha).toBeCloseTo(0.4, 2)
  })

  it('writes a fully opaque color with no alpha part', () => {
    expect(withOpacity(parseColor('#33669980'), 1, 'hex')).toBe('#336699')
    expect(withOpacity(parseColor('#33669980'), 1, 'oklch')).not.toContain('/')
  })

  it('keeps the opacity of an oklch color through a hex round trip, within a step', () => {
    const source = parseColor('oklch(0.6 0.014 262 / 38%)')
    const text = withOpacity(source, source.alpha, 'hex')
    expect(parseColor(text).alpha).toBeCloseTo(0.38, 2)
  })

  it('clamps an opacity outside 0 to 1', () => {
    expect(parseColor(withOpacity(parseColor('#336699'), 7, 'hex')).alpha).toBe(1)
    expect(parseColor(withOpacity(parseColor('#336699'), -2, 'hex')).alpha).toBe(0)
  })
})

describe('ISC-497: hue, saturation and brightness', () => {
  it('brings every color of a 17-step grid of the sRGB cube back exactly, with its alpha', () => {
    const steps = Array.from({ length: 17 }, (_, at) => Math.min(255, at * 16))
    for (const r of steps)
      for (const g of steps)
        for (const b of steps) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
          const color = parseColor(hex)
          const back = fromHsv(toHsv(color), 0.4)
          expect(toHex(back)).toBe(hex)
          expect(back.alpha).toBe(0.4)
        }
  })

  it('reads the primaries and the extremes', () => {
    const read = (hex: string) => toHsv(parseColor(hex))
    expect(read('#ff0000')).toEqual({ h: 0, s: 1, v: 1 })
    expect(read('#00ff00')).toEqual({ h: 120, s: 1, v: 1 })
    expect(read('#0000ff')).toEqual({ h: 240, s: 1, v: 1 })
    expect(read('#ffffff')).toMatchObject({ s: 0, v: 1 })
    expect(read('#000000')).toMatchObject({ s: 0, v: 0 })
  })

  it('gives a grey or a black the hue it is asked to keep, and a color its own', () => {
    expect(toHsv(parseColor('#808080'), 200).h).toBe(200)
    expect(toHsv(parseColor('#000000'), 77).h).toBe(77)
    expect(toHsv(parseColor('#00ff00'), 200).h).toBe(120)
  })

  it('wraps a hue outside 0 to 360', () => {
    expect(toHex(fromHsv({ h: 360, s: 1, v: 1 }))).toBe('#ff0000')
    expect(toHex(fromHsv({ h: -120, s: 1, v: 1 }))).toBe('#0000ff')
    expect(toHex(fromHsv({ h: 480, s: 1, v: 1 }))).toBe('#00ff00')
  })

  it('does not change the color of an out-of-gamut value more than clamping it into sRGB', () => {
    const outside = parseColor('oklch(0.8 0.4 150)')
    expect(toHex(fromHsv(toHsv(outside)))).toBe(toHex(outside))
  })
})
