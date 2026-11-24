import {
  cssFamilyList,
  DEFAULT_FONT_PRESET,
  FONT_PRESET_IDS,
  FONT_PRESETS,
  inlineCodeScaleForBody,
  PRESET_HEADING_SCALE,
  type FontPreset,
} from './fontPresets'
import { parseObject, SETTING_DEFS, stripBom, type Checked, type SyntaxSpot } from './settingsFile'
import { checkThemeName } from './themeNames'

/**
 * Custom user font preset files (`font-presets/<stem>.json`, P9.1-T40): JSONC on read, clean JSON
 * on write, validated purely here before reaching the editor or Settings UI.
 */

export const MAX_PRESET_LABEL = 60

const BUILT_IN_PRESET_LABELS: readonly string[] = FONT_PRESET_IDS.flatMap((id) => [
  id.toLowerCase(),
  FONT_PRESETS[id].label.toLowerCase(),
])

export interface UserFontPresetData {
  readonly name: string
  readonly heading: string
  readonly body: string
  readonly code: string
  readonly size: number
  readonly lineHeight: number
  readonly codeSize: number
  readonly codeLineHeight: number
  readonly headingScale: readonly number[]
  readonly inlineCodeScale: number
  readonly problems: readonly string[]
}

export interface FontPresetWriteData {
  readonly name: string
  readonly heading: string
  readonly body: string
  readonly code: string
  readonly size: number
  readonly lineHeight: number
  readonly codeSize: number
  readonly codeLineHeight: number
  readonly headingScale: readonly number[]
  readonly inlineCodeScale?: number
}

export type ParsedFontPreset =
  | { readonly ok: true; readonly preset: UserFontPresetData }
  | { readonly ok: false; readonly message: string; readonly spot: SyntaxSpot }

const SYSTEM = FONT_PRESETS[DEFAULT_FONT_PRESET]

function checkInlineScale(value: unknown): Checked<number> {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return { ok: false, why: 'Use a number.' }
  if (value < 0.5 || value > 1.5) return { ok: false, why: 'Use a number from 0.5 to 1.5.' }
  return { ok: true, value }
}

/** Parses a JSONC custom font preset file. Invalid JSON or non-object returns `ok: false`. */
export function parseFontPresetText(text: string): ParsedFontPreset {
  const source = stripBom(text)
  if (source.trim() === '') {
    return {
      ok: false,
      message: 'it must hold one JSON object, { ... }.',
      spot: { line: null, column: null },
    }
  }
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

  let name = ''
  if (Object.hasOwn(root, 'name')) {
    const value = root.name
    if (
      typeof value === 'string' &&
      value.trim() !== '' &&
      [...value.trim()].length <= MAX_PRESET_LABEL
    ) {
      // eslint-disable-next-line no-control-regex -- control characters are refused
      if (/[\u0000-\u001f\u007f]/u.test(value))
        problems.push('"name" cannot hold control characters.')
      else name = value.trim()
    } else {
      problems.push('"name" must be a short text.')
    }
  }

  let heading = ''
  if (Object.hasOwn(root, 'heading')) {
    const checked = SETTING_DEFS['fonts.heading'].check(root.heading)
    if (checked.ok) heading = checked.value
    else problems.push(`"heading": ${checked.why}`)
  }

  let body = ''
  if (Object.hasOwn(root, 'body')) {
    const checked = SETTING_DEFS['fonts.body'].check(root.body)
    if (checked.ok) body = checked.value
    else problems.push(`"body": ${checked.why}`)
  }

  let code = ''
  if (Object.hasOwn(root, 'code')) {
    const checked = SETTING_DEFS['fonts.code'].check(root.code)
    if (checked.ok) code = checked.value
    else problems.push(`"code": ${checked.why}`)
  }

  let size = SYSTEM.size
  if (Object.hasOwn(root, 'size')) {
    const checked = SETTING_DEFS['fonts.size'].check(root.size)
    if (checked.ok && checked.value !== null) size = checked.value
    else problems.push(`"size": ${checked.ok ? 'Use a number.' : checked.why}`)
  }

  let lineHeight = SYSTEM.lineHeight
  if (Object.hasOwn(root, 'lineHeight')) {
    const checked = SETTING_DEFS['fonts.lineHeight'].check(root.lineHeight)
    if (checked.ok && checked.value !== null) lineHeight = checked.value
    else problems.push(`"lineHeight": ${checked.ok ? 'Use a number.' : checked.why}`)
  }

  let codeSize = SYSTEM.codeSize
  if (Object.hasOwn(root, 'codeSize')) {
    const checked = SETTING_DEFS['fonts.codeSize'].check(root.codeSize)
    if (checked.ok && checked.value !== null) codeSize = checked.value
    else problems.push(`"codeSize": ${checked.ok ? 'Use a number.' : checked.why}`)
  }

  let codeLineHeight = SYSTEM.codeLineHeight
  if (Object.hasOwn(root, 'codeLineHeight')) {
    const checked = SETTING_DEFS['fonts.codeLineHeight'].check(root.codeLineHeight)
    if (checked.ok && checked.value !== null) codeLineHeight = checked.value
    else problems.push(`"codeLineHeight": ${checked.ok ? 'Use a number.' : checked.why}`)
  }

  let headingScale: readonly number[] = PRESET_HEADING_SCALE
  if (Object.hasOwn(root, 'headingScale')) {
    const checked = SETTING_DEFS['fonts.headingScale'].check(root.headingScale)
    if (checked.ok && checked.value !== null) headingScale = checked.value
    else problems.push(`"headingScale": ${checked.ok ? 'Use six numbers.' : checked.why}`)
  }

  let inlineCodeScale = inlineCodeScaleForBody(body)
  if (Object.hasOwn(root, 'inlineCodeScale')) {
    const checked = checkInlineScale(root.inlineCodeScale)
    if (checked.ok) inlineCodeScale = checked.value
    else problems.push(`"inlineCodeScale": ${checked.why}`)
  }

  return {
    ok: true,
    preset: {
      name,
      heading,
      body,
      code,
      size,
      lineHeight,
      codeSize,
      codeLineHeight,
      headingScale,
      inlineCodeScale,
      problems,
    },
  }
}

