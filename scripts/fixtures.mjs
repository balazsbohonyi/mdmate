#!/usr/bin/env node
/**
 * Generates tests/fixtures/ from nothing but this script. The output is deterministic: a seeded
 * random generator and no clock, so every run produces the same bytes.
 *
 *   node scripts/fixtures.mjs                 write to tests/fixtures/
 *   node scripts/fixtures.mjs --out <dir>     write somewhere else (the tests do this)
 *
 * Small fixtures land in <out>/ and are committed. The large ones land in <out>/generated/, which
 * git ignores. `.gitattributes` marks the whole folder `-text`, so git never rewrites a byte.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIB = 1024 * 1024

/** mulberry32: a tiny seeded generator, good enough for fixture text. */
function makeRng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)] ?? list[0],
    chance: (p) => next() < p,
  }
}

const WORDS = (
  'the of and to in is you that it he was for on are as with his they at be this from have or by ' +
  'one had not but what all were when we there can an your which their said if do will each about ' +
  'how up out them then she many some so these would other into has more her two like him see time ' +
  'could no make than first been its who now people my made over did down only way find use may ' +
  'water long little very after words called just where most know get through back much before ' +
  'go good new write our used me man too any day same right look think also around another came ' +
  'come work three word must because does part even place well such here take why help put years ' +
  'different away again off went old number great tell men say small every found still between ' +
  'name should home big give air line set own under read last never us left end along while might ' +
  'next sound below saw something thought both few those always looked show large often together ' +
  'asked house world going want school important until form food keep children feet land side ' +
  'without boy once animal life enough took sometimes four head above kind began almost live page ' +
  'got earth need far hand high year mother light country father let night picture being study ' +
  'second soon story since white ever paper hard near sentence better best across during today ' +
  'however sure knew try told young sun thing whole hear example heard several change answer room ' +
  'sea against top turned learn point city play toward five using himself usually'
).split(' ')

const NON_ASCII = [
  'café',
  'naïve',
  'Zürich',
  'São Paulo',
  'Åre',
  '€5',
  '—',
  '“quoted”',
  '日本語',
  '中文',
  '😀',
  'Ελληνικά',
]
const LATIN1_ONLY = ['café', 'naïve', 'Zürich', 'Åre', '£5', '¥10', 'señor', 'straße', '©', 'ñ']

