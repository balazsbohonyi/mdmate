import { BUILT_IN_IDS, type BuiltInId } from './builtinThemes'
import { tryParseColor } from './color'
import { parseObject, stripBom, type Checked, type SyntaxSpot } from './settingsFile'
import { readRoot, type EditResult } from './settingsEdit'
import { applyEdits, modify } from 'jsonc-parser'
import { THEME_GROUPS, THEME_TOKENS, THEME_TOKEN_NAMES } from './themeTokens'

/**
 * A user theme file, `themes/<name>.json`: JSON with comments, read as data and never run.
 *
 *     { "name": "Night owl", "base": "dark", "colors": { "background": "<a color>" } }
 *
 * `base` is the built-in theme that supplies every color the file leaves out. Each entry of
 * `colors` overrides one token by its name without the leading dashes. A name or key this build
 * does not know is ignored. A value passes `checkThemeColor` or is dropped and the token keeps the
 * base's color, so a broken file costs its own colors and never the app.
 */

/** The longest color text taken; anything longer is not a color. */
const MAX_COLOR_CHARS = 100

const NUMBER = String.raw`(\d+(?:\.\d+)?|\.\d+)`
const OKLCH = new RegExp(
  String.raw`^oklch\(\s*${NUMBER}(%?)\s+${NUMBER}(%?)\s+${NUMBER}(?:deg)?(?:\s*/\s*${NUMBER}(%?))?\s*\)$`,
  'i',
)
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * A color a theme file may hold: hex (3, 4, 6 or 8 digits) or oklch with plain numbers (lightness
 * 0 to 1 or a percentage, chroma 0 to 0.5 or a percentage, hue 0 to 360, optional alpha). Nothing
 * else passes, not even a valid CSS color written as a function such as rgb, or a name, so what reaches the page's
 * styles has exactly the shape this check and the contrast code can read.
 */
export function checkThemeColor(value: unknown): Checked<string> {
  const bad = (why: string): Checked<string> => ({ ok: false, why })
  if (typeof value !== 'string') return bad('Use a color in quotes.')
  const text = value.trim()
  if (text === '') return bad('Give a color.')
  if (text.length > MAX_COLOR_CHARS) return bad('That is too long to be a color.')
  const sure = (): Checked<string> =>
    tryParseColor(text) === null ? bad('That is not a color.') : { ok: true, value: text }
  if (HEX.test(text)) return sure()
  const match = OKLCH.exec(text)
  if (match === null) return bad('Use a hex color or an oklch color with three numbers.')
  const [, lightness, lPercent, chroma, cPercent, hue, alpha, aPercent] = match
  const within = (part: string | undefined, percent: string | undefined, max: number): boolean =>
    part === undefined || Number(part) <= (percent === '%' ? 100 : max)
  if (
    !within(lightness, lPercent, 1) ||
    !within(chroma, cPercent, 0.5) ||
    Number(hue) > 360 ||
    !within(alpha, aPercent, 1)
  )
    return bad('A number is out of range: lightness 0 to 1, chroma 0 to 0.5, hue 0 to 360.')
  return sure()
}

/** What a theme file holds once checked. */
export interface UserThemeData {
  /** The display name the file gives, or null to use the file's name. */
  readonly name: string | null
  readonly base: BuiltInId
  /** Valid colors for known tokens only, by token name. */
  readonly colors: ReadonlyMap<string, string>
  /** What was wrong and ignored, one short sentence each. */
  readonly problems: readonly string[]
}

export type ParsedTheme =
  | { readonly ok: true; readonly theme: UserThemeData }
  | { readonly ok: false; readonly message: string; readonly spot: SyntaxSpot }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Reads the text of a theme file. A file that is not one JSON object is `ok: false`. */
