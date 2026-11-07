/**
 * P0-T9 fog: which mechanism keeps mixed line endings intact?
 *
 * Two candidates, tried with the real CodeMirror state and the real Markdown parser:
 *
 * 1. `EditorState.lineSeparator.of('\n')`: lines split only at `\n`, so a `\r` stays in the text as
 *    the last character of its line. It keeps every byte, but the Markdown parser stops seeing
 *    tables and hard breaks when `\r` is in the text. Rejected.
 * 2. Normalize the text to `\n` on open and keep the endings beside it, one per line break, in a
 *    state field that follows every edit. The parser sees clean text. Chosen; the spike below is
 *    the evidence, and Phase 2 builds the real one (ISC-3).
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

/** CRLF, LF, a lone CR, a blank CRLF line, and a last line with no ending. */
const MIXED = 'one\r\ntwo\nthree\rstill three\r\n\r\nlast'

const SAMPLE = [
  '---',
  'title: Notes',
  '---',
  '',
  '# Heading **bold**  ',
  '',
  'A paragraph with *emphasis*, `code`, ~~strike~~ and a [link](https://example.com).  ',
  'Second line after a hard break.',
  '',
  '- item one',
  '- [ ] task',
  '  - nested',
  '',
  '> quote',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  '---',
  '',
].join('\n')

function nodeNames(state: EditorState): string[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000)
  if (!tree) throw new Error('the parser did not finish')
  const names: string[] = []
  tree.iterate({ enter: (node) => void names.push(node.name) })
  return names
}

const language: Extension = markdown({ base: markdownLanguage })

describe('rejected: lineSeparator "\\n" with \\r kept in the text', () => {
  const keep: Extension = EditorState.lineSeparator.of('\n')

  it('keeps every byte, including a \\r that is the last character of its line', () => {
    const state = EditorState.create({ doc: MIXED, extensions: [keep] })
    expect(state.doc.lines).toBe(5)
    expect(state.doc.line(1).text).toBe('one\r')
    expect(state.doc.toString()).toBe(MIXED)
  })

  it('is needed for that: the default splitting turns every ending into \\n', () => {
    const state = EditorState.create({ doc: MIXED })
    expect(state.doc.toString()).toBe('one\ntwo\nthree\nstill three\n\nlast')
  })

  it('lets typing at the end of a CRLF line land after the \\r and break the pair', () => {
    const state = EditorState.create({ doc: MIXED, extensions: [keep] })
    const next = state.update({ changes: { from: 4, insert: 'X' }, userEvent: 'input.type' }).state
    expect(next.doc.toString().startsWith('one\rX\ntwo')).toBe(true)
  })

  it('makes the parser lose tables and hard breaks, which is why it is rejected', () => {
    const lf = nodeNames(EditorState.create({ doc: SAMPLE, extensions: [keep, language] }))
    const crlf = nodeNames(
      EditorState.create({ doc: SAMPLE.replace(/\n/g, '\r\n'), extensions: [keep, language] }),
    )
    for (const name of ['Table', 'HardBreak']) {
      expect(lf).toContain(name)
      expect(crlf).not.toContain(name)
    }
    // If a parser update ever makes these equal, this fails on purpose: revisit the decision.
    expect(crlf).not.toEqual(lf)
  })
})

/**
 * The spike. `endings[i]` is the line break that follows line i + 1, and the last line has none.
 * A break is `\r\n`, `\n` or `\r`, the same three the default splitter treats as a line break.
 */
function split(raw: string): { text: string; endings: string[] } {
  const endings = raw.match(/\r\n|\n|\r/g) ?? []
  return { text: raw.split(/\r\n|\n|\r/).join('\n'), endings }
}

function join(text: string, endings: readonly string[]): string {
  const lines = text.split('\n')
  return lines.map((line, i) => line + (endings[i] ?? '')).join('')
}

const setEndings = StateEffect.define<string[]>()

