import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const read = (relative: string): string => readFileSync(resolve(root, relative), 'utf8')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(vue|ts|css)$/.test(name) ? [path] : []
  })
}

/**
 * The scrollbars (ISC-248): one global style of thin, quiet WebKit scrollbars. Chromium ignores
 * the pseudo-element rules on any element that sets the standard `scrollbar-width` or
 * `scrollbar-color`, so nothing may set them except to hide a bar.
 */
describe('thin scrollbars everywhere (ISC-248)', () => {
  const css = read('src/styles/tokens.css')

  it('styles the scrollbar once, globally, from theme tokens', () => {
    expect(css).toMatch(/^::-webkit-scrollbar\s*\{/m)
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--scrollbar-thumb\)/)
    expect(css).toMatch(/::-webkit-scrollbar-thumb:hover\s*\{[^}]*var\(--scrollbar-thumb-hover\)/)
    expect(css).toMatch(/::-webkit-scrollbar-button\s*\{\s*display:\s*none/)
    expect(css).toMatch(/::-webkit-scrollbar-track[^{]*\{\s*background:\s*transparent/)
  })

  it('has the thumb colors in both themes', () => {
    for (const theme of ['dark', 'light']) {
      const file = read(`src/styles/themes/${theme}.css`)
      expect(file, theme).toMatch(/--scrollbar-thumb:/)
      expect(file, theme).toMatch(/--scrollbar-thumb-hover:/)
    }
  })

  it('sets no scrollbar-width or scrollbar-color anywhere, except none to hide a bar', () => {
    const offenders: string[] = []
    for (const file of sources(resolve(root, 'src'))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/scrollbar-(?:width|color)\s*:\s*([\w-]+)/g)) {
        if (match[1] !== 'none') offenders.push(`${file}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the tab strip bar hidden', () => {
    const strip = read('src/workbench/TabStrip.vue')
    expect(strip).toContain('[scrollbar-width:none]')
    expect(strip).toContain('[&::-webkit-scrollbar]:hidden')
  })
})