/** Formats a custom preset object as clean JSON ending with a newline. */
export function serializeFontPreset(data: FontPresetWriteData): string {
  const payload: Record<string, unknown> = {
    name: data.name,
    heading: data.heading,
    body: data.body,
    code: data.code,
    size: data.size,
    lineHeight: data.lineHeight,
    codeSize: data.codeSize,
    codeLineHeight: data.codeLineHeight,
    headingScale: [...data.headingScale],
  }
  if (data.inlineCodeScale !== undefined) payload.inlineCodeScale = data.inlineCodeScale
  return `${JSON.stringify(payload, null, 2)}\n`
}

/** Validates a user preset display name: 1–60 printable chars, unique, not a built-in name. */
export function checkPresetDisplayName(value: string, others: Iterable<string>): Checked<string> {
  const label = value.trim()
  const bad = (why: string): Checked<string> => ({ ok: false, why })
  if (label === '') return bad('Name the preset.')
  if ([...label].length > MAX_PRESET_LABEL) return bad('Use at most 60 characters.')
  // eslint-disable-next-line no-control-regex -- control characters are refused
  if (/[\u0000-\u001f\u007f]/u.test(label)) return bad('Use printable characters only.')
  const key = label.toLowerCase()
  if (BUILT_IN_PRESET_LABELS.includes(key)) return bad(`${label} is a built-in preset.`)
  for (const other of others) {
    if (other.trim().toLowerCase() === key) return bad('A preset with that name exists already.')
  }
  return { ok: true, value: label }
}

/** Derives a safe filename stem (without `.json`) avoiding `taken` stems and built-in ids. */
export function presetStem(label: string, taken: ReadonlySet<string>): string {
  const swapped = [...label]
    .map((char) => (/[\p{Alphabetic}\p{N} _.-]/u.test(char) ? char : '-'))
    .join('')
    .replace(/\.{2,}/g, '.')
    .replace(/^[ .]+|[ .]+$/g, '')
  const base = [...(swapped === '' ? 'preset' : swapped)]
    .slice(0, 50)
    .join('')
    .replace(/[ .]+$/, '')
  const stem = base === '' ? 'preset' : base
  for (let number = 1; number < 1000; number++) {
    const candidate = number === 1 ? stem : `${stem} ${String(number)}`
    const key = candidate.toLowerCase()
    if (!taken.has(key) && !BUILT_IN_PRESET_LABELS.includes(key) && checkThemeName(candidate).ok) {
      return candidate
    }
  }
  return `preset ${String(Date.now())}`
}

/** Suggests `<name> copy`, `<name> copy 2`, ... not colliding with existing names or built-ins. */
export function copyPresetLabel(name: string, others: Iterable<string>): string {
  const held = [...others]
  const short = [...name.trim()].slice(0, 50).join('').trim()
  for (let number = 1; number < 1000; number++) {
    const label = `${short} copy${number === 1 ? '' : ` ${String(number)}`}`
    if (checkPresetDisplayName(label, held).ok) return label
  }
  return `${short} copy ${String(Date.now())}`
}

function slotFor(
  written: string,
  kind: 'heading' | 'body' | 'code',
): {
  readonly name: string
  readonly stack: string
} {
  const trimmed = written.trim()
  const fallback = SYSTEM[kind]
  if (trimmed === '') return fallback
  const own = cssFamilyList(trimmed)
  const first =
    trimmed
      .split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '') ?? ''
  const display = first === '' ? trimmed : first
  return {
    name: display,
    stack: own === '' ? fallback.stack : `${own}, ${fallback.stack}`,
  }
}

/** Builds a runtime `FontPreset` from a validated user preset file and its file stem `id`. */
export function userPresetFromData(id: string, data: UserFontPresetData): FontPreset {
  return {
    id,
    label: data.name === '' ? id : data.name,
    builtIn: false,
    heading: slotFor(data.heading, 'heading'),
    body: slotFor(data.body, 'body'),
    code: slotFor(data.code, 'code'),
    size: data.size,
    lineHeight: data.lineHeight,
    codeSize: data.codeSize,
    codeLineHeight: data.codeLineHeight,
    headingScale: data.headingScale,
    inlineCodeScale: data.inlineCodeScale,
  }
}
