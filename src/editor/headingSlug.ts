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

/**
 * Every top-level heading with its GitHub anchor, in order, duplicates numbered `-1`, `-2` as
 * GitHub does. Read from the text, not the tree, because the parser may not have reached the end
 * of a long file. Headings inside fenced code and frontmatter are skipped; headings inside lists
 * and quotes are not found (see Phase 5 decisions).
 */
export function headingAnchors(doc: Text): HeadingAnchor[] {
  const anchors: HeadingAnchor[] = []
  const seen = new Map<string, number>()
  const add = (text: string, from: number): void => {
    const base = githubSlug(headingText(text))
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    anchors.push({ slug: count === 0 ? base : `${base}-${String(count)}`, from })
  }
  const frontEnd = frontmatterEnd(doc)
  let fence: string | null = null
  let previous: { text: string; from: number } | null = null
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
      add(atx[2] ?? '', line.from)
      previous = null
      continue
    }
    if (previous !== null && SETEXT.test(text)) {
      add(previous.text, previous.from)
      previous = null
      continue
    }
    // A paragraph line can become a setext heading; indented code, quotes and lists cannot here.
    previous =
      text.trim() === '' || /^( {4}|\t| {0,3}[>*+-]| {0,3}\d+[.)])/.test(text)
        ? null
        : { text, from: line.from }
  }
  return anchors
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
