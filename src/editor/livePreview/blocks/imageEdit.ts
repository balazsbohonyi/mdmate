/**
 * The text a resize writes (P9-T4). A resized `![alt](src)` becomes `<img src alt width>`; an
 * `<img>` tag keeps every byte but its `width` (set) and its `height` (dropped). Nothing outside
 * the image's own source changes, with one exception that keeps a neighbour from being swallowed:
 * see `ResizeTarget.joinsNext`.
 *
 * A tag that would not read back as the same address, label and title is never written; the
 * resize does nothing instead of changing what the image points at.
 */
import { parseImgTag, widthEdits, type TextEdit } from './imageTag'

export type { TextEdit }

/** The smallest width a drag may give a picture, in CSS pixels. */
export const MIN_IMAGE_WIDTH = 24

/** What a resize needs to know about the image it is resizing. */
export interface ResizeTarget {
  /** The image's own text in the document: a Markdown image or an `<img>` tag, whitespace and all. */
  readonly source: string
  /** True for an `<img>` tag. */
  readonly html: boolean
  /** The address as written in the Markdown image (angle brackets and all). Unused for a tag. */
  readonly address: string
  readonly alt: string
  readonly title: string | null
  /**
   * True for a Markdown image alone on the first line of a paragraph that goes on after it. An
   * `<img>` tag alone on a line starts an HTML block that runs to the next blank line, so the lines
   * after it would turn into raw HTML (their Markdown would stop rendering in every other viewer,
   * and mdmate would stop drawing an image written on the next line). The resize then ends the tag
   * with one line break, which makes the next line a paragraph of its own again.
   */
  readonly joinsNext: boolean
  /** The document's line break, for the one a `joinsNext` resize adds. */
  readonly lineBreak: string
}

/** One line, with no character that would end an attribute value or start markup. */
function attribute(value: string): string {
  return value
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** What the address says once the allowlist has taken off its wrapping, as `resolveImageAddress` does. */
function addressOf(raw: string): string {
  let address = raw.trim()
  if (address.startsWith('<') && address.endsWith('>')) address = address.slice(1, -1).trim()
  return address
}

/** `![alt](src "title")` as a self-closed `<img .../>` of `width` pixels, or null when the tag would say something else. */
function markdownAsTag(target: ResizeTarget, width: number): string | null {
  const src = addressOf(target.address)
  if (src === '') return null
  const alt = target.alt.replace(/\s*[\r\n]+\s*/g, ' ')
  const title = target.title === null ? null : target.title.replace(/\s*[\r\n]+\s*/g, ' ')
  let tag = `<img src="${attribute(src)}"`
  if (alt !== '') tag += ` alt="${attribute(alt)}"`
  if (title !== null && title !== '') tag += ` title="${attribute(title)}"`
  // Self-closed, as the owner writes a tag by hand; a tag that is already there keeps its own end.
  tag += ` width="${String(width)}"/>`
  const back = parseImgTag(tag)
  if (back?.src !== src || back.alt !== alt || back.width !== width) return null
  if ((back.title ?? '') !== (title ?? '')) return null
  return tag
}

/**
 * The edits (offsets in `target.source`) that make the image `width` pixels wide. Empty when it
 * already is, null when it cannot be done without changing what the image says.
 */
export function resizeEdits(target: ResizeTarget, rawWidth: number): TextEdit[] | null {
  const width = Math.round(rawWidth)
  if (!Number.isFinite(width) || width < 1) return null
  if (target.html) return widthEdits(target.source, width)
  const lead = target.source.length - target.source.trimStart().length
  const to = target.source.trimEnd().length
  const tag = markdownAsTag(target, width)
  if (tag === null) return null
  return [{ from: lead, to, insert: target.joinsNext ? tag + target.lineBreak : tag }]
}

/** `value` held between `min` and `max`; a `max` below `min` gives `min`. */
export function clampWidth(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}
