import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const script = resolve(import.meta.dirname, '../../scripts/check-isa.mjs')
const repoIsa = resolve(import.meta.dirname, '../../ISA.md')
const temps: string[] = []

function run(args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

function runOn(content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'check-isa-'))
  temps.push(dir)
  const file = join(dir, 'ISA.md')
  writeFileSync(file, content)
  return run([file])
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

interface Parts {
  progress: string
  claims: string[]
  rows: string[]
}

const row = (id: string) => `| ${id} | bash | check ${id} | passes | pnpm test:web | literal | | |`

/** A small ISA that is consistent: 4 leaf claims, 1 closed, 1 container, 1 tombstone. */
const clean: Parts = {
  progress: '1/4',
  claims: [
    '- [x] ISC-1: closed leaf.',
    '- [ ] ISC-2: open leaf.',
    '- [ ] ISC-3: [container] parent of two.',
    '  - [ ] ISC-3.1: first child.',
    '  - [ ] ISC-3.2: second child.',
    '- [ ] ISC-9: [DROPPED — see Decisions 2026-11-07]',
  ],
  rows: ['ISC-1', 'ISC-2', 'ISC-3.1', 'ISC-3.2'].map(row),
}

function isa({ progress, claims, rows }: Parts, frontmatter = `progress: ${progress}`): string {
  return [
    '---',
    'phase: climbing',
    frontmatter,
    '---',
    '',
    '# Test ISA',
    '',
    '## Test Strategy',
    '',
    '| isc | type | check | threshold | tool | anchors_to | severity | tier |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    '## Features',
    '',
    '### F0 · Cross-cutting',
    'Why: a fixture.',
    '',
    ...claims,
    '',
    '## Decisions',
    '',
    '- a decision that mentions ISC-77: it is not a claim.',
    '',
  ].join('\n')
}

describe('check-isa', () => {
  it('passes a consistent ISA, ignoring containers and tombstones', () => {
    const result = runOn(isa(clean))
    expect(result.out).toContain('ok    check-isa: 4 leaf claims, 1 closed, 4 test rows')
    expect(result.status).toBe(0)
  })

  it('passes with CRLF line endings', () => {
    const result = runOn(isa(clean).replace(/\n/g, '\r\n'))
    expect(result.status).toBe(0)
  })

  it('passes on this repository ISA.md', () => {
    const result = run([repoIsa])
    expect(result.out).toContain('ok    check-isa')
    expect(result.status).toBe(0)
  })

  const planted: [string, Parts, string][] = [
    [
      'a wrong total in progress',
      { ...clean, progress: '1/5' },
      'progress total is 5 but ## Features has 4',
    ],
    [
      'a wrong closed count in progress',
      { ...clean, progress: '2/4' },
      'progress closed count is 2 but 1',
    ],
    [
      'a duplicate claim ID',
      { ...clean, progress: '1/4', claims: [...clean.claims, '- [ ] ISC-2: the same ID again.'] },
      'duplicate claim ID ISC-2',
    ],
    [
      'an orphan claim with no row',
      { ...clean, progress: '1/5', claims: [...clean.claims, '- [ ] ISC-5: nothing tests me.'] },
      'leaf claim ISC-5 has no Test Strategy row',
    ],
    [
      'an orphan row with no claim',
      { ...clean, rows: [...clean.rows, row('ISC-6')] },
      'Test Strategy row ISC-6 has no claim',
    ],
    [
      'a row for a container claim',
      { ...clean, rows: [...clean.rows, row('ISC-3')] },
      'belongs to a container claim',
    ],
    [
      'a row for a dropped claim',
      { ...clean, rows: [...clean.rows, row('ISC-9')] },
      'belongs to a dropped claim',
    ],
    [
      'a duplicate row',
      { ...clean, rows: [...clean.rows, row('ISC-1')] },
      'duplicate Test Strategy row ISC-1',
    ],
  ]

  it.each(planted)('fails on %s', (_label, parts, message) => {
    const result = runOn(isa(parts))
    expect(result.out).toContain('FAIL  check-isa')
    expect(result.out).toContain(message)
    expect(result.status).toBe(1)
  })

  it('fails when progress is missing', () => {
    const result = runOn(isa(clean, 'slug: x'))
    expect(result.out).toContain('no `progress: M/N`')
    expect(result.status).toBe(1)
  })

  it('fails when a section is missing', () => {
    const result = runOn(isa(clean).replace('## Features', '## Elsewhere'))
    expect(result.out).toContain('no `## Features` section')
    expect(result.status).toBe(1)
  })

  it('fails when the file does not exist', () => {
    expect(run([join(tmpdir(), 'no-such-isa.md')]).status).toBe(1)
  })
})
