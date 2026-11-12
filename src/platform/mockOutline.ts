import { Text } from '@codemirror/state'
import { scanHeadings } from '@/editor/headingSlug'
import { MAX_OUTLINE_HEADINGS, type OutlineAnswer } from './outline'

/**
 * The browser mock's outline: the editor's own heading scan, which the parity table
 * (`tests/fixtures/outline-parity.json`) holds to the same answers as Rust's. It lets the panel run
 * in a browser and in the page's own tests; the scan that matters for a big file is Rust's.
 */
export function mockOutline(id: number, text: string): OutlineAnswer {
  const found = scanHeadings(Text.of(text.split(/\r\n?|\n/)))
  const truncated = found.length > MAX_OUTLINE_HEADINGS
  return {
    id,
    truncated,
    headings: found
      .slice(0, MAX_OUTLINE_HEADINGS)
      .map((heading) => ({ level: heading.level, line: heading.line, text: heading.text })),
  }
}
