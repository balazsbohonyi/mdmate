/**
 * Custom font preset files (`font-presets/<stem>.json`, P9.1-T40, ISC-729): JSONC parsing,
 * field validation, optional `inlineCodeScale`, serialization, display-name uniqueness (no
 * built-in collisions), and safe filename stems.
 */
import { describe, expect, it } from 'vitest'
import {
  checkPresetDisplayName,
  copyPresetLabel,
  parseFontPresetText,
  presetStem,
  serializeFontPreset,
} from '@/lib/fontPresetFile'
import { PRESET_HEADING_SCALE } from '@/lib/fontPresets'

describe('ISC-729: parseFontPresetText & serializeFontPreset', () => {
  it('parses valid JSONC with comments, trailing commas, and explicit inlineCodeScale', () => {
    const parsed = parseFontPresetText(`// My reading preset
{
  "name": "My Reading",
  "heading": "Montserrat",
  "body": "Lora",
  "code": "JetBrains Mono",
  "size": 19,
  "lineHeight": 1.65,
  "codeSize": 15,
  "codeLineHeight": 1.5,
  "headingScale": [1.8, 1.5, 1.3, 1.15, 1, 0.95],
  "inlineCodeScale": 0.88,
}`)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.preset).toEqual({
      name: 'My Reading',
      heading: 'Montserrat',
      body: 'Lora',
      code: 'JetBrains Mono',
      size: 19,
      lineHeight: 1.65,
      codeSize: 15,
      codeLineHeight: 1.5,
      headingScale: [1.8, 1.5, 1.3, 1.15, 1, 0.95],
      inlineCodeScale: 0.88,
      problems: [],
    })
  })

  it('auto-derives inlineCodeScale and uses sensible defaults when optional fields are omitted', () => {
    const parsed = parseFontPresetText(
      JSON.stringify({
        name: 'Clean Serif',
        body: 'monospace',
        size: 17,
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.preset.heading).toBe('')
    expect(parsed.preset.body).toBe('monospace')
    expect(parsed.preset.code).toBe('')
    expect(parsed.preset.size).toBe(17)
    expect(parsed.preset.lineHeight).toBe(1.5)
    expect(parsed.preset.codeSize).toBe(14)
    expect(parsed.preset.codeLineHeight).toBe(1.5)
    expect(parsed.preset.headingScale).toEqual(PRESET_HEADING_SCALE)
    expect(parsed.preset.inlineCodeScale).toBe(0.82)
    expect(parsed.preset.problems).toEqual([])
  })

  it('rejects broken JSON and non-objects cleanly without throwing', () => {
    expect(parseFontPresetText('{ broken').ok).toBe(false)
    expect(parseFontPresetText('[]').ok).toBe(false)
    expect(parseFontPresetText('"text"').ok).toBe(false)
    expect(parseFontPresetText('').ok).toBe(false)
  })

  it('records field problems while keeping valid values', () => {
    const parsed = parseFontPresetText(
      JSON.stringify({
        name: 'Partial',
        heading: 'Bad;Font',
        size: 999,
        lineHeight: 1.6,
        inlineCodeScale: 3,
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.preset.lineHeight).toBe(1.6)
    expect(parsed.preset.size).toBe(16)
    expect(parsed.preset.problems.length).toBeGreaterThanOrEqual(3)
  })

  it('round-trips through serializeFontPreset cleanly', () => {
    const text = serializeFontPreset({
      name: 'Round Trip',
      heading: 'Raleway',
      body: 'Open Sans',
      code: 'Fira Code',
      size: 17,
      lineHeight: 1.6,
      codeSize: 14,
      codeLineHeight: 1.5,
      headingScale: PRESET_HEADING_SCALE,
    })
    const parsed = parseFontPresetText(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.preset.name).toBe('Round Trip')
    expect(parsed.preset.heading).toBe('Raleway')
    expect(parsed.preset.size).toBe(17)
    expect(parsed.preset.inlineCodeScale).toBe(0.9)
  })
})

describe('ISC-729: display name & stem validation', () => {
  it('enforces 1-60 printable chars, uniqueness ignoring case, and forbids built-in names', () => {
    expect(checkPresetDisplayName('My Notes', ['Other']).ok).toBe(true)
    expect(checkPresetDisplayName('   ', []).ok).toBe(false)
    expect(checkPresetDisplayName('a'.repeat(61), []).ok).toBe(false)
    expect(checkPresetDisplayName('bad\nname', []).ok).toBe(false)
    for (const builtIn of ['System', 'editorial', 'MODERN', 'Journal']) {
      expect(checkPresetDisplayName(builtIn, []).ok, builtIn).toBe(false)
    }
    expect(checkPresetDisplayName('my notes', ['My Notes']).ok).toBe(false)
  })

  it('derives safe filename stems avoiding taken stems and built-in ids', () => {
    expect(presetStem('My Reading', new Set())).toBe('My Reading')
    expect(presetStem('My: Reading/Notes?', new Set())).toBe('My- Reading-Notes-')
    expect(presetStem('My Reading', new Set(['my reading']))).toBe('My Reading 2')
    expect(presetStem('CON', new Set())).not.toBe('CON')
  })

  it('suggests unique copy labels', () => {
    expect(copyPresetLabel('Editorial', [])).toBe('Editorial copy')
    expect(copyPresetLabel('Editorial', ['Editorial copy'])).toBe('Editorial copy 2')
  })
})
