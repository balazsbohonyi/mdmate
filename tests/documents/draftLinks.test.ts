import { describe, expect, it } from 'vitest'
import cases from '../data/draft-links.json'
import { draftLinkUses, renameEdits, rewriteDraftLinks } from '@/documents/draftLinks'

interface Case {
  readonly name: string
  readonly text: string
  readonly renames: Record<string, string>
  readonly expected: string
  readonly used: readonly string[]
}

const shared = cases as readonly Case[]

describe('draft link rule shared with Rust (tests/data/draft-links.json)', () => {
  it('reads the shared cases', () => {
    expect(shared.length).toBeGreaterThanOrEqual(12)
  })

  for (const sample of shared) {
    it(sample.name, () => {
      const renames = new Map(Object.entries(sample.renames))
      expect(rewriteDraftLinks(sample.text, renames)).toBe(sample.expected)
      const used = draftLinkUses(sample.text, renames.keys()).map((use) => use.name)
      expect(used).toEqual(sample.used)
    })
  }
})

describe('rename edits', () => {
  it('are positions in the text that, applied from the end, give the rewritten text', () => {
    const text = '![a](assets/a.png) and <img src="assets/a.png"> and ![b](assets/b.png)'
    const renames = new Map([['a.png', 'a-2.png']])
    let applied = text
    for (const edit of renameEdits(text, renames).reverse()) {
      applied = applied.slice(0, edit.from) + edit.insert + applied.slice(edit.to)
    }
    expect(applied).toBe(rewriteDraftLinks(text, renames))
    expect(applied).toBe(
      '![a](assets/a-2.png) and <img src="assets/a-2.png"> and ![b](assets/b.png)',
    )
  })

  it('are none when there is nothing to rename', () => {
    expect(renameEdits('![a](assets/a.png)', new Map())).toEqual([])
    expect(renameEdits('![a](assets/a.png)', new Map([['a.png', 'a.png']]))).toEqual([])
  })
})

describe('rename edits into another folder (images.pasteFolder)', () => {
  const text =
    '![a](assets/a.png) and ![b](./assets/b.png) and <img src="assets/c.png"> and assets/a.png2'
  const renames = new Map([
    ['a.png', 'a.png'],
    ['b.png', 'b-2.png'],
  ])

  it('rewrites the whole link, even where the name stayed', () => {
    expect(rewriteDraftLinks(text, renames, 'media/img')).toBe(
      '![a](media/img/a.png) and ![b](./media/img/b-2.png) and <img src="assets/c.png"> and assets/a.png2',
    )
  })

  it('applies as positions from the end, the same as the text', () => {
    let applied = text
    for (const edit of renameEdits(text, renames, 'media/img').reverse()) {
      applied = applied.slice(0, edit.from) + edit.insert + applied.slice(edit.to)
    }
    expect(applied).toBe(rewriteDraftLinks(text, renames, 'media/img'))
  })

  it('changes nothing for a name that stayed when the folder stayed', () => {
    expect(rewriteDraftLinks(text, renames)).toBe(
      '![a](assets/a.png) and ![b](./assets/b-2.png) and <img src="assets/c.png"> and assets/a.png2',
    )
  })
})
