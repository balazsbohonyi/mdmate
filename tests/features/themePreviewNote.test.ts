/**
 * The sample note of the Theme preview (ISC-518): one of everything the editor draws, so a color
 * has something to land on wherever it is used. The tree is the app's own Markdown parse.
 */
import { syntaxTree } from '@codemirror/language'
import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { frontmatterEnd } from '@/editor/livePreview/frontmatter'
import {
  PREVIEW_FIND,
  PREVIEW_MISSING,
  PREVIEW_NOTE,
  previewSelection,
} from '@/features/themes/preview/previewNote'
import { stateOf } from '../helpers/preview'

const state = stateOf(PREVIEW_NOTE, 0)

/** How many nodes of each name the note's tree has, and the text of each. */
function nodes(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  syntaxTree(state).iterate({
    enter: (node) => {
      const list = found.get(node.name) ?? []
      list.push(state.doc.sliceString(node.from, node.to))
      found.set(node.name, list)
    },
  })
  return found
}

const tree = nodes()
const count = (name: string): number => tree.get(name)?.length ?? 0

describe('the sample note has one of everything the editor draws (ISC-518)', () => {
  it('starts with front matter the editor draws as a block, before the first heading', () => {
    const end = frontmatterEnd(Text.of(PREVIEW_NOTE.split('\n')))
    expect(end).not.toBeNull()
    expect(PREVIEW_NOTE.slice(0, end ?? 0)).toContain('title: Tidewatch')
    expect(PREVIEW_NOTE.indexOf('# Tidewatch')).toBeGreaterThan(end ?? Infinity)
  })

  it('has headings of every level, 1 to 6', () => {
    for (let level = 1; level <= 6; level++) {
      expect(count(`ATXHeading${String(level)}`), `heading ${String(level)}`).toBeGreaterThan(0)
    }
  })

  it('has bold, italic, strikethrough and inline code', () => {
    expect(count('StrongEmphasis')).toBeGreaterThan(0)
    expect(count('Emphasis')).toBeGreaterThan(0)
    expect(count('Strikethrough')).toBeGreaterThan(0)
    expect(count('InlineCode')).toBeGreaterThan(0)
  })

  it('has a link to a file that is there and one to a file that is not', () => {
    const urls = tree.get('URL') ?? []
    expect(urls).toContain('notes/roadmap.md')
    expect(urls).toContain(PREVIEW_MISSING)
    expect(PREVIEW_MISSING).not.toBe('notes/roadmap.md')
  })

  it('has a picture', () => {
    expect(count('Image')).toBeGreaterThan(0)
  })

  it('has fenced code in at least five languages, each named', () => {
    const infos = (tree.get('CodeInfo') ?? []).map((info) => info.trim().toLowerCase())
    expect(new Set(infos).size).toBeGreaterThanOrEqual(5)
    expect(count('FencedCode')).toBe(infos.length)
    for (const language of ['bash', 'ts', 'json', 'rust', 'html']) expect(infos).toContain(language)
  })

  it('has a quote, nested lists in both kinds, and a rule', () => {
    expect(count('Blockquote')).toBeGreaterThan(0)
    expect(count('BulletList')).toBeGreaterThan(1)
    expect(count('OrderedList')).toBeGreaterThan(1)
    expect(count('HorizontalRule')).toBeGreaterThan(0)
  })

  it('has a task list with a checked and an unchecked box', () => {
    const boxes = (tree.get('TaskMarker') ?? []).map((box) => box.toLowerCase())
    expect(boxes).toContain('[x]')
    expect(boxes).toContain('[ ]')
  })

  it('has a table with a header and rows', () => {
    expect(count('Table')).toBe(1)
    expect(count('TableHeader')).toBe(1)
    expect(count('TableRow')).toBeGreaterThanOrEqual(2)
  })
})

describe('the selection and the find match the preview starts with (ISC-521)', () => {
  const selection = previewSelection()

  it('has three ranges, in document order: the current find match, some words, and a caret', () => {
    expect(selection.ranges).toHaveLength(3)
    const [match, words, caret] = selection.ranges
    expect(state.doc.sliceString(words?.from ?? 0, words?.to ?? 0)).toBe('keeps them on disk')
    expect(state.doc.sliceString(match?.from ?? 0, match?.to ?? 0).toLowerCase()).toBe(PREVIEW_FIND)
    expect(caret?.empty).toBe(true)
  })

  it('puts the main range on the find match, so it is the current one', () => {
    const main = selection.main
    expect(state.doc.sliceString(main.from, main.to).toLowerCase()).toBe(PREVIEW_FIND)
  })

  it('has more than one match of the query, so there are matches that are not the current one', () => {
    const matches = PREVIEW_NOTE.toLowerCase().split(PREVIEW_FIND).length - 1
    expect(matches).toBeGreaterThan(2)
  })

  it('keeps the three ranges apart, with nothing drawn around the words and the caret', () => {
    const [, words, caret] = selection.ranges
    // Plain prose: the line holds no mark that would be shown when a range touches it.
    const lineOf = (at: number): string => state.doc.lineAt(at).text
    expect(lineOf(words?.from ?? 0)).toMatch(/^Tidewatch reads the tide tables once/)
    expect(lineOf(caret?.from ?? 0)).toMatch(/^Tidewatch reads the tide tables once/)
    expect(lineOf(words?.from ?? 0)).not.toMatch(/[*_`[\]~]/)
  })
})
