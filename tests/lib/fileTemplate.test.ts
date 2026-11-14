/**
 * The commented template and the edits around it (ISC-420, ISC-421, ISC-425, ISC-427, ISC-428): an
 * edit changes only the entry it was given, never a comment, and an entry taken out gets its example
 * back, so a file whose every entry is back at its default reads like the first template.
 */
import { describe, expect, it } from 'vitest'
import { settingsTemplate } from '@/features/settings/templates'
import { buildTemplate, commentText, hasComment } from '@/lib/fileTemplate'
import {
  clearSettingsText,
  editSettingsText,
  isBlankFile,
  isUnchanged,
  readRoot,
} from '@/lib/settingsEdit'
import { SETTING_DEFS, SETTING_KEYS } from '@/lib/settingsFile'

const FILE = 'settings.json'
const template = settingsTemplate()
const paths = SETTING_KEYS.map((key) => SETTING_DEFS[key].path)

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

function edit(text: string, path: readonly string[], value: unknown): string {
  const result = editSettingsText(text, path, value, FILE, template)
  if (!result.ok) throw new Error(result.message)
  return result.text
}
const setKey = (text: string, path: readonly string[]): string => edit(text, path, 7)
const resetKey = (text: string, path: readonly string[]): string => edit(text, path, undefined)

/** What a user does by hand: takes the `//` off the example of one key, or off a whole group. */
function uncomment(text: string, path: readonly string[]): string {
  const group = path.length === 2 ? template.block([path[0] ?? '']) : undefined
  const lines =
    group ?? (template.example(path) === undefined ? [] : [template.example(path) ?? ''])
  // The lines go as one piece: a block's closing `// },` is the same text in every block.
  const from = lines.map((line) => `  ${line}`).join('\n')
  const to = lines.map((line) => `  ${line.replace(/^\/\/ ?/, '')}`).join('\n')
  if (!text.includes(from)) throw new Error(`no lines ${from}`)
  return text.replace(from, () => to)
}

/** The keys that share the key's group (the key itself when it has none). */
function siblings(path: readonly string[]): (readonly string[])[] {
  return path.length === 1 ? [path] : paths.filter((one) => one[0] === path[0])
}

describe('buildTemplate', () => {
  it('writes the header, a heading per section, flat keys as lines and groups as one block', () => {
    const built = buildTemplate(
      ['Header.'],
      [
        {
          title: 'One',
          entries: [
            { path: ['a'], value: '1', note: 'A.' },
            { path: ['g', 'x'], value: '"s"', note: 'X.' },
            { path: ['g', 'y'], value: 'true', note: 'Y.' },
          ],
        },
        { title: null, entries: [{ path: ['b'], value: 'null', note: 'B.' }] },
      ],
    )
    expect(built.text).toBe(
      [
        '{',
        '  // Header.',
        '',
        '  // One',
        '  // "a": 1,  // A.',
        '  // "g": {',
        '  //   "x": "s",  // X.',
        '  //   "y": true,  // Y.',
        '  // },',
        '',
        '  // "b": null,  // B.',
        '}',
        '',
      ]
        .join('\n')
        .replace('"x": "s"', '"x": "s"'),
    )
    expect(built.example(['a'])).toBe('// "a": 1,  // A.')
    expect(built.example(['g', 'y'])).toBe('// "y": true,  // Y.')
    expect(built.block(['g'])).toEqual([
      '// "g": {',
      '//   "x": "s",  // X.',
      '//   "y": true,  // Y.',
      '// },',
    ])
    expect(built.example(['nope'])).toBeUndefined()
    expect(built.block(['a'])).toBeUndefined()
  })

  it('refuses a key listed twice and a path of three names', () => {
    expect(() =>
      buildTemplate(
        [],
        [
          {
            title: null,
            entries: [
              { path: ['a'], value: '1', note: '' },
              { path: ['a'], value: '2', note: '' },
            ],
          },
        ],
      ),
    ).toThrow(/listed twice/)
    expect(() =>
      buildTemplate(
        [],
        [{ title: null, entries: [{ path: ['a', 'b', 'c'], value: '1', note: '' }] }],
      ),
    ).toThrow(/one or two names/)
  })

  it('reads a comment line without its slashes, and finds it however it is indented', () => {
    expect(commentText('    //   "k":  1,  // note')).toBe('"k": 1, // note')
    expect(commentText('  "k": 1')).toBeNull()
    expect(hasComment('{\n      // "k": 1,  // note\n}', '// "k": 1, // note')).toBe(true)
    expect(hasComment('{\n  "k": 1\n}', '// "k": 1')).toBe(false)
  })
})

