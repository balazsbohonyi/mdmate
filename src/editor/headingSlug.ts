import { markdownLanguage } from '@codemirror/lang-markdown'
import type { Text } from '@codemirror/state'
import { frontmatterEnd } from './livePreview/frontmatter'

/**
 * GitHub's heading slug (github-slugger): lower case, every character that is not a letter, a
 * mark, a digit, connector punctuation (`_`), a hyphen or a space removed, then each space made a
 * hyphen. Tabs and other spaces are removed, not turned into hyphens.
 */
export function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

/** Syntax that GitHub does not render as text, so it is not part of a heading's slug. */
const DROPPED = new Set([
  'EmphasisMark',
  'CodeMark',
  'LinkMark',
  'StrikethroughMark',
  'LinkTitle',
  'LinkLabel',
  'Image',
  'HTMLTag',
])

/** The text a heading's Markdown renders to: markers, link targets, images and tags left out. */
export function headingText(source: string): string {
  const tree = markdownLanguage.parser.parse(source)
  const dropped: { from: number; to: number }[] = []
  tree.iterate({
    enter(node) {
      if (DROPPED.has(node.name)) {
        dropped.push({ from: node.from, to: node.to })
        return false
      }
      // A link's target is not its text; an autolink's is.
      if (node.name === 'URL' && node.node.parent?.name === 'Link') {
        dropped.push({ from: node.from, to: node.to })
        return false
      }
      // `\*` renders as `*`.
      if (node.name === 'Escape') dropped.push({ from: node.from, to: node.from + 1 })
      return undefined
    },
  })
  dropped.sort((a, b) => a.from - b.from)
  let out = ''
  let at = 0
  for (const range of dropped) {
    if (range.from > at) out += source.slice(at, range.from)
    at = Math.max(at, range.to)
  }
  out += source.slice(at)
  return out.trim()
}

export interface HeadingAnchor {
  readonly slug: string
  /** Start of the heading's first line. */
  readonly from: number
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/

/** A heading as the text has it: the level, where it starts and what it says, markers and all. */
export interface RawHeading {
  /** 1 to 6. */
  readonly level: number
  /** The line the heading starts on, from 1. */
  readonly line: number
  /** Start of that line. */
  readonly from: number
  /** The text of the heading as written, without the `#` signs. */
  readonly text: string
}

/**
 * Every top-level heading, in order. Read from the text, not the tree, because the parser may not
 * have reached the end of a long file. Headings inside fenced code and frontmatter are skipped;
 * headings inside lists and quotes are not found (see Phase 5 decisions). The outline panel reads
 * the same headings in Rust (`src-tauri/src/outline`), and `tests/fixtures/outline-parity.json` is
 * run by both.
 */
export function scanHeadings(doc: Text): RawHeading[] {
  const found: RawHeading[] = []
  const add = (level: number, text: string, from: number, line: number): void => {
    found.push({ level, line, from, text })
  }
  const frontEnd = frontmatterEnd(doc)
  let fence: string | null = null
  let previous: { text: string; from: number; line: number } | null = null
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (frontEnd !== null && line.from < frontEnd) continue
    const text = line.text
    const fenceMatch = FENCE.exec(text)
    if (fence !== null) {
      if (
        fenceMatch?.[1] !== undefined &&
        fenceMatch[1].startsWith(fence.charAt(0)) &&
        fenceMatch[1].length >= fence.length
      )
        fence = null
      continue
    }
    if (fenceMatch?.[1] !== undefined) {
      fence = fenceMatch[1]
      previous = null
      continue
    }
    const atx = ATX.exec(text)
    if (atx !== null) {
      add((atx[1] ?? '#').length, atx[2] ?? '', line.from, n)
      previous = null
      continue
    }
    const bar = previous === null ? null : SETEXT.exec(text)
    if (previous !== null && bar !== null) {
      add(bar[1]?.startsWith('=') === true ? 1 : 2, previous.text, previous.from, previous.line)
      previous = null
      continue
    }
    // A paragraph line can become a setext heading; indented code, quotes and lists cannot here.
    previous =
      text.trim() === '' || /^( {4}|\t| {0,3}[>*+-]| {0,3}\d+[.)])/.test(text)
        ? null
        : { text, from: line.from, line: n }
  }
  return found
}

/**
 * Every top-level heading with its GitHub anchor, in order, duplicates numbered `-1`, `-2` as
 * GitHub does. See `scanHeadings` for what counts as a heading.
 */
export function headingAnchors(doc: Text): HeadingAnchor[] {
  const seen = new Map<string, number>()
  return scanHeadings(doc).map((heading) => {
    const base = githubSlug(headingText(heading.text))
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return { slug: count === 0 ? base : `${base}-${String(count)}`, from: heading.from }
  })
}

/**
 * Where the heading a `#fragment` names starts, or null. The fragment is matched as GitHub writes
 * it, and also lower-cased, since people write `#Intro` for a heading GitHub calls `intro`.
 */
export function findAnchor(doc: Text, fragment: string): number | null {
  const wanted = fragment.startsWith('user-content-')
    ? fragment.slice('user-content-'.length)
    : fragment
  const lower = wanted.toLowerCase()
  const anchors = headingAnchors(doc)
  const found = anchors.find((a) => a.slug === wanted) ?? anchors.find((a) => a.slug === lower)
  return found?.from ?? null
}