/** Keeps `endings` in step with the document: one entry per line break, whatever the edit. */
const endingsField = StateField.define<string[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEndings)) return [...effect.value]
    }
    if (!tr.docChanged) return value
    const before = tr.startState.doc
    const edits: { startLine: number; removed: number; added: number }[] = []
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const startLine = before.lineAt(fromA).number
      edits.push({
        startLine,
        removed: before.lineAt(toA).number - startLine,
        added: inserted.lines - 1,
      })
    })
    const next = [...value]
    // From the last edit to the first, so earlier line numbers stay valid.
    for (const { startLine, removed, added } of edits.reverse()) {
      // New breaks copy the ending of the line they split, or of the first line the edit touched.
      const inherited = value[startLine - 1] ?? value[startLine - 2] ?? value[0] ?? '\n'
      next.splice(startLine - 1, removed, ...Array.from({ length: added }, () => inherited))
    }
    return next
  },
})

function open(raw: string): EditorState {
  const { text, endings } = split(raw)
  const state = EditorState.create({ doc: text, extensions: [endingsField, language] })
  return state.update({ effects: setEndings.of(endings) }).state
}

const save = (state: EditorState) => join(state.doc.toString(), state.field(endingsField))

describe('chosen: normalized text with the endings kept beside it', () => {
  it.each([
    ['mixed', MIXED],
    ['all CRLF', 'a\r\nb\r\nc\r\n'],
    ['all LF', 'a\nb\nc'],
    ['old Mac CR only', 'a\rb\rc\r'],
    ['empty', ''],
    ['one ending', '\r\n'],
    ['blank lines', '\r\n\n\r\r\n'],
  ])('saves %s text back to the exact bytes with no edit', (_name, raw) => {
    expect(save(open(raw))).toBe(raw)
  })

  it('gives the parser clean text, so mixed endings parse like LF', () => {
    let breaks = 0
    const mixed = SAMPLE.replace(/\n/g, () => (breaks++ % 2 === 0 ? '\r\n' : '\n'))
    expect(nodeNames(open(mixed))).toEqual(nodeNames(open(SAMPLE)))
    expect(nodeNames(open(SAMPLE.replace(/\n/g, '\r\n')))).toEqual(nodeNames(open(SAMPLE)))
  })

  it('keeps the endings of untouched lines through 500 random edits', () => {
    let seed = 20261107
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    let state = open(MIXED)
    for (let i = 0; i < 500; i++) {
      const doc = state.doc
      const from = Math.floor(random() * (doc.length + 1))
      const to = Math.min(doc.length, from + Math.floor(random() * 6))
      const insert = ['x', 'yz', '\n', '', ' ', 'a\nb'][Math.floor(random() * 6)] ?? ''
      const first = doc.lineAt(from).number
      const last = doc.lineAt(to).number
      const before = state.field(endingsField)
      state = state.update({ changes: { from, to, insert } }).state
      const after = state.field(endingsField)

      expect(after.length).toBe(state.doc.lines - 1)
      // Lines above the edit keep their endings; lines below keep theirs, shifted by the new count.
      expect(after.slice(0, first - 1)).toEqual(before.slice(0, first - 1))
      expect(after.slice(after.length - (before.length - last))).toEqual(before.slice(last))
    }
  })

  it('gives a line split by Enter the ending of the line it came from', () => {
    const state = open(MIXED)
    // End of "one" (line 1 ends in CRLF): press Enter there.
    const next = state.update({ changes: { from: 3, insert: '\n' }, userEvent: 'input' }).state
    expect(next.doc.line(1).text).toBe('one')
    expect(save(next).startsWith('one\r\n\r\ntwo\n')).toBe(true)
  })

  it('does not restore a deleted ending on undo (known limit, for Phase 2 to close)', () => {
    // Deleting the break after "two" (an LF) and typing it back as "\n" under a CRLF neighbour
    // gives the neighbour's ending. The line was touched, so ISC-3 still holds; byte-exact undo
    // needs the removed endings stored in the history.
    const state = open('a\r\nb\nc')
    const joined = state.update({ changes: { from: 3, to: 4 } }).state
    const again = joined.update({ changes: { from: 3, insert: '\n' } }).state
    expect(save(again)).toBe('a\r\nb\r\nc')
  })
})
