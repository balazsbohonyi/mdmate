/**
 * Line endings (ISC-3, and the text half of ISC-2).
 *
 * Two mechanisms were tried in P0-T9 with the real CodeMirror state and the real Markdown parser:
 *
 * 1. `EditorState.lineSeparator.of('\n')`: lines split only at `\n`, so a `\r` stays in the text as
 *    the last character of its line. It keeps every byte, but the Markdown parser stops seeing
 *    tables and hard breaks when `\r` is in the text. Rejected; the first block below pins why.
 * 2. Normalize the text to `\n` on open and keep the endings beside it, one per line break, in a
 *    state field that follows every edit. The parser sees clean text. Chosen, and built in
 *    `src/editor/lineEndings.ts`; the rest of this file tests that field, against a reference model
 *    written as plainly as it can be so that it shares no code with the field.
 */
import { isolateHistory } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState, type Extension, type Transaction } from '@codemirror/state'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { endingsOf, setEndings } from '@/editor/lineEndings'
import { moveSelectedText } from '@/editor/textDrag'
import { ENDING_TEXT, type EndingCode, type Endings } from '@/lib/endings'
import { joinRaw, openRaw, redoOn, saveRaw, select, splitRaw, undoOn } from '../helpers/endings'

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
const isolated = { annotations: isolateHistory.of('full') }

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
    expect(saveRaw(openRaw(raw))).toBe(raw)
  })

  it('gives the parser clean text, so mixed endings parse like LF', () => {
    let breaks = 0
    const mixed = SAMPLE.replace(/\n/g, () => (breaks++ % 2 === 0 ? '\r\n' : '\n'))
    expect(nodeNames(openRaw(mixed, language))).toEqual(nodeNames(openRaw(SAMPLE, language)))
    expect(nodeNames(openRaw(SAMPLE.replace(/\n/g, '\r\n'), language))).toEqual(
      nodeNames(openRaw(SAMPLE, language)),
    )
  })

  it('stores only the breaks that differ from the dominant ending', () => {
    expect(endingsOf(openRaw('a\r\nb\r\nc\nd\r\n'))).toEqual({ dominant: 1, at: [2], codes: [0] })
    expect(endingsOf(openRaw('a\nb\nc'))).toEqual({ dominant: 0, at: [], codes: [] })
  })

  it('replaces every ending when a file is loaded again', () => {
    const state = openRaw('a\r\nb')
    const next = state.update({
      changes: { from: 0, to: state.doc.length, insert: 'x\ny\nz' },
      effects: setEndings.of(splitRaw('x\ry\rz').endings),
    }).state
    expect(saveRaw(next)).toBe('x\ry\rz')
  })
})

/** The lines of raw text, each with its own ending. */
const rawLines = (raw: string): string[] => raw.split(/(?<=\n|\r(?!\n))/)

