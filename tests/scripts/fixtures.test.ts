import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const script = resolve(import.meta.dirname, '../../scripts/fixtures.mjs')
const committed = resolve(import.meta.dirname, '../fixtures')
const MIB = 1024 * 1024

const expected = [
  'lf.md',
  'crlf.md',
  'mixed-eol.md',
  'utf8-bom.md',
  'utf16le.md',
  'utf16be.md',
  'latin1.md',
  'hostile.md',
  'generated/realistic-1mb.md',
  'generated/realistic-2mb.md',
  'generated/realistic-3mb.md',
  'generated/realistic-5mb.md',
  'generated/realistic-10mb.md',
  'generated/tables-heavy-1mb.md',
  'generated/code-heavy-1mb.md',
]

const temps: string[] = []
let first = ''
let second = ''

function generate(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fixtures-'))
  temps.push(dir)
  const result = spawnSync(process.execPath, [script, '--out', dir], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`fixtures.mjs failed: ${result.stderr}`)
  return dir
}

const read = (name: string) => readFileSync(join(first, name))
const text = (name: string) => read(name).toString('utf8')
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).replace(/\\/g, '/'))
    .sort()
}

beforeAll(() => {
  first = generate()
  second = generate()
}, 60_000)

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

describe('fixtures.mjs', () => {
  it('produces every fixture the plan lists', () => {
    expect(filesUnder(first)).toEqual([...expected].sort())
  })

  it('is deterministic: two runs give identical bytes', () => {
    for (const name of expected) expect(sha(join(second, name)), name).toBe(sha(join(first, name)))
  })

  it('keeps the committed small fixtures in step with the generator', () => {
    const small = expected.filter((n) => !n.startsWith('generated/'))
    for (const name of small) expect(sha(join(committed, name)), name).toBe(sha(join(first, name)))
  })

  it('reaches the stated sizes', () => {
    const size = (name: string) => statSync(join(first, name)).size
    expect(size('generated/realistic-1mb.md')).toBeGreaterThanOrEqual(MIB)
    expect(size('generated/realistic-1mb.md')).toBeLessThan(1.1 * MIB)
    expect(size('generated/realistic-2mb.md')).toBeGreaterThanOrEqual(2 * MIB)
    expect(size('generated/realistic-2mb.md')).toBeLessThan(2.1 * MIB)
    expect(size('generated/realistic-3mb.md')).toBeGreaterThanOrEqual(3 * MIB)
    expect(size('generated/realistic-3mb.md')).toBeLessThan(3.1 * MIB)
    expect(size('generated/realistic-5mb.md')).toBeGreaterThanOrEqual(5 * MIB)
    expect(size('generated/realistic-5mb.md')).toBeLessThan(5.1 * MIB)
    expect(size('generated/realistic-10mb.md')).toBeGreaterThanOrEqual(10 * MIB)
    expect(size('generated/realistic-10mb.md')).toBeLessThan(10.2 * MIB)
    expect(size('generated/tables-heavy-1mb.md')).toBeGreaterThanOrEqual(MIB)
    expect(size('generated/code-heavy-1mb.md')).toBeGreaterThanOrEqual(MIB)
  })

  it('writes realistic structure into the 1 MB document', () => {
    const doc = text('generated/realistic-1mb.md')
    expect(doc.startsWith('---\n')).toBe(true)
    for (const level of ['# ', '## ', '### ', '#### ']) expect(doc).toContain(`\n${level}`)
    expect(doc).toMatch(/^\| .* \|$/m)
    expect(doc).toMatch(/^```[a-z]+$/m)
    expect(doc).toMatch(/^- \[x\] /m)
    expect(doc).toMatch(/^\d+\. /m)
    expect(doc).toMatch(/^> /m)
    expect(doc).toMatch(/\]\(notes\/[a-z]+\.md\)/)
    expect(doc).toMatch(/^\[1\]: https:\/\/example\.com\/ref\/1$/m)
    expect(doc).toMatch(/\P{ASCII}/u)
  })

  it('makes the table document mostly table rows, with aligned and escaped cells', () => {
    const lines = text('generated/tables-heavy-1mb.md').split('\n')
    const rows = lines.filter((l) => l.startsWith('| ')).length
    expect(rows / lines.length).toBeGreaterThan(0.5)
    expect(lines.some((l) => l.includes(' :---: '))).toBe(true)
    expect(lines.some((l) => l.includes(String.raw`\|`))).toBe(true)
  })

  it('makes the code document hold at least one fenced block of 5000 lines', () => {
    let longest = 0
    let open = -1
    text('generated/code-heavy-1mb.md')
      .split('\n')
      .forEach((line, i) => {
        if (!line.startsWith('```')) return
        if (open < 0) open = i
        else {
          longest = Math.max(longest, i - open - 1)
          open = -1
        }
      })
    expect(longest).toBeGreaterThanOrEqual(5000)
  })

  it('writes LF-only, CRLF-only and mixed line endings', () => {
    const lf = text('lf.md')
    expect(lf).not.toContain('\r')

    const crlf = text('crlf.md')
    expect(crlf.match(/\n/g)?.length).toBe(crlf.match(/\r\n/g)?.length)
    expect(crlf.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)

    const mixed = text('mixed-eol.md')
    expect(mixed.match(/\r\n/g)?.length ?? 0).toBeGreaterThan(20)
    expect(mixed.replace(/\r\n/g, '').match(/\n/g)?.length ?? 0).toBeGreaterThan(20)
    expect(mixed.replace(/\r\n/g, '')).not.toContain('\r')
  })

  it('writes the same text in UTF-8 with BOM, UTF-16 LE and UTF-16 BE', () => {
    const bom = read('utf8-bom.md')
    expect([...bom.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bom.subarray(3))
    expect(body).toMatch(/\P{ASCII}/u)

    const le = read('utf16le.md')
    expect([...le.subarray(0, 2)]).toEqual([0xff, 0xfe])
    expect(new TextDecoder('utf-16le').decode(le.subarray(2))).toBe(body)

    const be = read('utf16be.md')
    expect([...be.subarray(0, 2)]).toEqual([0xfe, 0xff])
    expect(new TextDecoder('utf-16be').decode(be.subarray(2))).toBe(body)
  })

  it('writes Latin-1 that is not valid UTF-8', () => {
    const latin1 = read('latin1.md')
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(latin1)).toThrow()
    expect(latin1.some((b) => b >= 0x80)).toBe(true)
    expect(new TextDecoder('latin1').decode(latin1)).toMatch(/café|naïve|Zürich/)
  })

  describe('hostile.md', () => {
    const hostile = () => text('hostile.md')

    it.each([
      ['a script tag', '<script>'],
      ['an event attribute', 'onerror='],
      ['a second event attribute', 'onclick='],
      ['an svg load handler', 'onload='],
      ['an ms-msdt link', '](ms-msdt:'],
      ['a search-ms link', '](search-ms:'],
      ['a javascript link', '](javascript:'],
      ['a .lnk target', '.lnk)'],
      ['a .hta target', '.hta)'],
      ['a backslash UNC image path', String.raw`![unc backslashes](\\host.invalid\share\a.png)`],
      ['a forward-slash UNC image path', '![unc forward slashes](//host.invalid/share/a.png)'],
      ['a file URL with a host', '![file url with host](file://host.invalid/share/a.png)'],
      ['a remote https image', '![remote https image](https://example.invalid/pixel.png)'],
    ])('holds %s', (_label, needle) => {
      expect(hostile()).toContain(needle)
    })

    it('names only reserved hosts, so opening it can reach no real machine', () => {
      const hosts = [...hostile().matchAll(/(?:https?|file):\/\/+([^/\s"')>]*)/g)].map(
        (m) => m[1] ?? '',
      )
      expect(hosts.length).toBeGreaterThan(5)
      for (const host of hosts) {
        // An empty host or a drive letter (file:///C:/...) is a local path, not a machine.
        if (host === '' || /^[A-Za-z]:$/.test(host)) continue
        expect(host, host).toMatch(/(^|\.)invalid$|^example\.com$/)
      }
    })
  })
})
