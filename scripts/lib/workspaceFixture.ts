/**
 * A large workspace of Markdown notes for the perf scenario `typing-during-scan` (P6-T6, ISC-129).
 * The output is deterministic: a seeded generator and no clock, so every run writes the same
 * bytes. It is kept out of `fixtures.mjs` on purpose: thousands of small files would slow the
 * fixture tests and the fixture list they pin.
 *
 * Layout: `<out>/area-00 .. area-79/note-000.md ..`, plus `<out>/target.md`. About a tenth of the
 * notes link to `target.md`, so renaming it makes the scan find real work to do. The links come
 * in the forms the scanner reads: inline, image, reference definition and HTML, with a
 * code fence now and then that holds a link-shaped line the scanner must skip.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const FOLDERS = 80
export const NOTES_PER_FOLDER = 100

interface Rng {
  next(): number
  int(min: number, max: number): number
  pick<T>(list: readonly T[]): T
  chance(p: number): boolean
}

function makeRng(seed: number): Rng {
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
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)] ?? (list[0] as T),
    chance: (p: number) => next() < p,
  }
}

const WORDS = (
  'the of and to in is that it was for on are as with they at be this from have or by one had not ' +
  'but what all were when we there can an your which their said if do will each about how up out ' +
  'them then many some so these would other into has more two like see time could make than first ' +
  'been its who now people made over did down only way find use may water long little very after ' +
  'words called just where most know get through back much before good new write our used take'
).split(' ')

const note = (folder: number, index: number): string =>
  `area-${String(folder).padStart(2, '0')}/note-${String(index).padStart(3, '0')}.md`

function sentence(rng: Rng): string {
  const words = Array.from({ length: rng.int(6, 16) }, () => rng.pick(WORDS))
  words[0] = (words[0] ?? '').replace(/^./, (c) => c.toUpperCase())
  return `${words.join(' ')}.`
}

/** The link text from the note at `from` (a path like `area-03/note-007.md`) to `to`. */
function relativeLink(from: string, to: string): string {
  const [fromFolder] = from.split('/')
  const [toFolder, toFile] = to.split('/')
  if (toFile === undefined) return `../${to}`
  return fromFolder === toFolder ? toFile : `../${toFolder}/${toFile}`
}

function link(rng: Rng, from: string, to: string): string {
  const target = relativeLink(from, to)
  switch (rng.int(0, 5)) {
    case 0:
      return `![figure](${target.replace(/\.md$/, '.png')})`
    case 1:
      return `<a href="${target}">${rng.pick(WORDS)}</a>`
    case 2:
      return `[${rng.pick(WORDS)}](<${target}#top>)`
    default:
      return `[${rng.pick(WORDS)} ${rng.pick(WORDS)}](${target})`
  }
}

function body(rng: Rng, path: string, isLinkedToTarget: boolean): string {
  const lines = [`# ${sentence(rng).slice(0, -1)}`, '']
  const paragraphs = rng.int(4, 9)
  const links = rng.int(3, 6)
  const defs: string[] = []
  for (let p = 0; p < paragraphs; p++) {
    const parts = Array.from({ length: rng.int(2, 4) }, () => sentence(rng))
    if (p < links) {
      const other = note(rng.int(0, FOLDERS - 1), rng.int(0, NOTES_PER_FOLDER - 1))
      parts.splice(rng.int(0, parts.length), 0, link(rng, path, other))
    }
    lines.push(parts.join(' '), '')
  }
  if (isLinkedToTarget) lines.push(`See also [the target](${relativeLink(path, 'target.md')}).`, '')
  if (rng.chance(0.15)) {
    lines.push('```', `[example](${relativeLink(path, 'target.md')})`, '```', '')
  }
  if (rng.chance(0.3)) {
    const other = note(rng.int(0, FOLDERS - 1), rng.int(0, NOTES_PER_FOLDER - 1))
    lines.push('Read [more][m].', '')
    defs.push(`[m]: ${relativeLink(path, other)} "More"`)
  }
  return `${[...lines, ...defs].join('\n')}\n`
}

/** Writes the workspace under `out`. Returns how many notes link to `target.md`. */
export function writeWorkspace(out: string): number {
  const rng = makeRng(0x5ca1ab1e)
  let inbound = 0
  mkdirSync(out, { recursive: true })
  for (let folder = 0; folder < FOLDERS; folder++) {
    mkdirSync(join(out, `area-${String(folder).padStart(2, '0')}`), { recursive: true })
    for (let index = 0; index < NOTES_PER_FOLDER; index++) {
      const path = note(folder, index)
      const linked = rng.chance(0.1)
      if (linked) inbound++
      writeFileSync(join(out, path), body(rng, path, linked), 'utf8')
    }
  }
  writeFileSync(join(out, 'target.md'), '# The target\n\nRenamed while the scan runs.\n', 'utf8')
  return inbound
}
