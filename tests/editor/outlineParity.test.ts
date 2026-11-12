/**
 * The parity table (tests/fixtures/outline-parity.json) through the editor's own heading scan.
 * The outline panel reads headings in Rust, from the same table
 * (`outline::tests::the_parity_table_agrees_with_the_editors_scan`), so a rule that one side changes
 * and the other does not fails a test on one side.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { scanHeadings } from '@/editor/headingSlug'

interface Case {
  name: string
  text: string
  headings: [number, number, string][]
}

const cases = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/outline-parity.json'), 'utf8'),
) as Case[]

describe('the heading scan, against the table Rust runs too', () => {
  it('has a case for each rule', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20)
  })

  for (const entry of cases) {
    it(entry.name, () => {
      const doc = Text.of(entry.text.split(/\r\n?|\n/))
      const found = scanHeadings(doc).map((h) => [h.level, h.line, h.text])
      expect(found).toEqual(entry.headings)
    })
  }

  it('a heading starts at the start of its line', () => {
    const doc = Text.of(['intro', '# one', 'Two', '---'])
    expect(scanHeadings(doc).map((h) => [h.from, doc.line(h.line).from])).toEqual([
      [6, 6],
      [12, 12],
    ])
  })
})
