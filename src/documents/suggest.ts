/**
 * The file name the save dialog suggests for a document that has none: the first heading, as a
 * lowercase slug, else `Untitled.md`. `# Meeting notes` becomes `meeting-notes.md`.
 */

const FALLBACK = 'Untitled.md'
const MAX_SLUG = 60

/** The text of the first ATX heading outside a code fence, or null when there is none. */
function firstHeading(text: string): string | null {
  let fence: string | null = null
  for (const line of text.split(/\r\n|\n|\r/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker !== undefined) {
      if (fence === null) fence = marker.charAt(0)
      else if (marker.startsWith(fence)) fence = null
      continue
    }
    if (fence !== null) continue
    const heading = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line)?.[1]
    if (heading !== undefined && heading !== '') return heading
  }
  return null
}

/** Letters and digits of any language stay; everything else between words becomes one hyphen. */
function slugOf(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '')
}

/** The file name to suggest for this text. */
export function suggestedFileName(text: string): string {
  const heading = firstHeading(text)
  const slug = heading === null ? '' : slugOf(heading)
  return slug === '' ? FALLBACK : `${slug}.md`
}
