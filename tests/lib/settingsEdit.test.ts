/**
 * Changing one key of `settings.json` as text (P8-T1): ISC-349 (only the key changed differs;
 * unknown keys stay) and ISC-350 (a default value takes its key out). The logic is pure, so a few
 * examples are not enough: random edits of random files check the same two promises on many inputs.
 */
import { describe, expect, it } from 'vitest'
import { editSettingsText, readRoot } from '@/lib/settingsEdit'
import { parseJsonc } from '../helpers/jsonc'

/** A small seeded generator, so a failure names the seed that reproduces it. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SETTING_PATHS: readonly (readonly string[])[] = [
  ['theme'],
  ['devtools'],
  ['fonts', 'size'],
  ['fonts', 'heading'],
  ['fonts', 'headingScale'],
  ['editor', 'wordWrap'],
  ['workspace', 'excludedFolders'],
  ['links', 'onRename'],
]

describe('editSettingsText', () => {
  it('writes one key of an empty or missing file, with a two-space indent and a final newline', () => {
    const result = editSettingsText('', ['fonts', 'size'], 18)
    expect(result).toEqual({ ok: true, text: '{\n  "fonts": {\n    "size": 18\n  }\n}\n' })
    expect(editSettingsText('   \n', ['devtools'], true)).toEqual({
      ok: true,
      text: '{\n  "devtools": true\n}\n',
    })
  })

  it('changes only the key it was given and keeps every other key, unknown ones included', () => {
    const before = JSON.stringify({
      future: { a: [1, 2, { b: null }] },
      fonts: { size: 17, body: 'Georgia', nextYear: 'kept' },
      note: 'hand written',
    })
    const result = editSettingsText(before, ['fonts', 'size'], 20)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.parse(result.text)).toEqual({
      future: { a: [1, 2, { b: null }] },
      fonts: { size: 20, body: 'Georgia', nextYear: 'kept' },
      note: 'hand written',
    })
  })

  it('removing a key takes it out and takes its group out when that leaves the group empty', () => {
    const before = '{"fonts": {"size": 18}, "devtools": true, "extra": 1}'
    const result = editSettingsText(before, ['fonts', 'size'], undefined)
    expect(result).toEqual({ ok: true, text: '{\n  "devtools": true,\n  "extra": 1\n}\n' })
    // A group that still holds something stays.
    const kept = editSettingsText(
      '{"fonts": {"size": 18, "other": 1}}',
      ['fonts', 'size'],
      undefined,
    )
    expect(kept).toEqual({ ok: true, text: '{\n  "fonts": {\n    "other": 1\n  }\n}\n' })
    // Every key gone is an empty object, not an empty file.
    expect(editSettingsText('{"devtools": true}', ['devtools'], undefined)).toEqual({
      ok: true,
      text: '{}\n',
    })
  })

  it('takes out a key that is not there, and a group that was already empty, without a change', () => {
    // The text is kept as written: only the key asked about is ever touched.
    expect(editSettingsText('{"a": 1}', ['fonts', 'size'], undefined)).toEqual({
      ok: true,
      text: '{"a": 1}\n',
    })
    expect(editSettingsText('{"fonts": {}}', ['fonts', 'size'], undefined)).toEqual({
      ok: true,
      text: '{"fonts": {}}\n',
    })
    expect(editSettingsText('{"fonts": 5}', ['fonts', 'size'], undefined)).toEqual({
      ok: true,
      text: '{"fonts": 5}\n',
    })
  })

  it('replaces a group that is not an object when a key under it is set', () => {
    const result = editSettingsText('{"fonts": "big", "x": 1}', ['fonts', 'size'], 18)
    expect(result.ok && JSON.parse(result.text)).toEqual({ fonts: { size: 18 }, x: 1 })
  })

  it('refuses a file that is not valid JSON and says where, writing nothing', () => {
    const result = editSettingsText('{\n  "a": 1\n  "b": 2\n}', ['devtools'], true)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('not valid JSON')
    expect(result.spot.line).toBe(3)
    const array = editSettingsText('[1, 2]', ['devtools'], true)
    expect(array.ok).toBe(false)
  })

  it('reads a file that starts with a byte order mark', () => {
    const result = readRoot('﻿{"devtools": true}')
    expect(result).toMatchObject({ ok: true, root: { devtools: true } })
  })

  it('holds for random edits: unknown keys survive and a default takes its key out', () => {
    for (const seed of [11, 4242, 90210]) {
      const next = random(seed)
      const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T
      /** What the file holds, as dotted leaf paths, so the two sides can be compared. */
      const flatten = (value: Record<string, unknown>, prefix = ''): Map<string, unknown> => {
        const out = new Map<string, unknown>()
        for (const [key, item] of Object.entries(value)) {
          const at = prefix === '' ? key : `${prefix}.${key}`
          if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            const inner = flatten(item as Record<string, unknown>, at)
            if (inner.size === 0) out.set(at, {})
            for (const [innerKey, innerValue] of inner) out.set(innerKey, innerValue)
          } else {
            out.set(at, item)
          }
        }
        return out
      }
      const start: Record<string, unknown> = {
        unknownTop: { deep: [1, 2, 3], flag: true },
        'weird.key': 'a dot in a name',
        fonts: { surprise: 'kept', size: 22 },
        editor: {},
      }
      let text = JSON.stringify(start)
      const model = flatten(start)
      for (let round = 0; round < 300; round++) {
        const path = pick(SETTING_PATHS)
        const dotted = path.join('.')
        const removing = next() < 0.4
        const value = pick([true, 18, 'Georgia', [1, 2], null, 'x'.repeat(3)])
        const result = editSettingsText(text, path, removing ? undefined : value)
        expect(result.ok, `seed ${String(seed)} round ${String(round)}`).toBe(true)
        if (!result.ok) return
        text = result.text
        // The model: a value that sits where a group should be makes way for the key under it.
        if (removing) {
          model.delete(dotted)
        } else {
          for (let end = 1; end < path.length; end++) model.delete(path.slice(0, end).join('.'))
          for (const key of [...model.keys()]) if (key.startsWith(`${dotted}.`)) model.delete(key)
          model.set(dotted, value)
        }
        // A group that held only the removed key goes; a group that was always empty stays.
        const parsed = JSON.parse(text) as Record<string, unknown>
        const actual = flatten(parsed)
        for (const key of [...actual.keys()]) {
          if (!model.has(key)) {
            expect.fail(`seed ${String(seed)} round ${String(round)}: ${key} appeared`)
          }
        }
        for (const [key, expected] of model) {
          if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
            continue // an empty group: whether it stays depends on what removed from it, checked below
          }
          expect(actual.get(key), `seed ${String(seed)} round ${String(round)} ${key}`).toEqual(
            expected,
          )
        }
        // The unknown keys are never touched.
        expect(parsed.unknownTop).toEqual({ deep: [1, 2, 3], flag: true })
        expect(parsed['weird.key']).toBe('a dot in a name')
        expect((parsed.fonts as Record<string, unknown> | undefined)?.surprise ?? 'kept').toBe(
          'kept',
        )
        // The text still reads, ends in a newline, and holds what the model says it holds.
        expect(text.endsWith('}\n')).toBe(true)
        expect(parseJsonc(text)).toEqual(parsed)
        // Writing the same value again changes nothing.
        const again = editSettingsText(text, path, removing ? undefined : value)
        expect(again).toEqual({ ok: true, text })
        // Re-sync the model's empty groups with what the file really holds.
        for (const key of [...model.keys()]) {
          const item = model.get(key)
          if (item !== null && typeof item === 'object' && !Array.isArray(item)) model.delete(key)
        }
        for (const [key, item] of actual) {
          if (item !== null && typeof item === 'object' && !Array.isArray(item))
            model.set(key, item)
        }
      }
    }
  })
})