describe('ISC-425: the settings template holds every setting and reads as no entries', () => {
  it('has a line for every key, with its default and the row wording, in one block per group', () => {
    for (const key of SETTING_KEYS) {
      const def = SETTING_DEFS[key]
      const line = template.example(def.path)
      expect(line, key).toBeDefined()
      expect(line).toContain(JSON.stringify(def.default))
      expect(hasComment(template.text, line ?? '')).toBe(true)
    }
    expect(template.block(['fonts'])?.length).toBe(
      paths.filter((path) => path[0] === 'fonts').length + 2,
    )
    expect(template.block(['theme'])).toBeUndefined()
  })

  it('is comments only inside braces, and reads as an empty object', () => {
    const read = readRoot(template.text, FILE)
    expect(read.ok && read.root).toEqual({})
    expect(template.text.startsWith('{\n')).toBe(true)
    expect(template.text.endsWith('}\n')).toBe(true)
    for (const line of template.text.trimEnd().split('\n').slice(1, -1)) {
      expect(line === '' || line.trim().startsWith('//'), line).toBe(true)
    }
  })
})

describe('ISC-420: an edit never changes a comment', () => {
  it('keeps every line of the template, in order, when keys are set and when they are changed again', () => {
    let text = template.text
    for (const path of paths) text = setKey(text, path)
    for (const path of paths) text = edit(text, path, 9)
    const kept = template.text
      .trimEnd()
      .split('\n')
      .slice(1, -1)
      .filter((line) => line !== '')
    let from = 0
    for (const line of kept) {
      const at = text.indexOf(line, from)
      expect(at, line).toBeGreaterThanOrEqual(from)
      from = at + line.length
    }
  })

  it('keeps comments the user wrote, in the middle of their own entries', () => {
    const own = '{\n  // my note\n  "theme": "light", // why\n  "devtools": true\n}\n'
    const changed = edit(own, ['devtools'], false)
    expect(changed).toBe('{\n  // my note\n  "theme": "light", // why\n  "devtools": false\n}\n')
  })
})

describe('ISC-427: resetting what was changed gives the template back', () => {
  it('after one key set from the screen, for every key', () => {
    for (const path of paths) {
      const changed = setKey(template.text, path)
      expect(changed).not.toBe(template.text)
      expect(resetKey(changed, path), path.join('.')).toBe(template.text)
    }
  })

  it('after every key set, reset in the order set and in the reverse order', () => {
    let text = template.text
    for (const path of paths) text = setKey(text, path)
    let forward = text
    for (const path of paths) forward = resetKey(forward, path)
    expect(forward).toBe(template.text)
    let backward = text
    for (const path of [...paths].reverse()) backward = resetKey(backward, path)
    expect(backward).toBe(template.text)
  })

  it('after a line, or a whole group, was uncommented by hand and reset from the screen', () => {
    for (const path of paths) {
      const by = uncomment(template.text, path)
      expect(by).not.toBe(template.text)
      expect(readRoot(by, FILE).ok, path.join('.')).toBe(true)
      let text = by
      for (const one of siblings(path)) text = resetKey(text, one)
      expect(text, path.join('.')).toBe(template.text)
    }
  })

  it('after a line was uncommented, changed on the screen and reset', () => {
    for (const path of paths) {
      let text = setKey(uncomment(template.text, path), path)
      for (const one of siblings(path)) text = resetKey(text, one)
      expect(text, path.join('.')).toBe(template.text)
    }
  })

  it('for random mixes of untouched, set and uncommented keys, reset in a random order', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const next = random(seed)
      let text = template.text
      const touched: (readonly string[])[] = []
      const seen = new Set<string>()
      for (const path of paths) {
        const name = path[0] ?? ''
        if (path.length === 1) {
          const roll = next()
          if (roll < 0.35) continue
          text = roll < 0.7 ? setKey(text, path) : uncomment(text, path)
          touched.push(path)
          continue
        }
        // A group is uncommented as a whole, or has some of its keys set one at a time.
        if (seen.has(name)) continue
        seen.add(name)
        const roll = next()
        if (roll < 0.35) continue
        if (roll < 0.7) {
          for (const one of siblings(path)) {
            if (next() < 0.6) {
              text = setKey(text, one)
              touched.push(one)
            }
          }
        } else {
          text = uncomment(text, path)
          touched.push(...siblings(path))
        }
      }
      const order = [...touched].sort(() => next() - 0.5)
      for (const path of order) text = resetKey(text, path)
      expect(text, `seed ${String(seed)}`).toBe(template.text)
    }
  })
})

