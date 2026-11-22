/**
 * The pane handle between two split panes (P1-T4, P8-T6, ISC-663): a 1px line at rest, and a 4px
 * band, as wide as the sidebar edge, while the pointer is over it or it is dragged. jsdom does not
 * run Tailwind, so the contract is read from the classes; the look in the real window is the
 * owner's claim (ISC-664).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const view = readFileSync(resolve(root, 'src/workbench/SplitNodeView.vue'), 'utf8')
const handle = readFileSync(
  resolve(root, 'src/components/ui/resizable/ResizableHandle.vue'),
  'utf8',
)
const classes = /<ResizableHandle[\s\S]*?class="([^"]*)"/.exec(view)?.[1]?.split(/\s+/) ?? []

describe('the pane handle (ISC-663)', () => {
  it('is one pixel wide at rest: the element is w-px and nothing on it sets another width', () => {
    expect(handle).toContain('w-px')
    const widths = classes.filter((name) => /^(min-|max-)?[wh]-/.test(name))
    expect(widths).toEqual([])
    expect(classes).toContain('bg-handle')
  })

  it('draws a 4px band in the active colour that shows on hover and while dragging, and by keyboard focus', () => {
    expect(classes).toContain('before:w-1')
    expect(classes).toContain('before:bg-handle-active')
    expect(classes).toContain('before:opacity-0')
    expect(classes).toContain('hover:before:opacity-100')
    expect(classes).toContain('data-[state=drag]:before:opacity-100')
    expect(classes).toContain('focus-visible:before:opacity-100')
  })

  it('has the band across a column split too, 4px high', () => {
    expect(classes).toContain('data-[orientation=vertical]:before:h-1')
    expect(classes).toContain('data-[orientation=vertical]:before:w-full')
  })

  it('leaves no focus ring behind after a drag: the band is the focus mark', () => {
    expect(classes).toContain('focus-visible:ring-0')
  })

  it('does not move the layout: the band is a pseudo-element laid over the line', () => {
    expect(classes).toContain('before:absolute')
    expect(classes).toContain('before:pointer-events-none')
  })
})