describe('ISC-3: an edit leaves the ending of every untouched line alone (mixed-eol fixture)', () => {
  const fixture = readFileSync(new URL('../fixtures/mixed-eol.md', import.meta.url), 'utf8')
  const lines = rawLines(fixture)
  const parts = lines.map((line) => /^(.*?)(\r\n|\n|\r)?$/s.exec(line)?.slice(1) ?? ['', ''])
  const textOf = (i: number): string => parts[i]?.[0] ?? ''
  const endOf = (i: number): string => parts[i]?.[1] ?? ''
  /** Where each line starts in the text the editor shows, which has `\n` only. */
  const starts = lines.map((_, i) =>
    lines.slice(0, i).reduce((total, _line, j) => total + textOf(j).length + 1, 0),
  )

  it('has the endings the checks depend on', () => {
    expect(lines.length).toBeGreaterThan(300)
    expect(parts.some((p) => p[1] === '\r\n')).toBe(true)
    expect(parts.some((p) => p[1] === '\n')).toBe(true)
    expect(rawLines(saveRaw(openRaw(fixture)))).toEqual(lines)
  })

  it('appending to any one line changes that line and no other', () => {
    for (let k = 0; k < lines.length; k++) {
      const next = openRaw(fixture).update({
        changes: { from: (starts[k] ?? 0) + textOf(k).length, insert: 'X' },
      }).state
      const expected = lines.map((line, i) => (i === k ? `${textOf(k)}X${endOf(k)}` : line))
      expect(rawLines(saveRaw(next)), `line ${k}`).toEqual(expected)
    }
  })

  it('typing after the last line break adds a last line with no ending', () => {
    const state = openRaw(fixture)
    const next = state.update({ changes: { from: state.doc.length, insert: 'X' } }).state
    expect(saveRaw(next)).toBe(`${fixture}X`)
  })

  it('splitting any line with Enter gives both halves that line ending and keeps the rest', () => {
    for (let k = 0; k < lines.length; k++) {
      const half = Math.floor(textOf(k).length / 2)
      const next = openRaw(fixture).update({
        changes: { from: (starts[k] ?? 0) + half, insert: '\n' },
      }).state
      const expected = [
        ...lines.slice(0, k),
        textOf(k).slice(0, half) + endOf(k),
        textOf(k).slice(half) + endOf(k),
        ...lines.slice(k + 1),
      ]
      expect(rawLines(saveRaw(next)), `line ${k}`).toEqual(expected)
    }
  })

  it('joining a line to the next keeps the ending of the next one, and every other line', () => {
    for (let k = 0; k < lines.length - 1; k++) {
      const at = (starts[k] ?? 0) + textOf(k).length
      const next = openRaw(fixture).update({ changes: { from: at, to: at + 1 } }).state
      const expected = [
        ...lines.slice(0, k),
        textOf(k) + textOf(k + 1) + endOf(k + 1),
        ...lines.slice(k + 2),
      ]
      expect(rawLines(saveRaw(next)), `line ${k}`).toEqual(expected)
    }
  })

  it('deleting a whole line takes its ending with it and leaves the others', () => {
    for (let k = 0; k < lines.length - 1; k++) {
      const next = openRaw(fixture).update({
        changes: { from: starts[k] ?? 0, to: starts[k + 1] ?? 0 },
      }).state
      expect(rawLines(saveRaw(next)), `line ${k}`).toEqual(lines.filter((_, i) => i !== k))
    }
  })

  it('undoing any of those puts every byte back', () => {
    for (let k = 0; k < lines.length - 1; k++) {
      const next = openRaw(fixture).update({
        changes: { from: starts[k] ?? 0, to: starts[k + 1] ?? 0 },
      }).state
      expect(saveRaw(undoOn(next) ?? next), `line ${k}`).toBe(fixture)
    }
  })
})

describe('the field follows edits', () => {
  it('gives a line split by Enter the ending of the line it came from', () => {
    const next = openRaw(MIXED).update({ changes: { from: 3, insert: '\n' }, userEvent: 'input' })
    expect(next.state.doc.line(1).text).toBe('one')
    expect(saveRaw(next.state).startsWith('one\r\n\r\ntwo\n')).toBe(true)
  })

  it('gives a line split on the last line the ending of the break before it', () => {
    const next = openRaw('a\r\nb').update({ changes: { from: 3, insert: '\n' } }).state
    expect(saveRaw(next)).toBe('a\r\nb\r\n')
  })

  it('applies several changes in one transaction, each against the text before any of them', () => {
    const state = openRaw('a\r\nb\nc\rd\r\ne')
    expect(state.doc.toString()).toBe('a\nb\nc\nd\ne')
    const next = state.update({
      changes: [
        { from: 3, insert: '\n' },
        { from: 5, to: 7 },
        { from: 8, insert: '\n' },
      ],
    }).state
    expect(next.doc.toString()).toBe('a\nb\n\nc\n\ne')
    // The new break after "b" copies its LF. Deleting "\nd" took the CR with it, so "c" ends with
    // the CRLF that ended "d". The new break before "e" copies the break before the last line.
    expect(saveRaw(next)).toBe('a\r\nb\n\nc\r\n\r\ne')
  })
})