describe('ISC-428: the restore adds nothing it should not', () => {
  it('does not write an example that is already in the file', () => {
    const changed = setKey(template.text, ['theme'])
    const reset = resetKey(changed, ['theme'])
    const example = template.example(['theme']) ?? ''
    expect(reset.split(example).length - 1).toBe(1)
  })

  it('writes nothing for a key the template does not know, and takes it out as it is', () => {
    const own = '{\n  "future": 1,\n  "devtools": true\n}\n'
    expect(editSettingsText(own, ['future'], undefined, FILE, template)).toEqual({
      ok: true,
      text: '{\n  "devtools": true\n}\n',
    })
    expect(editSettingsText('{"future": 1}', ['future'], undefined, FILE, template)).toEqual({
      ok: true,
      text: '{}\n',
    })
  })

  it('takes the plain way out when the entry shares its line with something else', () => {
    const own = '{ "theme": "light", "devtools": true }\n'
    const result = editSettingsText(own, ['theme'], undefined, FILE, template)
    expect(result.ok && readRoot(result.text, FILE).ok).toBe(true)
    expect(result.ok && result.text).not.toContain('//')
  })

  it('takes the plain way out when there is no template at all', () => {
    const result = editSettingsText('{\n  "theme": "light"\n}\n', ['theme'], undefined, FILE)
    expect(result).toEqual({ ok: true, text: '{}\n' })
  })
})

describe('ISC-429: a file that holds nothing is edited from the template', () => {
  it('starts from the template for a missing, empty and {} file', () => {
    for (const blank of ['', '  \n', '{}', '{}\n', '{ }', '﻿{}']) {
      expect(isBlankFile(blank), JSON.stringify(blank)).toBe(true)
      const changed = editSettingsText(blank, ['theme'], 'light', FILE, template)
      expect(changed.ok && changed.text).toContain('"theme": "light"')
      expect(changed.ok && changed.text).toContain(template.text.split('\n')[1] ?? 'x')
    }
    expect(isBlankFile(null)).toBe(true)
    expect(isBlankFile('{"a":1}')).toBe(false)
    expect(isBlankFile('{\n  // only a comment\n}')).toBe(false)
  })

  it('says a change that changes nothing changed nothing, and writes no file for it', () => {
    const none = editSettingsText('', ['theme'], undefined, FILE, template)
    expect(none.ok && isUnchanged(null, none.text, template)).toBe(true)
    expect(none.ok && isUnchanged('{}\n', none.text, template)).toBe(true)
    const some = editSettingsText('', ['theme'], 'light', FILE, template)
    expect(some.ok && isUnchanged(null, some.text, template)).toBe(false)
    const again = editSettingsText(template.text, ['theme'], undefined, FILE, template)
    expect(again.ok && isUnchanged(template.text, again.text, template)).toBe(true)
  })

  it('leaves a file with content alone: no template is added to it', () => {
    const own = '{\n  "devtools": true\n}\n'
    const changed = editSettingsText(own, ['theme'], 'light', FILE, template)
    expect(changed.ok && changed.text).not.toContain('mdmate settings')
  })
})

describe('ISC-421: clearing leaves the comments', () => {
  it('takes every entry out, unknown ones too, and the template comes back whole', () => {
    let text = template.text
    for (const path of paths) text = setKey(text, path)
    text = edit(text, ['someFutureKey'], 1)
    const cleared = clearSettingsText(text, FILE, template)
    expect(cleared.ok && cleared.text).toBe(template.text)
  })

  it('clears a file that holds nothing as it is, and refuses one that is not JSON', () => {
    expect(clearSettingsText('{}\n', FILE, template)).toEqual({ ok: true, text: '{}\n' })
    const bad = clearSettingsText('{ "a" 1 }', FILE, template)
    expect(bad.ok).toBe(false)
  })
})
