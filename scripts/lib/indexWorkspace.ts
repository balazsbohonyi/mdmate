/**
 * A workspace of 100,000 files for the Phase 7.1 perf scenarios (`typing-during-indexing`,
 * `quick-open-query`, `index-times`). Deterministic: a seeded generator and no clock, so every run
 * writes the same names and bytes. Kept out of `fixtures.mjs` and out of `workspaceFixture.ts` on
 * purpose: it is ten times the size of the largest workspace the other scenarios use.
 *
 * Layout: `<out>/area-00 .. area-99/sub-0 .. sub-9/<name>.<ext>`, 100 files in each sub folder, so
 * 100,000 files that the index holds. Beside them sit two folders on the built-in exclusion list,
 * `node_modules` and `target`, with 2,000 files each, which the index must walk past and never
 * hold. File contents are one short line: the index never reads them, and the files are numerous
 * enough already.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const AREAS = 100
export const SUBS = 10
export const FILES_PER_SUB = 100
/** What the index holds for this workspace. */
export const INDEXED_FILES = AREAS * SUBS * FILES_PER_SUB
/** Files under the excluded folders: on disk, never in the index. */
export const EXCLUDED_FILES = 4000

/** The file that says a complete workspace is already there. It sits beside the tree, not in it. */
export const markerFor = (out: string): string => `${out}.complete`

export const isWritten = (out: string): boolean => existsSync(markerFor(out))

const STEMS = [
  'note',
  'plan',
  'meeting',
  'report',
  'design',
  'draft',
  'todo',
  'idea',
  'summary',
  'review',
  'budget',
  'roadmap',
  'spec',
  'guide',
  'readme',
  'log',
  'index',
  'chapter',
  'invoice',
  'recipe',
] as const

const TOPICS = [
  'alpha',
  'bridge',
  'cargo',
  'delta',
  'engine',
  'forest',
  'garden',
  'harbor',
  'island',
  'journey',
  'kitchen',
  'ledger',
  'market',
  'north',
  'orchard',
  'planet',
  'quarry',
  'river',
  'station',
  'tunnel',
] as const

/**
 * Mostly Markdown, some text, some source and a few images: what a folder of projects holds. The
 * source files are `.rs` and not `.ts`: the app's tsconfig includes every `.ts` under `tests/`, and
 * 8,000 files of one line each would fail the type check of the release build.
 */
const EXTENSIONS = [
  'md',
  'md',
  'md',
  'md',
  'md',
  'md',
  'md',
  'txt',
  'txt',
  'rs',
  'json',
  'png',
] as const

function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0')

/** Writes the workspace under `out`. Returns how many files the index should hold. */
export function writeIndexWorkspace(out: string): number {
  const next = makeRng(0x1de5c0de)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T
  mkdirSync(out, { recursive: true })
  for (let area = 0; area < AREAS; area++) {
    for (let sub = 0; sub < SUBS; sub++) {
      const folder = join(out, `area-${pad(area, 2)}`, `sub-${String(sub)}`)
      mkdirSync(folder, { recursive: true })
      for (let file = 0; file < FILES_PER_SUB; file++) {
        const name = `${pick(STEMS)}-${pick(TOPICS)}-${pad(file, 3)}.${pick(EXTENSIONS)}`
        // Two files of one folder can draw the same words; the number keeps the names apart.
        writeFileSync(join(folder, name), `${name}\n`, 'utf8')
      }
    }
  }
  for (const excluded of ['node_modules', 'target']) {
    for (let pkg = 0; pkg < 20; pkg++) {
      const folder = join(out, excluded, `pkg-${pad(pkg, 2)}`, 'lib')
      mkdirSync(folder, { recursive: true })
      for (let file = 0; file < EXCLUDED_FILES / 2 / 20; file++) {
        writeFileSync(join(folder, `module-${pad(file, 3)}.js`), 'module\n', 'utf8')
      }
    }
  }
  writeFileSync(markerFor(out), `${String(INDEXED_FILES)}\n`, 'utf8')
  return INDEXED_FILES
}