function sentence(rng, accents) {
  const n = rng.int(6, 16)
  const parts = []
  for (let i = 0; i < n; i++) {
    let word = rng.pick(WORDS)
    const r = rng.next()
    if (r < 0.04) word = `**${word}**`
    else if (r < 0.07) word = `*${word}*`
    else if (r < 0.09) word = `\`${word}()\``
    else if (r < 0.1) word = `~~${word}~~`
    else if (r < 0.13) word = `[${word}](notes/${rng.pick(WORDS)}.md)`
    else if (r < 0.14) word = `[${word}][${rng.int(1, 9)}]`
    else if (r < 0.15) word = '<https://example.com/page>'
    else if (accents.length > 0 && r < 0.17) word = rng.pick(accents)
    parts.push(word)
  }
  const text = parts.join(' ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

function paragraph(rng, accents) {
  const n = rng.int(2, 6)
  return Array.from({ length: n }, () => sentence(rng, accents)).join(' ')
}

function heading(rng, level) {
  const n = rng.int(1, 5)
  const words = Array.from({ length: n }, () => rng.pick(WORDS))
  const text = words.join(' ')
  return `${'#'.repeat(level)} ${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

function list(rng, accents) {
  const kind = rng.int(0, 2)
  const items = rng.int(3, 8)
  const lines = []
  for (let i = 0; i < items; i++) {
    const marker =
      kind === 0 ? '-' : kind === 1 ? `${String(i + 1)}.` : rng.chance(0.5) ? '- [x]' : '- [ ]'
    lines.push(`${marker} ${sentence(rng, accents)}`)
    if (rng.chance(0.3)) lines.push(`    - ${sentence(rng, accents)}`)
  }
  return lines.join('\n')
}

function smallTable(rng, accents) {
  const cols = rng.int(2, 5)
  const rows = rng.int(2, 6)
  const head = Array.from({ length: cols }, () => rng.pick(WORDS))
  const align = Array.from({ length: cols }, () => rng.pick([':---', '---:', ':---:', '---']))
  const body = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () =>
      rng.chance(0.2) ? sentence(rng, accents).slice(0, 30) : rng.pick(WORDS),
    ),
  )
  return [head, align, ...body].map((r) => `| ${r.join(' | ')} |`).join('\n')
}

const CODE_LANGS = ['js', 'ts', 'rust', 'python', 'json', 'css', 'html', 'bash']

function codeLine(rng, lang) {
  const a = rng.pick(WORDS)
  const b = rng.pick(WORDS)
  const n = rng.int(0, 999)
  switch (lang) {
    case 'js':
    case 'ts':
      return rng.chance(0.5)
        ? `const ${a}_${b} = ${String(n)}`
        : `export function ${a}(${b}) { return ${b} + ${String(n)} }`
    case 'rust':
      return rng.chance(0.5)
        ? `let ${a}_${b}: u32 = ${String(n)};`
        : `pub fn ${a}(${b}: &str) -> usize { ${b}.len() + ${String(n)} }`
    case 'python':
      return rng.chance(0.5)
        ? `${a}_${b} = ${String(n)}`
        : `def ${a}(${b}): return ${b} + ${String(n)}`
    case 'json':
      return `  { "${a}": "${b}", "n": ${String(n)} },`
    case 'css':
      return `.${a}-${b} { margin: ${String(n % 40)}px; padding: ${String(n % 12)}px }`
    case 'html':
      return `<div class="${a}"><span>${b}</span></div>`
    default:
      return `echo "${a} ${b}" >> out_${String(n)}.txt`
  }
}

function codeBlock(rng, lines, lang = rng.pick(CODE_LANGS)) {
  const body = Array.from({ length: lines }, () => codeLine(rng, lang))
  return ['```' + lang, ...body, '```'].join('\n')
}

function frontmatter(rng) {
  return [
    '---',
    `title: ${sentence(rng, []).replace(/[*`[\]()~<>:]/g, '')}`,
    'tags: [notes, fixture]',
    'draft: false',
    '---',
  ].join('\n')
}

function referenceDefinitions() {
  return Array.from(
    { length: 9 },
    (_, i) => `[${String(i + 1)}]: https://example.com/ref/${String(i + 1)}`,
  ).join('\n')
}

/** Markdown with the structure real notes have, grown until it reaches `bytes`. */
function realisticDocument({ seed, bytes, accents = NON_ASCII }) {
  const rng = makeRng(seed)
  const blocks = [frontmatter(rng), heading(rng, 1)]
  let size = 0
  while (size < bytes) {
    const r = rng.next()
    let block
    if (r < 0.06) block = heading(rng, 2)
    else if (r < 0.1) block = heading(rng, 3)
    else if (r < 0.12) block = heading(rng, 4)
    else if (r < 0.5) block = paragraph(rng, accents)
    else if (r < 0.65) block = list(rng, accents)
    else if (r < 0.72) block = `> ${paragraph(rng, accents)}`
    else if (r < 0.8) block = codeBlock(rng, rng.int(3, 25))
    else if (r < 0.85) block = smallTable(rng, accents)
    else if (r < 0.88) block = `![${rng.pick(WORDS)}](images/${rng.pick(WORDS)}.png)`
    else if (r < 0.9) block = '---'
    else if (r < 0.92) block = referenceDefinitions()
    else block = paragraph(rng, accents)
    blocks.push(block)
    size += Buffer.byteLength(block) + 2
  }
  return `${blocks.join('\n\n')}\n`
}

/** Documents dominated by wide tables with alignment, formatting and escaped pipes. */
function tableHeavyDocument({ seed, bytes }) {
  const rng = makeRng(seed)
  const blocks = [heading(rng, 1)]
  let size = 0
  while (size < bytes) {
    const cols = rng.int(6, 24)
    const rows = rng.int(40, 300)
    const head = Array.from({ length: cols }, (_, i) => `${rng.pick(WORDS)}${String(i)}`)
    const align = Array.from({ length: cols }, () => rng.pick([':---', '---:', ':---:', '---']))
    const lines = [head, align]
    for (let r = 0; r < rows; r++) {
      lines.push(
        Array.from({ length: cols }, () => {
          const x = rng.next()
          if (x < 0.15) return `**${rng.pick(WORDS)}**`
          if (x < 0.25) return `\`${rng.pick(WORDS)} \\| ${rng.pick(WORDS)}\``
          if (x < 0.3) return `[${rng.pick(WORDS)}](notes/${rng.pick(WORDS)}.md)`
          if (x < 0.4) return sentence(rng, NON_ASCII)
          return String(rng.int(0, 99999))
        }),
      )
    }
    const table = lines.map((row) => `| ${row.join(' | ')} |`).join('\n')
    blocks.push(heading(rng, 2), paragraph(rng, NON_ASCII), table)
    size += Buffer.byteLength(table) + 400
  }
  return `${blocks.join('\n\n')}\n`
}

/** Documents dominated by fenced code, including blocks of thousands of lines. */
function codeHeavyDocument({ seed, bytes }) {
  const rng = makeRng(seed)
  const blocks = [heading(rng, 1)]
  let size = 0
  let big = 0
  while (size < bytes) {
    const lines = big < 3 && rng.chance(0.02) ? rng.int(5000, 20000) : rng.int(10, 300)
    if (lines >= 5000) big++
    const block = codeBlock(rng, lines)
    blocks.push(heading(rng, 2), paragraph(rng, NON_ASCII), block)
    size += Buffer.byteLength(block) + 400
  }
  return `${blocks.join('\n\n')}\n`
}

const toCrlf = (text) => text.replace(/\n/g, '\r\n')

/** LF and CRLF in runs, so the file holds both and never loses one to a lucky draw. */
function mixedEndings(text, seed) {
  const rng = makeRng(seed)
  let crlf = false
  return text
    .split('\n')
    .map((line, i, all) => {
      if (i === all.length - 1) return line
      if (rng.chance(0.2)) crlf = !crlf
      return `${line}${crlf ? '\r\n' : '\n'}`
    })
    .join('')
}

const HOSTILE = `# Hostile fixture

Opening this file must run no code, launch no program and contact no host. Every address here is
reserved for examples (\`.invalid\`, \`example.com\`) or a harmless placeholder.

## Script and event attributes

<script>document.title = 'script ran'</script>

<img src="x" onerror="document.title = 'onerror ran'">

<a href="#" onclick="document.title = 'onclick ran'">click me</a>

<svg onload="document.title = 'svg onload ran'"></svg>

<iframe src="https://example.invalid/frame"></iframe>

<object data="https://example.invalid/object"></object>

<form action="https://example.invalid/post"><input name="x"></form>

<meta http-equiv="refresh" content="0;url=https://example.invalid/redirect">

<style>@import url("https://example.invalid/style.css");</style>

<link rel="stylesheet" href="https://example.invalid/link.css">

## Protocol handlers

[ms-msdt](ms-msdt:/id/TestOnly)

[search-ms](search-ms:query=hostile&crumb=location:\\\\host.invalid\\share)

[javascript](javascript:alert(1))

[vbscript](vbscript:msgbox(1))

[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)

[file URL to a program](file:///C:/Windows/System32/calc.exe)

## Executable targets

[shortcut](installer.lnk)

[html application](payload.hta)

[batch file](run.bat)

[relative path out of the folder](..\\..\\Windows\\System32\\calc.exe)

## UNC and remote image paths

![unc backslashes](\\\\host.invalid\\share\\a.png)

![unc forward slashes](//host.invalid/share/a.png)

![file url with host](file://host.invalid/share/a.png)

![file url with four slashes](file:////host.invalid/share/a.png)

![unc in angle brackets](<\\\\host.invalid\\share\\with space.png>)

<img src="\\\\host.invalid\\share\\b.png">

![remote https image](https://example.invalid/pixel.png)

![remote http image](http://example.invalid/pixel.png)
`

const SMALL_BYTES = 24 * 1024
const ENCODING_BYTES = 6 * 1024

export function generate(out) {
  const files = new Map()
  const small = realisticDocument({ seed: 101, bytes: SMALL_BYTES })
  files.set('lf.md', Buffer.from(small, 'utf8'))
  files.set('crlf.md', Buffer.from(toCrlf(small), 'utf8'))
  files.set('mixed-eol.md', Buffer.from(mixedEndings(small, 202), 'utf8'))

  const unicode = realisticDocument({ seed: 303, bytes: ENCODING_BYTES })
  files.set(
    'utf8-bom.md',
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(unicode, 'utf8')]),
  )
  const le = Buffer.from(unicode, 'utf16le')
  files.set('utf16le.md', Buffer.concat([Buffer.from([0xff, 0xfe]), le]))
  files.set('utf16be.md', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(le).swap16()]))
  const latin1 = realisticDocument({ seed: 404, bytes: ENCODING_BYTES, accents: LATIN1_ONLY })
  files.set('latin1.md', Buffer.from(latin1, 'latin1'))
  files.set('hostile.md', Buffer.from(HOSTILE, 'utf8'))

  files.set(
    'generated/realistic-1mb.md',
    Buffer.from(realisticDocument({ seed: 1, bytes: MIB }), 'utf8'),
  )
  files.set(
    'generated/realistic-2mb.md',
    Buffer.from(realisticDocument({ seed: 2020, bytes: 2 * MIB }), 'utf8'),
  )
  files.set(
    'generated/realistic-3mb.md',
    Buffer.from(realisticDocument({ seed: 3030, bytes: 3 * MIB }), 'utf8'),
  )
  files.set(
    'generated/realistic-5mb.md',
    Buffer.from(realisticDocument({ seed: 5, bytes: 5 * MIB }), 'utf8'),
  )
  files.set(
    'generated/realistic-10mb.md',
    Buffer.from(realisticDocument({ seed: 10, bytes: 10 * MIB }), 'utf8'),
  )
  files.set(
    'generated/tables-heavy-1mb.md',
    Buffer.from(tableHeavyDocument({ seed: 2, bytes: MIB }), 'utf8'),
  )
  files.set(
    'generated/code-heavy-1mb.md',
    Buffer.from(codeHeavyDocument({ seed: 3, bytes: MIB }), 'utf8'),
  )

  for (const [rel, bytes] of files) {
    const path = join(out, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
  }
  return files
}

function main(argv) {
  let out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures')
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out = resolve(argv[++i] ?? out)
    else {
      console.error('usage: node scripts/fixtures.mjs [--out <dir>]')
      return 2
    }
  }
  for (const [rel, bytes] of generate(out)) {
    console.log(`${rel.padEnd(32)} ${String(bytes.length).padStart(10)} bytes`)
  }
  return 0
}

process.exitCode = main(process.argv.slice(2))