export function parseThemeText(text: string): ParsedTheme {
  const source = stripBom(text)
  const parsed = parseObject(source)
  if (parsed.kind === 'syntax') {
    return { ok: false, message: 'it is not valid JSON.', spot: parsed.spot }
  }
  if (parsed.kind === 'not-object' || !parsed.hasValue) {
    return {
      ok: false,
      message: 'it must hold one JSON object, { ... }.',
      spot: { line: null, column: null },
    }
  }
  const root = parsed.root
  const problems: string[] = []

  let name: string | null = null
  if (Object.hasOwn(root, 'name')) {
    const value = root.name
    if (typeof value === 'string' && value.trim() !== '' && [...value].length <= 60) {
      // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
      if (/[\u0000-\u001f\u007f]/u.test(value))
        problems.push('"name" cannot hold control characters.')
      else name = value.trim()
    } else {
      problems.push('"name" must be a short text.')
    }
  }

  let base: BuiltInId = 'dark'
  if (Object.hasOwn(root, 'base')) {
    const found = BUILT_IN_IDS.find((id) => id === root.base)
    if (found === undefined)
      problems.push(
        `"base" must be ${BUILT_IN_IDS.slice(0, -1).join(', ')} or ${BUILT_IN_IDS.at(-1) ?? ''}.`,
      )
    else base = found
  }

  const colors = new Map<string, string>()
  if (Object.hasOwn(root, 'colors')) {
    const held = root.colors
    if (!isRecord(held)) {
      problems.push('"colors" must be an object, { ... }.')
    } else {
      for (const { name: token } of THEME_TOKENS) {
        if (!Object.hasOwn(held, token)) continue
        const checked = checkThemeColor(held[token])
        if (checked.ok) colors.set(token, checked.value)
        else problems.push(`colors.${token}: ${checked.why}`)
      }
    }
  }
  return { ok: true, theme: { name, base, colors, problems } }
}

/**
 * The text of a new theme file: the base, and a color for every token, grouped as the color editor
 * shows them. Written with the comments that tell someone opening it what it is.
 */
export function newThemeText(
  name: string,
  base: BuiltInId,
  colors: ReadonlyMap<string, string>,
): string {
  const lines: string[] = [
    '{',
    '  // An mdmate theme. "base" is the built-in theme that supplies every color left out of "colors".',
    '  // Colors are written in hex or oklch. Save the file and the app follows.',
    `  "name": ${JSON.stringify(name)},`,
    `  "base": ${JSON.stringify(base)},`,
    '  "colors": {',
  ]
  const groups = THEME_GROUPS.map((group) => ({
    label: group.label,
    tokens: THEME_TOKENS.filter((token) => token.group === group.id && colors.has(token.name)),
  })).filter((group) => group.tokens.length > 0)
  groups.forEach((group, groupIndex) => {
    lines.push(`    // ${group.label}`)
    group.tokens.forEach((token, index) => {
      const last = groupIndex === groups.length - 1 && index === group.tokens.length - 1
      lines.push(
        `    ${JSON.stringify(token.name)}: ${JSON.stringify(colors.get(token.name))}${last ? '' : ','}`,
      )
    })
  })
  lines.push('  }', '}')
  return `${lines.join('\n')}\n`
}

/**
 * Changes one color of a theme file's text, leaving every comment, every other key and the layout
 * as they were. The token must be one this build knows and the value must pass `checkThemeColor`.
 * A file that is not valid JSON is refused, never rewritten.
 */
export function editThemeColor(
  text: string,
  token: string,
  value: string,
  fileName = 'The theme file',
): EditResult {
  if (!THEME_TOKEN_NAMES.has(token)) {
    return {
      ok: false,
      message: `${token} is not a color of the theme.`,
      spot: { line: null, column: null },
    }
  }
  const checked = checkThemeColor(value)
  if (!checked.ok) {
    return { ok: false, message: `${token}: ${checked.why}`, spot: { line: null, column: null } }
  }
  const read = readRoot(text, fileName)
  if (!read.ok) return read
  const body = read.text
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  const edits = modify(body, ['colors', token], checked.value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol },
  })
  return { ok: true, text: applyEdits(body, edits) }
}

/**
 * Changes the `name` or the `base` of a theme file's text, leaving every comment, every color and
 * the layout as they were. A file that is not valid JSON is refused, never rewritten.
 */
export function editThemeField(
  text: string,
  field: 'name' | 'base',
  value: string,
  fileName = 'The theme file',
): EditResult {
  const read = readRoot(text, fileName)
  if (!read.ok) return read
  const body = read.text
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  const edits = modify(body, [field], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol },
  })
  return { ok: true, text: applyEdits(body, edits) }
}
