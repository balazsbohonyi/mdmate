/** Just enough CSS color parsing to check contrast: `#rrggbb` and `oklch()` with optional alpha. */

export interface Rgb {
  /** Linear-light sRGB, before any clamping. A channel outside 0 to 1 is outside the sRGB gamut. */
  linear: [number, number, number]
  alpha: number
}

function toNumber(text: string, percentScale: number): number {
  const trimmed = text.trim()
  return trimmed.endsWith('%')
    ? (Number.parseFloat(trimmed) / 100) * percentScale
    : Number.parseFloat(trimmed)
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function parseHex(value: string): Rgb {
  let hex = value.slice(1)
  if (hex.length === 3 || hex.length === 4) {
    hex = [...hex].map((digit) => digit + digit).join('')
  }
  const channels = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
  const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
  return {
    linear: [
      srgbToLinear(channels[0] ?? 0),
      srgbToLinear(channels[1] ?? 0),
      srgbToLinear(channels[2] ?? 0),
    ],
    alpha,
  }
}

function parseOklch(value: string): Rgb {
  const match = /^oklch\(\s*([^\s/]+)\s+([^\s/]+)\s+([^\s/]+)\s*(?:\/\s*([^)]+))?\)$/i.exec(value)
  if (!match) throw new Error(`Not an oklch() color: ${value}`)
  const lightness = toNumber(match[1] ?? '0', 1)
  const chroma = toNumber(match[2] ?? '0', 0.4)
  const hue = (Number.parseFloat(match[3] ?? '0') * Math.PI) / 180
  const alpha = match[4] ? toNumber(match[4], 1) : 1
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return {
    linear: [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ],
    alpha,
  }
}

export function parseColor(value: string): Rgb {
  const trimmed = value.trim()
  if (trimmed.startsWith('#')) return parseHex(trimmed)
  if (/^oklch\(/i.test(trimmed)) return parseOklch(trimmed)
  throw new Error(`Unsupported color: ${value}`)
}

/** True when every channel is inside sRGB, with a little slack for rounding. */
export function inGamut(color: Rgb): boolean {
  return color.linear.every((channel) => channel >= -0.002 && channel <= 1.002)
}

function luminance(color: Rgb): number {
  const [r, g, b] = color.linear.map((channel) => Math.min(1, Math.max(0, channel))) as [
    number,
    number,
    number,
  ]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two opaque colors. */
export function contrast(first: Rgb, second: Rgb): number {
  const high = Math.max(luminance(first), luminance(second))
  const low = Math.min(luminance(first), luminance(second))
  return (high + 0.05) / (low + 0.05)
}
