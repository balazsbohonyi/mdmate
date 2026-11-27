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
  it('are the four built-ins, and no other file sits in the folder', () => {
    expect([...themes.keys()]).toEqual(['dark', 'light', 'monochrome', 'sepia'])
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
    expect(schemeOf('monochrome')).toBe('dark')
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

  it('give the striped table rows a color of their own that shows and keeps the text readable (ISC-673)', () => {
    expect(theme.has('--table-stripe')).toBe(true)
    expect(colorMapping().get('--color-table-stripe')).toBe('--table-stripe')
    const stripe = parseColor(resolveToken(theme, '--table-stripe'))
    const page = parseColor(resolveToken(theme, '--background'))
    const text = parseColor(resolveToken(theme, '--foreground'))
    expect(contrast(text, stripe)).toBeGreaterThanOrEqual(4.5)
    // A tint of the page that is plainly there: the owner found the first one too faint (T29 round 2).
    expect(resolveToken(theme, '--table-stripe')).not.toBe(resolveToken(theme, '--background'))
    expect(contrast(stripe, page)).toBeGreaterThanOrEqual(1.08)
    // It is a quiet fill, not a block: it stays well short of the borders' own weight.
    expect(contrast(stripe, page)).toBeLessThan(1.25)
  })

  it('fill the open checkbox with a token of its own, tinted like the page (ISC-742)', () => {
    expect(theme.has('--checkbox-background')).toBe(true)
    expect(colorMapping().get('--color-checkbox-background')).toBe('--checkbox-background')
    const fill = parseColor(resolveToken(theme, '--checkbox-background'))
    // Near the page: a tint of it, not a block.
    expect(contrast(fill, parseColor(resolveToken(theme, '--background')))).toBeLessThan(1.35)
    // Sepia's page is cream, so a white box would stand out as it did before.
    if (name === 'sepia') expect(contrast(fill, parseColor('#ffffff'))).toBeGreaterThan(1.1)
    expect(CONTRAST_PAIRS).toContainEqual(['muted-foreground', 'checkbox-background', 3])
  })

  it('draw the code background apart from the page, and the code and heading text in the foreground (ISC-693, ISC-694, ISC-695)', () => {
    const page = parseColor(resolveToken(theme, '--background'))
    const codeBackground = parseColor(resolveToken(theme, '--syntax-code-background'))
    // Plainly there, as the table stripe is, and still a quiet fill.
    expect(contrast(codeBackground, page)).toBeGreaterThanOrEqual(1.08)
    expect(contrast(codeBackground, page)).toBeLessThan(1.25)
    // Neutral text: the same color as the body text.
    expect(resolveToken(theme, '--syntax-code')).toBe(resolveToken(theme, '--foreground'))
    expect(resolveToken(theme, '--syntax-heading')).toBe(resolveToken(theme, '--foreground'))
    // The pair stays: the code text must read on the code background.
    const text = parseColor(resolveToken(theme, '--syntax-code'))
    expect(contrast(text, codeBackground)).toBeGreaterThanOrEqual(4.5)
  })

  it('give code a border a little apart from its background: lighter in a dark theme, darker in a light one (ISC-710)', () => {
    expect(theme.has('--syntax-code-border')).toBe(true)
    const border = parseColor(resolveToken(theme, '--syntax-code-border'))
    const fill = parseColor(resolveToken(theme, '--syntax-code-background'))
    const black = parseColor('#000000')
    const ratio = contrast(border, fill)
    expect(ratio).toBeGreaterThanOrEqual(1.15)
    expect(ratio).toBeLessThan(1.6)
    // Against black, the lighter color has the larger contrast.
    const lighter = contrast(border, black) > contrast(fill, black)
    expect(lighter).toBe(schemeOf(name) === 'dark')
  })

  it('give the line numbers a strip and a color of their own, quiet and readable (ISC-630, ISC-631)', () => {
    expect(theme.has('--gutter')).toBe(true)
    expect(theme.has('--gutter-foreground')).toBe(true)
    // The utilities of both are mapped to them.
    expect(colorMapping().get('--color-gutter')).toBe('--gutter')
    expect(colorMapping().get('--color-gutter-foreground')).toBe('--gutter-foreground')
    const numbers = parseColor(resolveToken(theme, '--gutter-foreground'))
    const strip = parseColor(resolveToken(theme, '--gutter'))
    const page = parseColor(resolveToken(theme, '--background'))
    const text = parseColor(resolveToken(theme, '--foreground'))
    expect(contrast(numbers, strip)).toBeGreaterThanOrEqual(4.5)
    // Muted: not the color of the body text, and well under its contrast.
    expect(resolveToken(theme, '--gutter-foreground')).not.toBe(resolveToken(theme, '--foreground'))
    expect(contrast(numbers, strip)).toBeLessThan(contrast(text, page))
    // The strip has the page's own color: no box behind the numbers (owner, 2026-11-22). The token
    // stays, so a custom theme can still tint it.
    expect(resolveToken(theme, '--gutter')).toBe(resolveToken(theme, '--background'))
  })

  it('give the git names five colors of their own, readable on the sidebar and on its selected row (ISC-655)', () => {
    for (const token of [
      'git-added',
      'git-untracked',
      'git-conflicted',
      'git-modified',
      'git-ignored',
    ]) {
      expect(theme.has(`--${token}`), token).toBe(true)
      // The utility (`text-git-added` and the rest) is mapped to the token.
      expect(colorMapping().get(`--color-${token}`), token).toBe(`--${token}`)
      expect(THEME_TOKEN_NAMES.has(token), token).toBe(true)
    }
    const on = (token: string, surface: string): number =>
      contrast(parseColor(resolveToken(theme, token)), parseColor(resolveToken(theme, surface)))
    for (const surface of ['--sidebar', '--sidebar-accent']) {
      expect(on('--git-added', surface), `added on ${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(on('--git-modified', surface), `modified on ${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(on('--git-ignored', surface), `ignored on ${surface}`).toBeGreaterThanOrEqual(3)
      expect(on('--git-untracked', surface), `untracked on ${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(on('--git-conflicted', surface), `conflicted on ${surface}`).toBeGreaterThanOrEqual(
        4.5,
      )
    }
    // Five different colors, and the ignored one is quieter than the body text of the sidebar.
    const values = [
      '--git-added',
      '--git-untracked',
      '--git-conflicted',
      '--git-modified',
      '--git-ignored',
    ].map((token) => resolveToken(theme, token))
    expect(new Set(values).size).toBe(5)
    expect(on('--git-ignored', '--sidebar')).toBeLessThan(on('--sidebar-foreground', '--sidebar'))
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
