// @vitest-environment jsdom
/**
 * The parity table (tests/fixtures/search-parity.json) through Find in a file. Folder search runs
 * the same rows in Rust (`search::tests::the_parity_table_agrees_with_find`), so a row that one
 * engine changes and the other does not fails a test on one side. A row with a `rust` list is a
 * known difference, and the list is what Rust gives there.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getSearchQuery } from '@codemirror/search'
import { describe, expect, it } from 'vitest'
import { createState } from '@/editor/create'
import { EMPTY_FIND, findEffect, type FindSpec } from '@/editor/find'

interface Case {
  name: string
  text: string
  query: string
  regexp?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  matches: [number, number, number][]
  rust?: [number, number, number][]
}

const cases = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/search-parity.json'), 'utf8'),
) as Case[]

function found(entry: Case): [number, number, number][] {
  const spec: FindSpec = {
    ...EMPTY_FIND,
    search: entry.query,
    regexp: entry.regexp ?? false,
    caseSensitive: entry.caseSensitive ?? false,
    wholeWord: entry.wholeWord ?? false,
  }
  const base = createState(entry.text, [], { parser: false })
  const state = base.update({ effects: findEffect(spec) }).state
  const out: [number, number, number][] = []
  const cursor = getSearchQuery(state).getCursor(state)
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    const { from, to } = step.value
    if (from === to) continue
    const line = state.doc.lineAt(from)
    out.push([line.number, from - line.from, to - line.from])
  }
  return out
}

describe('the parity table through Find in a file', () => {
  it('has the rows the Rust side counts on', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20)
    expect(cases.filter((entry) => entry.rust !== undefined)).toHaveLength(2)
  })

  for (const entry of cases) {
    it(entry.name, () => {
      expect(found(entry)).toEqual(entry.matches)
    })
  }
})
