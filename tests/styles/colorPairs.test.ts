/**
 * Color pairs are used the same way everywhere (ISC-534, ISC-535): a class that fills an element
 * with a background token also sets the text to that token's partner, at the same state.
 * `bg-accent` goes with `text-accent-foreground`, `bg-primary` with `text-primary-foreground`, and
 * so on, so a theme that gives a pair its own colors shows them on hover, on focus and on a menu
 * that is open, not only where the first screen happened to set both.
 *
 * Two rules decide which token fills what:
 * - `--accent` is the fill for an interactive state: hover, focus, pressed, open, current.
 * - `--muted` is a quiet static surface (a banner, a chip) and its text is `--muted-foreground`.
 *
 * This scans the sources. A fill with a transparency (`bg-accent/40`) is a tint over another color,
 * not a fill, so it is left out. A fill that carries no text (a dot, a bar, a drag preview) is
 * listed in ALLOWED with the reason, and a listed entry that no longer matches fails the test.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTRAST_PAIRS, THEME_TOKENS } from '@/lib/themeTokens'

const SRC = join(process.cwd(), 'src')

function sources(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sources(path))
    else if (/\.(vue|ts)$/.test(entry.name)) found.push(path)
  }
  return found
}

/** Background token, and the text token that goes with it. */
export const ENFORCED: Record<string, string> = {
  accent: 'accent-foreground',
  primary: 'primary-foreground',
  secondary: 'secondary-foreground',
  muted: 'muted-foreground',
  card: 'card-foreground',
  popover: 'popover-foreground',
  tooltip: 'tooltip-foreground',
  sidebar: 'sidebar-foreground',
  'sidebar-accent': 'sidebar-accent-foreground',
  titlebar: 'titlebar-foreground',
  tabstrip: 'tab-foreground',
  'tab-inactive': 'tab-foreground',
  'tab-active': 'tab-active-foreground',
  statusbar: 'statusbar-foreground',
  destructive: 'destructive-foreground',
}

/** A class token: the variants before the last colon, then the utility. */
const TOKEN = /(?<![\w\-[\]/])((?:[\w\-[\]=&*.>]+:)*)bg-([a-z-]+)(?![\w\-/[])/g

const QUOTES = '"\'`'

/**
 * The fills that have no text partner at the same state, as `line: token`. The class string around
 * a token is the quoted text between the nearest quote marks on its line.
 */
export function unpaired(text: string, enforced: Record<string, string> = ENFORCED): string[] {
  const out: string[] = []
  const lines = text.split('\n')
  lines.forEach((line, at) => {
    for (const match of line.matchAll(TOKEN)) {
      const [token, variants = '', name = ''] = match
      const partner = enforced[name]
      if (partner === undefined) continue
      const start = match.index
      let from = start
      while (from > 0 && !QUOTES.includes(line[from - 1] ?? '')) from--
      let to = start + token.length
      while (to < line.length && !QUOTES.includes(line[to] ?? '')) to++
      const literal = ` ${line.slice(from, to)} `
      if (!literal.includes(` ${variants}text-${partner} `)) out.push(`${String(at + 1)}: ${token}`)
    }
  })
  return out
}

/** Fills with no text or icon on them, or an error text kept on purpose. */
const ALLOWED: readonly { file: string; line: string; why: string }[] = [
  {
    file: 'features/search/SearchPanel.vue',
    line: 'size-1.5 rounded-full bg-primary',
    why: 'a dot',
  },
  { file: 'features/search/SearchPanel.vue', line: 'search-progress-bar', why: 'a progress bar' },
  {
    file: 'features/settings/SettingRow.vue',
    line: 'size-1.5 shrink-0 rounded-full bg-primary',
    why: 'a dot',
  },
  {
    file: 'workbench/TabStrip.vue',
    line: 'ml-auto size-2 shrink-0 rounded-full bg-primary',
    why: 'a dot',
  },
  { file: 'workbench/TabStripItem.vue', line: 'size-2 rounded-full bg-primary', why: 'a dot' },
  { file: 'workbench/TabStripItem.vue', line: 'size-1.5 rounded-full bg-primary', why: 'a dot' },
  { file: 'workbench/TabDragLayer.vue', line: "preview.solid ? 'bg-primary'", why: 'a drop bar' },
  { file: 'components/ui/switch/Switch.vue', line: 'data-checked:bg-primary', why: 'a track' },
  { file: 'components/ui/tooltip/TooltipContent.vue', line: 'fill-tooltip', why: 'an arrow' },
  {
    file: 'workbench/ImageView.vue',
    line: 'cursor-grab touch-none',
    why: 'the canvas behind an image',
  },
  {
    file: 'workbench/PaneNotice.vue',
    line: 'text-chrome text-destructive',
    why: 'an error, deliberately',
  },
]

interface Found {
  file: string
  line: string
  token: string
}

/** Every unpaired fill in the sources, with its line text. */
function scan(): Found[] {
  const found: Found[] = []
  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    const lines = text.split('\n')
    for (const one of unpaired(text)) {
      const [at = '', token = ''] = one.split(': ')
      found.push({
        file: relative(SRC, file).replaceAll('\\', '/'),
        line: lines[Number(at) - 1] ?? '',
        token,
      })
    }
  }
  return found
}

