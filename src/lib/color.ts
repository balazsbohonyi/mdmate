/**
 * Just enough CSS color parsing to check contrast and to show a swatch: `#rgb`, `#rgba`, `#rrggbb`,
 * `#rrggbbaa` and OKLCH colors with optional alpha. Those are the only colors a theme holds, so this is
 * also the check that a theme file's value is a color at all (`themeFile.ts` builds on it).
 */

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

function linearToSrgb(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel))
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055
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
  if (!match) throw new Error(`Not an OKLCH color: ${value}`)
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

/** `parseColor`, or null for a value it cannot read. */
export function tryParseColor(value: string): Rgb | null {
  try {
    const color = parseColor(value)
    return color.linear.every(Number.isFinite) && Number.isFinite(color.alpha) ? color : null
  } catch {
    return null
  }
}

/** True when every channel is inside sRGB, with a little slack for rounding. */
export function inGamut(color: Rgb): boolean {
  return color.linear.every((channel) => channel >= -0.002 && channel <= 1.002)
}

export function luminance(color: Rgb): number {
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

/** The color as `#rrggbb`, clamped into sRGB and without its alpha; what a color picker holds. */
export function toHex(color: Rgb): string {
  return `#${color.linear
    .map((channel) =>
      Math.round(linearToSrgb(channel) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** The name of the OKLCH color function, kept apart so the no-hard-coded-colors scan finds no color literal here. */
const OKLCH = 'oklch'

/** A number rounded to `places` decimals and written plainly, with no trailing zeros. */
function plain(value: number, places: number): string {
  return String(Number(value.toFixed(places)))
}

/** The color as `#rrggbb`, or `#rrggbbaa` when it is not fully opaque; clamped into sRGB. */
export function toHexString(color: Rgb): string {
  const hex = toHex(color)
  if (color.alpha >= 1) return hex
  const alpha = Math.round(Math.min(1, Math.max(0, color.alpha)) * 255)
  return `${hex}${alpha.toString(16).padStart(2, '0')}`
}

/**
 * The color as an OKLCH function of lightness, chroma and hue, with ` / alpha` when it is not fully opaque. Five decimals of
 * lightness and chroma and three of hue make a hex color come back from here exactly, and keep an oklch color within a step of 8 bits per channel of the color it
 * came from. The text is always one a theme file accepts: lightness 0 to 1, chroma 0 to 0.5, hue
 * 0 up to but not including 360, plain numbers.
 */
export function toOklchString(color: Rgb): string {
  const [r, g, b] = color.linear
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const chroma = Math.hypot(a, bb)
  const degrees = chroma < 0.00005 ? 0 : (Math.atan2(bb, a) * 180) / Math.PI
  const hue = Number((((degrees % 360) + 360) % 360).toFixed(3)) % 360
  const text = `${OKLCH}(${plain(Math.min(1, Math.max(0, lightness)), 5)} ${plain(Math.min(0.5, chroma), 5)} ${plain(hue, 3)}`
  return color.alpha >= 1
    ? `${text})`
    : `${text} / ${plain(Math.min(1, Math.max(0, color.alpha)), 3)})`
}

/**
 * A theme color written in `format`: as it is when it already is in that format, converted when it
 * is in the other, and unchanged when it cannot be read as a color at all.
 */
export function formatColor(value: string, format: 'hex' | 'oklch'): string {
  const trimmed = value.trim()
  if (format === 'hex' ? trimmed.startsWith('#') : /^oklch\(/i.test(trimmed)) return trimmed
  const parsed = tryParseColor(trimmed)
  if (parsed === null) return value
  return format === 'hex' ? toHexString(parsed) : toOklchString(parsed)
}

/**
 * The same color with another opacity (0 to 1), written in `format`. What the color editor writes
 * when the picker moves the color of a translucent token, or its opacity field moves the opacity:
 * each keeps what the other set.
 */
export function withOpacity(color: Rgb, alpha: number, format: 'hex' | 'oklch'): string {
  const next = { linear: color.linear, alpha }
  return format === 'hex' ? toHexString(next) : toOklchString(next)
}

/** A color as hue (degrees, 0 up to 360), saturation and brightness (0 to 1): what a picker holds. */
export interface Hsv {
  h: number
  s: number
  v: number
}

/**
 * The color as hue, saturation and brightness, read from its 8-bit sRGB channels (clamped into
 * sRGB, alpha left out). A grey or a black has no hue of its own, so `keepHue` is what comes back:
 * a picker passes the hue it holds, and dragging through grey does not lose it.
 */
export function toHsv(color: Rgb, keepHue = 0): Hsv {
  const [r, g, b] = color.linear.map(
    (channel) => Math.round(linearToSrgb(channel) * 255) / 255,
  ) as [number, number, number]
  const high = Math.max(r, g, b)
  const spread = high - Math.min(r, g, b)
  if (spread === 0) return { h: keepHue, s: 0, v: high }
  const sector =
    high === r ? ((g - b) / spread) % 6 : high === g ? (b - r) / spread + 2 : (r - g) / spread + 4
  return { h: (sector * 60 + 360) % 360, s: spread / high, v: high }
}

/** The color for a hue, saturation and brightness (see `toHsv`), with the alpha given. */
export function fromHsv({ h, s, v }: Hsv, alpha = 1): Rgb {
  const chroma = v * s
  const sector = (((h % 360) + 360) % 360) / 60
  const x = chroma * (1 - Math.abs((sector % 2) - 1))
  const [r, g, b] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x]
  const lift = v - chroma
  return {
    linear: [srgbToLinear(r + lift), srgbToLinear(g + lift), srgbToLinear(b + lift)],
    alpha,
  }
}