describe('undo and redo bring back the endings of deleted breaks', () => {
  const raw = 'a\r\nb\nc\rd'

  it('puts a deleted LF back as LF when the join is undone, and takes it out again on redo', () => {
    const joined = openRaw(raw).update({ changes: { from: 3, to: 4 }, ...isolated }).state
    expect(saveRaw(joined)).toBe('a\r\nbc\rd')
    const back = undoOn(joined)
    expect(back && saveRaw(back)).toBe(raw)
    const again = back && redoOn(back)
    expect(again && saveRaw(again)).toBe('a\r\nbc\rd')
  })

  it('differs from typing the break again, which takes the ending of the line it lands in', () => {
    const joined = openRaw(raw).update({ changes: { from: 3, to: 4 } }).state
    const typed = joined.update({ changes: { from: 3, insert: '\n' } }).state
    expect(saveRaw(typed)).toBe('a\r\nb\rc\rd')
  })

  it('restores every break a deletion across several lines removed, each its own ending', () => {
    const cut = openRaw(raw).update({ changes: { from: 1, to: 5 }, ...isolated }).state
    expect(saveRaw(cut)).toBe('a\rd')
    const back = undoOn(cut)
    expect(back && saveRaw(back)).toBe(raw)
  })

  it('restores them when a replacement that adds breaks is undone', () => {
    const next = openRaw(raw).update({
      changes: { from: 1, to: 4, insert: '\n\n\n\n' },
      ...isolated,
    }).state
    expect(next.doc.toString()).toBe('a\n\n\n\nc\nd')
    expect(saveRaw(next)).toBe('a\r\n\r\n\r\n\r\nc\rd')
    const back = undoOn(next)
    expect(back && saveRaw(back)).toBe(raw)
    const forward = back && redoOn(back)
    expect(forward && saveRaw(forward)).toBe(saveRaw(next))
  })

  it('restores them through several steps, one after the other', () => {
    let state = openRaw(raw)
    const saves = [saveRaw(state)]
    for (const changes of [
      { from: 1, to: 2 },
      { from: 2, to: 4 },
      { from: 0, insert: 'x\n' },
    ]) {
      state = state.update({ changes, ...isolated }).state
      saves.push(saveRaw(state))
    }
    for (let i = saves.length - 2; i >= 0; i--) {
      state = undoOn(state) ?? state
      expect(saveRaw(state)).toBe(saves[i])
    }
    for (let i = 1; i < saves.length; i++) {
      state = redoOn(state) ?? state
      expect(saveRaw(state)).toBe(saves[i])
    }
  })
})

describe('moving text keeps the endings of the breaks inside it', () => {
  const raw = 'one\r\ntwo\nthree\rfour\r\nfive'

  const partsOf = (tr: Transaction): { from: number; to: number; insert: string }[] => {
    const found: { from: number; to: number; insert: string }[] = []
    tr.changes.iterChanges((from, to, _a, _b, inserted) => {
      found.push({ from, to, insert: inserted.toString() })
    })
    return found
  }

  it('pins the shape the drag makes: one deletion and one insertion of the same text', () => {
    // The field recognizes a move by this shape. If `moveSelectedText` ever changes it, this fails
    // before moved text starts taking its neighbour's endings.
    for (const [from, to, drop] of [
      [4, 13, 18],
      [8, 18, 4],
      [0, 3, 8],
      [4, 8, 22],
    ] as const) {
      const state = select(openRaw(raw), from, to)
      const spec = moveSelectedText(state, drop)
      expect(spec).not.toBeNull()
      const found = partsOf(state.update(spec ?? {}))
      expect(found).toHaveLength(2)
      expect(found.find((p) => p.to > p.from)).toEqual({ from, to, insert: '' })
      expect(found.find((p) => p.to === p.from)).toEqual({
        from: drop,
        to: drop,
        insert: state.sliceDoc(from, to),
      })
    }
  })

  it('carries the ending of a break moved down, and undo and redo move it back and forth', () => {
    const state = select(openRaw(raw), 4, 13)
    const moved = state.update({ ...moveSelectedText(state, 18), ...isolated }).state
    expect(moved.doc.toString()).toBe('one\n\nfourtwo\nthree\nfive')
    // The LF between "two" and "three" travels with them. The CR that ended "three" now ends the
    // empty line left behind, and the CRLF that ended "four" now ends the moved "three".
    expect(saveRaw(moved)).toBe('one\r\n\rfourtwo\nthree\r\nfive')
    const back = undoOn(moved)
    expect(back && saveRaw(back)).toBe(raw)
    const again = back && redoOn(back)
    expect(again && saveRaw(again)).toBe(saveRaw(moved))
  })

  it('carries the ending of a break moved up', () => {
    const state = select(openRaw(raw), 8, 18)
    const moved = state.update({ ...moveSelectedText(state, 4), ...isolated }).state
    expect(moved.doc.toString()).toBe('one\nthree\nfourtwo\n\nfive')
    expect(saveRaw(moved)).toBe('one\r\nthree\rfourtwo\n\r\nfive')
    const back = undoOn(moved)
    expect(back && saveRaw(back)).toBe(raw)
  })

  it('moves text with no break in it without touching any ending', () => {
    const state = select(openRaw(raw), 0, 3)
    const moved = state.update(moveSelectedText(state, 8) ?? {}).state
    expect(moved.doc.toString()).toBe('\ntwo\nonethree\nfour\nfive')
    expect(endingsOf(moved)).toEqual(endingsOf(state))
  })

  it('treats any one deletion and one insertion of the same text as a move', () => {
    const moved = openRaw(raw).update({
      changes: [
        { from: 4, to: 13 },
        { from: 18, insert: 'two\nthree' },
      ],
    }).state
    expect(saveRaw(moved)).toBe('one\r\n\rfourtwo\nthree\r\nfive')
  })

  it('treats a change that only looks like a move as an ordinary edit', () => {
    // The text that goes in is not the text that went out, so no ending travels with it.
    const edited = openRaw(raw).update({
      changes: [
        { from: 4, to: 13 },
        { from: 18, insert: 'two\nthrEe' },
      ],
    }).state
    expect(saveRaw(edited)).toBe('one\r\n\rfourtwo\r\nthrEe\r\nfive')
  })
})

