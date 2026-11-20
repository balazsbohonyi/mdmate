import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrast, inGamut, parseColor } from '@/lib/color'
import { CONTRAST_PAIRS, THEME_TOKEN_NAMES } from '@/lib/themeTokens'

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

/** Every theme stylesheet in src/styles/themes, found by listing the folder: a new file is held to all of this. */
const themeFiles = readdirSync(resolve(root, 'src/styles/themes'))
  .filter((file) => file.endsWith('.css'))
  .sort()
const themes = new Map(
  themeFiles.map((file) => [file.replace(/\.css$/, ''), read(`src/styles/themes/${file}`)]),
)
const parsed = new Map([...themes].map(([name, css]) => [name, declarations(css)]))
const dark = parsed.get('dark') ?? new Map<string, string>()

/** `light` or `dark`, as the file says in its `color-scheme` line. */
const schemeOf = (name: string): string =>
  /color-scheme:\s*(light|dark)/.exec(themes.get(name) ?? '')?.[1] ?? ''

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

describe('theme files', () => {
  it('are dark, light and sepia, and no other file sits in the folder', () => {
    expect([...themes.keys()]).toEqual(['dark', 'light', 'sepia'])
  })

  it('define exactly the same tokens in every theme, and exactly the tokens the editor lists', () => {
    for (const [name, tokens] of parsed) {
      expect([name, [...tokens.keys()].sort()]).toEqual([
        name,
        [...THEME_TOKEN_NAMES].map((token) => `--${token}`).sort(),
      ])
    }
  })

  it('give each theme its own color-scheme, and its own data-theme selector', () => {
    for (const [name, css] of themes) {
      expect(schemeOf(name)).toMatch(/^(light|dark)$/)
      expect(css).toContain(`[data-theme='${name}']`)
    }
    expect(schemeOf('dark')).toBe('dark')
    expect(schemeOf('light')).toBe('light')
    expect(schemeOf('sepia')).toBe('light')
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
    expect(html).toMatch(/<html[^>]*data-theme="dark"/)
  })
})

const PAIRS: [string, string, number][] = CONTRAST_PAIRS.map(([fg, bg, min]) => [
  `--${fg}`,
  `--${bg}`,
  min,
])

describe.each([...parsed])('%s theme colors', (name, theme) => {
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
    // In a light theme the strip is darker than the page, so the active tab has to stand out clearly.
    expect(contrast(idle, active)).toBeGreaterThan(schemeOf(name) === 'light' ? 1.2 : 1.3)
    expect(contrast(sidebar, editor)).toBeGreaterThan(1.03)
  })

  it('have no token for the idle tab: it shows the strip, and the pointer on it shows the accent (ISC-566)', () => {
    expect(theme.has('--tab-inactive')).toBe(false)
    const strip = parseColor(resolveToken(theme, '--tabstrip'))
    const hover = parseColor(resolveToken(theme, '--accent'))
    const text = parseColor(resolveToken(theme, '--accent-foreground'))
    // The hovered idle tab must show against the strip, and its text must still read on it.
    expect(contrast(hover, strip)).toBeGreaterThan(1.05)
    expect(contrast(text, hover)).toBeGreaterThanOrEqual(4.5)
  })

  it('set the strip apart from the content, and keep the separator visible on it (ISC-566)', () => {
    // Contrast against white falls as a color gets lighter.
    const white = parseColor('#ffffff')
    const against = (token: string): number =>
      contrast(parseColor(resolveToken(theme, token)), white)
    // A dark theme has a strip lighter than the content; a light one has it darker, so that the
    // active tab, which is the page color, stands out against it.
    if (schemeOf(name) === 'light') {
      expect(against('--tabstrip')).toBeGreaterThan(against('--background'))
      // And it is darker than the hover color too, so the pointer on an idle tab still shows.
      expect(against('--tabstrip')).toBeGreaterThan(against('--accent'))
    } else {
      expect(against('--tabstrip')).toBeLessThan(against('--background'))
    }
    const separator = parseColor(resolveToken(theme, '--tab-separator'))
    const strip = parseColor(resolveToken(theme, '--tabstrip'))
    expect(contrast(separator, strip)).toBeGreaterThan(1.2)
  })

  it('give a tooltip its own surface: lighter than the page in a dark theme, the popover color in a light one', () => {
    if (schemeOf(name) === 'light') {
      expect(resolveToken(theme, '--tooltip')).toBe(resolveToken(theme, '--popover'))
      return
    }
    const white = parseColor('#ffffff')
    const tooltip = parseColor(resolveToken(theme, '--tooltip'))
    const page = parseColor(resolveToken(theme, '--background'))
    expect(contrast(tooltip, page)).toBeGreaterThan(1.15)
    // Contrast against white falls as a color gets lighter.
    expect(contrast(tooltip, white)).toBeLessThan(contrast(page, white))
  })
})

describe('the Sepia theme (ISC-446)', () => {
  const sepia = parsed.get('sepia') ?? new Map<string, string>()
  const others = [parsed.get('dark'), parsed.get('light')]

  it('takes MarkdownWeave’s cream page and brown text', () => {
    expect(sepia.get('--background')?.toLowerCase()).toBe('#fdf6e3')
    expect(sepia.get('--foreground')?.toLowerCase()).toBe('#3b2f1e')
  })

  it('has a color of its own for every token it writes as a color, the warning and syntax colors included', () => {
    const copied: string[] = []
    for (const [token, value] of sepia) {
      if (value.startsWith('var(')) continue
      for (const other of others) if (other?.get(token) === value) copied.push(`${token}: ${value}`)
    }
    expect(copied).toEqual([])
    for (const token of ['--warning', '--syntax-keyword', '--syntax-string', '--syntax-comment']) {
      expect(sepia.get(token), token).toMatch(/^(#|oklch\()/)
    }
  })
})