describe('a fill is paired with its text color (ISC-534, ISC-535)', () => {
  const found = scan()
  const allowedFor = (hit: Found): boolean =>
    ALLOWED.some((entry) => entry.file === hit.file && hit.line.includes(entry.line))

  it('has the partner text color wherever a token fills something, at the same state', () => {
    const bad = found
      .filter((hit) => !allowedFor(hit))
      .map((hit) => `${hit.file}: ${hit.token} | ${hit.line.trim().slice(0, 120)}`)
    expect(bad).toEqual([])
  })

  it('holds every pair to a contrast ratio and names it a theme token', () => {
    const names = THEME_TOKENS.map((token) => token.name)
    const unchecked: string[] = []
    for (const [fill, text] of Object.entries(ENFORCED)) {
      expect(names, fill).toContain(fill)
      expect(names, text).toContain(text)
      const held = CONTRAST_PAIRS.some(([a, b, ratio]) => a === text && b === fill && ratio >= 4.5)
      if (!held) unchecked.push(text + ' on ' + fill)
    }
    expect(unchecked).toEqual([])
  })

  it('lists no exception that is not needed any more', () => {
    const stale = ALLOWED.filter(
      (entry) => !found.some((hit) => hit.file === entry.file && hit.line.includes(entry.line)),
    ).map((entry) => `${entry.file}: ${entry.line}`)
    expect(stale).toEqual([])
  })

  it('finds a fill with no partner, so the scan above can fail', () => {
    expect(unpaired('<a class="px-2 hover:bg-accent">')).toEqual(['1: hover:bg-accent'])
    expect(unpaired("x = 'bg-accent text-foreground'")).toEqual(['1: bg-accent'])
    expect(unpaired('class="bg-primary"')).toEqual(['1: bg-primary'])
    expect(unpaired('class="bg-destructive text-background"')).toEqual(['1: bg-destructive'])
    expect(unpaired('class="bg-muted text-foreground"')).toEqual(['1: bg-muted'])
    expect(unpaired('class="bg-sidebar-accent text-sidebar-foreground"')).toEqual([
      '1: bg-sidebar-accent',
    ])
    // A partner at another state does not count.
    expect(unpaired('class="hover:bg-accent text-accent-foreground"')).toEqual([
      '1: hover:bg-accent',
    ])
    expect(unpaired('class="bg-accent hover:text-accent-foreground"')).toEqual(['1: bg-accent'])
    expect(unpaired('class="focus-visible:bg-accent hover:text-accent-foreground"')).toEqual([
      '1: focus-visible:bg-accent',
    ])
  })

  it('accepts a fill with its partner, and leaves tints and other tokens alone', () => {
    expect(unpaired('class="bg-accent text-accent-foreground"')).toEqual([])
    expect(unpaired('class="bg-muted px-2 text-muted-foreground"')).toEqual([])
    expect(unpaired('class="bg-sidebar-accent text-sidebar-accent-foreground"')).toEqual([])
    expect(unpaired('class="hover:bg-accent hover:text-accent-foreground"')).toEqual([])
    expect(
      unpaired('class="data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"'),
    ).toEqual([])
    expect(unpaired('class="hover:bg-accent/40"')).toEqual([])
    expect(unpaired('class="bg-accent-x bg-background bg-destructive/10"')).toEqual([])
    expect(unpaired('class="bg-destructive text-destructive-foreground"')).toEqual([])
  })
})
