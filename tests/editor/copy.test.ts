/**
 * ISC-62: copying a selection copies raw Markdown, byte for byte. Hidden syntax is still in the
 * text, so it comes along; and the editor text holds `\n` only, so the line endings the file had
 * come back from the document's endings. The reference is the raw bytes of the fixtures.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { Document } from '@/documents/document'
import type { Follower } from '@/documents/follower'
import { withSourceEndings } from '@/editor/sourceCopy'
import { CR, CRLF, LF, type EndingCode, type Endings } from '@/lib/endings'
import type { OpenedFile } from '@/platform'

/** The editor text of a raw file (every break `\n`), its endings, and where each position was. */
function split(raw: string): { text: string; endings: Endings; offsets: number[] } {
  const codes: EndingCode[] = []
  const offsets: number[] = [] // offsets[i] is the raw offset of text position i
  let text = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    offsets.push(i)
    if (ch === '\r' && raw[i + 1] === '\n') {
      codes.push(CRLF)
      text += '\n'
      i++
    } else if (ch === '\r') {
      codes.push(CR)
      text += '\n'
    } else if (ch === '\n') {
      codes.push(LF)
      text += '\n'
    } else {
      text += ch
    }
  }
  offsets.push(raw.length)
  const counts = [0, 0, 0]
  for (const code of codes) counts[code] = (counts[code] ?? 0) + 1
  const dominant = counts.indexOf(Math.max(...counts)) as EndingCode
  const at: number[] = []
  const exceptions: EndingCode[] = []
  codes.forEach((code, index) => {
    if (code === dominant) return
    at.push(index)
    exceptions.push(code)
  })
  return { text, endings: { dominant, at, codes: exceptions }, offsets }
}

function open(text: string, endings: Endings): Document {
  const opened: OpenedFile = {
    id: 1,
    path: '/t/a.md',
    name: 'a.md',
    encoding: 'utf-8',
    bom: false,
    readOnly: null,
    size: text.length,
    hash: '0'.repeat(32),
    kind: 'markdown',
    text,
    endings,
  }
  return new Document(opened, () => undefined)
}

/** What the page puts on the clipboard for the follower's selection: CodeMirror's text, filtered. */
function copied(follower: Follower, from: number, to: number): string {
  follower.dispatch({ selection: EditorSelection.single(from, to) })
  const state = follower.state
  const plain = state.sliceDoc(from, to)
  return state
    .facet(EditorView.clipboardOutputFilter)
    .reduce((text, filter) => filter(text, state), plain)
}

/** A repeatable stream of numbers in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('copy hands over the bytes the file has', () => {
  const dir = join(__dirname, '..', 'fixtures')

  it.each(['lf.md', 'crlf.md', 'mixed-eol.md'])(
    'returns the raw bytes for 300 seeded selections of %s, hidden syntax included',
    (name) => {
      const raw = readFileSync(join(dir, name), 'utf8')
      const { text, endings, offsets } = split(raw)
      const follower = open(text, endings).followerFor('a')
      const next = seeded(42 + name.length)
      let withBreaks = 0
      let withSyntax = 0
      for (let i = 0; i < 300; i++) {
        const a = Math.floor(next() * (text.length + 1))
        const length = Math.floor(next() * (next() < 0.5 ? 40 : 600))
        const from = a
        const to = Math.min(text.length, a + length)
        if (from === to) continue
        const expected = raw.slice(offsets[from], offsets[to])
        expect(copied(follower, from, to), `${name} ${String(from)}-${String(to)}`).toBe(expected)
        if (text.slice(from, to).includes('\n')) withBreaks++
        if (/[*_`~[\]]/.test(expected)) withSyntax++
      }
      // The sample must exercise what the claim is about.
      expect(withBreaks).toBeGreaterThan(100)
      expect(withSyntax).toBeGreaterThan(100)
    },
  )

  it('mixed-eol.md really does mix its endings', () => {
    const { endings } = split(readFileSync(join(dir, 'mixed-eol.md'), 'utf8'))
    expect(endings.at.length).toBeGreaterThan(0)
  })

  it('gives each break its own ending across hidden syntax, including a lone CR', () => {
    const raw = 'a **b**\r\nc `d`\nlink [x](u)\re\r\n'
    const { text, endings } = split(raw)
    const follower = open(text, endings).followerFor('a')
    const from = text.indexOf('**')
    const to = text.indexOf('(u)') + 3
    expect(copied(follower, from, to)).toBe('**b**\r\nc `d`\nlink [x](u)')
    expect(copied(follower, 0, text.length)).toBe(raw)
    // A selection that starts after the first break takes the second break's ending, not the first's.
    expect(copied(follower, text.indexOf('c'), text.indexOf('e'))).toBe('c `d`\nlink [x](u)\r')
  })

  it('copies the line under the caret when nothing is selected', () => {
    const raw = 'one\r\n**two**\r\nthree'
    const { text, endings } = split(raw)
    const follower = open(text, endings).followerFor('a')
    follower.dispatch({ selection: { anchor: text.indexOf('two') } })
    const state = follower.state
    const filters = state.facet(EditorView.clipboardOutputFilter)
    expect(filters.reduce((t, filter) => filter(t, state), '**two**')).toBe('**two**')
  })

  it('leaves text alone that another filter already changed', () => {
    const { text, endings } = split('a\r\nb\r\nc')
    const follower = open(text, endings).followerFor('a')
    follower.dispatch({ selection: EditorSelection.single(0, text.length) })
    expect(withSourceEndings(follower.state, endings, 'changed')).toBe('changed')
  })

  it('does not change the document or its selection', () => {
    const raw = 'a\r\nb\rc\n'
    const { text, endings } = split(raw)
    const doc = open(text, endings)
    const follower = doc.followerFor('a')
    copied(follower, 0, text.length)
    expect(doc.master.doc.toString()).toBe(text)
    expect(doc.dirty).toBe(false)
  })
})
