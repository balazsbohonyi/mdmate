/**
 * The sticky headings have a fill of their own (ISC-807): a little apart from the page, lighter in
 * the dark themes and darker in the light ones.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrast, luminance, parseColor } from '@/lib/color'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string): string =>
  readFileSync(resolve(root, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const token = (css: string, name: string): string =>
  new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? ''

const themes = readdirSync(resolve(root, 'src/styles/themes')).filter((file) =>
  file.endsWith('.css'),
)

describe('the fill of the sticky headings', () => {
  it.each(themes)('is a little apart from the page in %s', (file) => {
    const css = read(`src/styles/themes/${file}`)
    const page = parseColor(token(css, 'background'))
    const fill = parseColor(token(css, 'sticky-background'))
    const dark = /color-scheme:\s*dark/.test(css)
    expect(luminance(fill) > luminance(page)).toBe(dark)
    expect(contrast(page, fill)).toBeGreaterThanOrEqual(1.04)
    expect(contrast(page, fill)).toBeLessThanOrEqual(1.25)
  })

  it('is what the stack is drawn with, and a hovered row stands out on it', () => {
    const source = read('src/editor/stickyHeadings.ts')
    expect(source).toContain("backgroundColor: 'var(--sticky-background)'")
    expect(source).toContain("'.cm-md-sticky-row:hover': { backgroundColor: 'var(--accent)' }")
  })
})
