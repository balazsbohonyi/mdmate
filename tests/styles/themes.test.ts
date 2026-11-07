import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrast, inGamut, parseColor } from './color'

const root = resolve(import.meta.dirname, '../..')

function read(relative: string): string {
  return readFileSync(resolve(root, relative), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every `--name: value;` declaration in a stylesheet. */
function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1] ?? '', (match[2] ?? '').trim())
  }
  return found
}

const dark = declarations(read('src/styles/themes/dark.css'))
const light = declarations(read('src/styles/themes/light.css'))
const tokensCss = read('src/styles/tokens.css')

/** The `--color-x: var(--x)` lines of the `@theme inline` block: Tailwind utility to theme token. */
function colorMapping(): Map<string, string> {
  const block = /@theme inline\s*\{([\s\S]*?)\n\}/.exec(tokensCss)?.[1] ?? ''
  const mapping = new Map<string, string>()
  for (const [name, value] of declarations(block)) {
    const target = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
    if (name.startsWith('--color-') && target) mapping.set(name, target)
  }
  return mapping
}

function resolveToken(theme: Map<string, string>, name: string): string {
  let value = theme.get(name)
  for (let hops = 0; value !== undefined && hops < 5; hops++) {
    const next = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
    if (!next) return value
    value = theme.get(next)
  }
  throw new Error(`Cannot resolve ${name}`)
}

const themes = { dark, light } as const

describe('theme files', () => {
  it('define exactly the same tokens in dark and light', () => {
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort())
  })

  it('map every color token to a Tailwind utility, and every utility to a real token', () => {
    const mapped = colorMapping()
    const targets = [...mapped.values()].sort()
    expect(targets).toEqual([...dark.keys()].sort())
    for (const [name, target] of mapped) {
      expect(name).toBe(`--color-${target.slice(2)}`)
    }
  })

  it('keep every color out of tokens.css, so a theme file is the only place a color changes', () => {
    expect(tokensCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(tokensCss).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color-mix)\(/i)
  })

  it('start the native window on the dark background, so launch has no color jump', () => {
    const config = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8')) as {
      app: { windows: { backgroundColor?: string }[] }
    }
    expect(config.app.windows[0]?.backgroundColor?.toLowerCase()).toBe(
      dark.get('--background')?.toLowerCase(),
    )
  })

  it('start on the dark theme when the page has no theme class', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8')
    expect(html).toMatch(/<html[^>]*class="dark"/)
  })
})

/** [foreground token, background token, minimum contrast]. Dim-by-design marks only need 3. */
const PAIRS: [string, string, number][] = [
  ['--foreground', '--background', 7],
  ['--muted-foreground', '--background', 4.5],
  ['--muted-foreground', '--muted', 4.5],
  ['--card-foreground', '--card', 4.5],
  ['--popover-foreground', '--popover', 4.5],
  ['--primary-foreground', '--primary', 4.5],
  ['--secondary-foreground', '--secondary', 4.5],
  ['--accent-foreground', '--accent', 4.5],
  ['--primary', '--background', 4.5],
  ['--destructive', '--background', 4.5],
  ['--sidebar-foreground', '--sidebar', 4.5],
  ['--sidebar-accent-foreground', '--sidebar-accent', 4.5],
  ['--titlebar-foreground', '--titlebar', 4.5],
  ['--tab-foreground', '--tabstrip', 4.5],
  ['--tab-active-foreground', '--tab-active', 7],
  ['--statusbar-foreground', '--statusbar', 4.5],
  ['--syntax-heading', '--background', 4.5],
  ['--syntax-link', '--background', 4.5],
  ['--syntax-code', '--syntax-code-background', 4.5],
  ['--syntax-quote', '--background', 4.5],
  ['--syntax-keyword', '--background', 4.5],
  ['--syntax-string', '--background', 4.5],
  ['--syntax-number', '--background', 4.5],
  ['--syntax-function', '--background', 4.5],
  ['--syntax-type', '--background', 4.5],
  ['--syntax-punctuation', '--background', 4.5],
  ['--syntax-invalid', '--background', 4.5],
  ['--syntax-marker', '--background', 3],
  ['--syntax-comment', '--background', 3],
]

describe.each(Object.entries(themes))('%s theme colors', (_name, theme) => {
  it('stay inside the sRGB gamut, so the browser shows the colors as written', () => {
    const outside: string[] = []
    for (const token of theme.keys()) {
      const value = resolveToken(theme, token)
      if (!/^(#|oklch\()/i.test(value)) continue
      if (!inGamut(parseColor(value))) outside.push(`${token}: ${value}`)
    }
    expect(outside).toEqual([])
  })

  it('keep text readable on the surface it sits on', () => {
    const tooFaint: string[] = []
    for (const [foreground, background, minimum] of PAIRS) {
      const ratio = contrast(
        parseColor(resolveToken(theme, foreground)),
        parseColor(resolveToken(theme, background)),
      )
      if (ratio < minimum) {
        tooFaint.push(`${foreground} on ${background}: ${ratio.toFixed(2)}, needs ${minimum}`)
      }
    }
    expect(tooFaint).toEqual([])
  })

  it('tell the active tab from an idle one, and the sidebar from the editor', () => {
    const idle = parseColor(resolveToken(theme, '--tabstrip'))
    const active = parseColor(resolveToken(theme, '--tab-active'))
    const sidebar = parseColor(resolveToken(theme, '--sidebar'))
    const editor = parseColor(resolveToken(theme, '--background'))
    expect(contrast(idle, active)).toBeGreaterThan(1.03)
    expect(contrast(sidebar, editor)).toBeGreaterThan(1.03)
  })
})