/** A small seeded generator, so a failing run replays. */
function lcg(seed: number): (n: number) => number {
  let state = seed
  return (n) => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return Math.floor((state / 4294967296) * n)
  }
}

/**
 * The reference: one item per character of the text, and each line break remembers its ending.
 * Editing it is splicing an array, so there is little to get wrong.
 */
interface Item {
  readonly ch: string
  readonly end?: EndingCode
}

function modelOf(raw: string): { items: Item[]; dominant: EndingCode } {
  const { text, endings } = splitRaw(raw)
  let breaks = 0
  const items = [...text].map((ch): Item => {
    if (ch !== '\n') return { ch }
    const index = endings.at.indexOf(breaks++)
    return { ch, end: index >= 0 ? (endings.codes[index] ?? endings.dominant) : endings.dominant }
  })
  return { items, dominant: endings.dominant }
}

const rawOfModel = (items: readonly Item[], dominant: EndingCode): string =>
  items.map((item) => (item.ch === '\n' ? ENDING_TEXT[item.end ?? dominant] : item.ch)).join('')

interface Edit {
  readonly from: number
  readonly to: number
  readonly insert: string
}

/** Applies edits, given in the positions of the text before any of them. */
function editModel(items: readonly Item[], dominant: EndingCode, edits: readonly Edit[]): Item[] {
  const next = items.slice()
  for (const { from, to, insert } of [...edits].reverse()) {
    // A new break takes the ending of the break that ends the line the edit starts on, or of the
    // last break before it when that line is the last one.
    const ahead = items.findIndex((item, i) => i >= from && item.ch === '\n')
    const behind = items.findLastIndex((item, i) => i < from && item.ch === '\n')
    const source = ahead >= 0 ? ahead : behind
    const inherited = source >= 0 ? (items[source]?.end ?? dominant) : dominant
    next.splice(
      from,
      to - from,
      ...[...insert].map((ch): Item => (ch === '\n' ? { ch, end: inherited } : { ch })),
    )
  }
  return next
}

function moveModel(items: readonly Item[], from: number, to: number, at: number): Item[] {
  const rest = [...items.slice(0, from), ...items.slice(to)]
  rest.splice(at > to ? at - (to - from) : at, 0, ...items.slice(from, to))
  return rest
}

/** The shape Rust refuses to join if it is wrong: ascending, in range, never the dominant one. */
function expectCanonical(endings: Endings, lines: number): void {
  expect(endings.at.length).toBe(endings.codes.length)
  endings.at.forEach((index, i) => {
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index).toBeLessThan(lines - 1)
    expect(endings.codes[i]).not.toBe(endings.dominant)
    if (i > 0) expect(index).toBeGreaterThan(endings.at[i - 1] ?? -1)
  })
}

describe('ISC-3: random edits against a reference model', () => {
  const pieces = ['a', 'bc', ' ', '#', '\n', '\r\n', '\r', 'text', '\n\n']
  const inserts = ['x', 'yz', '\n', '', ' ', 'a\nb', '\n\n', 'q\n']

  function randomRaw(below: (n: number) => number): string {
    let raw = ''
    for (let i = below(30); i > 0; i--) raw += pieces[below(pieces.length)] ?? ''
    return raw
  }

  it('keeps every byte outside each edit through 300 runs of 40 steps with undo and redo', () => {
    for (let run = 0; run < 300; run++) {
      const below = lcg(20_261_107 + run)
      const initial = randomRaw(below)
      const model = modelOf(initial)
      const dominant = model.dominant
      let items = model.items
      let state = openRaw(initial)
      interface Step {
        readonly raw: string
        readonly items: Item[]
      }
      const done: Step[] = []
      let undone: Step[] = []
      const label = `run ${run} from ${JSON.stringify(initial)}`

      const ops: string[] = []
      const commit = (what: unknown, next: EditorState, nextItems: Item[]): void => {
        ops.push(JSON.stringify(what))
        done.push({ raw: saveRaw(state), items })
        undone = []
        state = next
        items = nextItems
      }
      const pick = (): string => inserts[below(inserts.length)] ?? ''

      for (let step = 0; step < 40; step++) {
        const length = state.doc.length
        const roll = below(100)
        if (roll < 50) {
          const from = below(length + 1)
          const edit = { from, to: Math.min(length, from + below(6)), insert: pick() }
          if (edit.from === edit.to && edit.insert === '') continue
          const next = state.update({ changes: edit, ...isolated }).state
          commit(edit, next, editModel(items, dominant, [edit]))
        } else if (roll < 65) {
          // Two changes in one transaction, with a character between them.
          if (length < 4) continue
          const a = below(length - 2)
          const b = a + below(Math.min(3, length - a - 2))
          const c = b + 1 + below(length - b - 1)
          const first = { from: a, to: b, insert: pick() }
          const second = { from: c, to: Math.min(length, c + below(4)), insert: pick() }
          // One deletion and one insertion of the same text is a move to the field (tested above),
          // so a random pair that happens to look like one is not an ordinary two-change edit.
          const [cut, put] = first.insert === '' ? [first, second] : [second, first]
          if (
            cut.from < cut.to &&
            cut.insert === '' &&
            put.from === put.to &&
            put.insert === state.sliceDoc(cut.from, cut.to)
          ) {
            continue
          }
          const next = state.update({ changes: [first, second], ...isolated }).state
          commit([first, second], next, editModel(items, dominant, [first, second]))
        } else if (roll < 78) {
          // Drag a selection somewhere outside itself, the way the pointer drag does.
          if (length < 3) continue
          const from = below(length - 1)
          const to = from + 1 + below(Math.min(12, length - from))
          const drop = below(length + 1)
          const selected = select(state, from, to)
          const spec = moveSelectedText(selected, drop)
          if (spec === null) continue
          const moved = selected.update({ ...spec, ...isolated }).state
          commit({ move: [from, to, drop] }, moved, moveModel(items, from, to, drop))
        } else if (roll < 90) {
          const back = undoOn(state)
          const target = done.pop()
          if (target === undefined) {
            expect(back, label).toBeNull()
            continue
          }
          expect(back, label).not.toBeNull()
          undone.push({ raw: saveRaw(state), items })
          state = back ?? state
          items = target.items
          expect(saveRaw(state), `${label}, step ${step}, undo`).toBe(target.raw)
        } else {
          const forward = redoOn(state)
          const target = undone.pop()
          if (target === undefined) {
            expect(forward, label).toBeNull()
            continue
          }
          expect(forward, label).not.toBeNull()
          done.push({ raw: saveRaw(state), items })
          state = forward ?? state
          items = target.items
          expect(saveRaw(state), `${label}, step ${step}, redo`).toBe(target.raw)
        }
        expect(saveRaw(state), `${label}, step ${step} after ${ops.join(' ; ')}`).toBe(
          rawOfModel(items, dominant),
        )
        expectCanonical(endingsOf(state), state.doc.lines)
      }

      // Undoing everything gives back the file as it was opened, byte for byte, and redoing
      // everything gives back where the run ended.
      const top = saveRaw(state)
      const count = done.length
      for (let i = 0; i < count; i++) state = undoOn(state) ?? state
      expect(saveRaw(state), label).toBe(initial)
      for (let i = 0; i < count; i++) state = redoOn(state) ?? state
      expect(saveRaw(state), label).toBe(top)
    }
  })

  it('agrees with join and split for any raw text', () => {
    const below = lcg(7)
    for (let i = 0; i < 500; i++) {
      const raw = randomRaw(below)
      const { text, endings } = splitRaw(raw)
      const model = modelOf(raw)
      expect(joinRaw(text, endings), JSON.stringify(raw)).toBe(raw)
      expect(rawOfModel(model.items, model.dominant), JSON.stringify(raw)).toBe(raw)
    }
  })
})
