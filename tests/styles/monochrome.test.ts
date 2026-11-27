// ISC-799 to ISC-801: the Monochrome theme. The token set, the gamut and the contrast floors are
// held for every theme file by `themes.test.ts`.
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declarationsOf, resolveToken } from '@/lib/builtinThemes'
import { contrast, parseColor, toHexString } from '@/lib/color'
import { THEME_TOKEN_NAMES } from '@/lib/themeTokens'

const root = resolve(import.meta.dirname, '../..')
const read = (relative: string): string =>
  readFileSync(resolve(root, relative), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const css = read('src/styles/themes/monochrome.css')
const tokens = declarationsOf(css)

const value = (token: string): string => {
  const found = resolveToken(tokens, token)
  if (found === undefined) throw new Error(`no ${token}`)
  return found
}

/** The chroma of a color as written: of an `oklch()`, or 0 for a hex gray. */
function chromaOf(color: string): number {
  const oklch = /^oklch\(\s*[\d.]+%?\s+([\d.]+)/i.exec(color)
  if (oklch) return Number(oklch[1])
  const [, red, green, blue] = /^#(..)(..)(..)$/.exec(toHexString(parseColor(color))) ?? []
  return red === green && green === blue ? 0 : 1
}

const lightnessOf = (token: string): number => {
  const found = /^oklch\(\s*([\d.]+)/i.exec(value(token))
  if (!found) throw new Error(`${token} is not oklch`)
  return Number(found[1])
}

/** The error red keeps its color. */
const RED = ['destructive', 'syntax-invalid']
/** Signals that keep a faint tint. */
const FAINT = ['git-added', 'git-untracked', 'git-conflicted', 'git-modified', 'warning', 'success']

describe('Monochrome is gray (ISC-799)', () => {
  it('declares every token', () => {
    expect([...tokens.keys()].sort()).toEqual([...THEME_TOKEN_NAMES].sort())
    expect(css).toMatch(/color-scheme:\s*dark/)
  })

  it('has no chroma outside the error red and the faint signals', () => {
    const colored = [...tokens.keys()].filter(
      (token) => !RED.includes(token) && !FAINT.includes(token) && chromaOf(value(token)) > 0,
    )
    expect(colored).toEqual([])
  })

  it('keeps the error red', () => {
    for (const token of RED) expect(chromaOf(value(token)), token).toBeGreaterThanOrEqual(0.12)
  })

  it('tints the signals faintly, and git names that are ignored not at all', () => {
    for (const token of FAINT) {
      expect(chromaOf(value(token)), token).toBeGreaterThan(0.02)
      expect(chromaOf(value(token)), token).toBeLessThanOrEqual(0.08)
    }
    expect(chromaOf(value('git-ignored'))).toBe(0)
  })

  it('spreads the git names in lightness too, since a faint tint says little', () => {
    const steps = [...FAINT.filter((token) => token.startsWith('git-')), 'git-ignored']
      .map((token) => lightnessOf(token))
      .sort((a, b) => a - b)
    for (let at = 1; at < steps.length; at++)
      expect(steps[at]! - steps[at - 1]!).toBeGreaterThanOrEqual(0.049)
  })
})

describe('kinds of text stay apart without color (ISC-800)', () => {
  // The rules that give a theme weight and italic, and the highlighter that reads them.
  const shared = read('src/styles/tokens.css')
  const rule = /:root\[data-theme='monochrome'\]\s*\{([^}]*)\}/.exec(shared)?.[1] ?? ''
  const extra = declarationsOf(rule)
  const highlight = readFileSync(resolve(root, 'src/editor/highlight.ts'), 'utf8')

  /** What sets a kind apart besides its lightness. `comment` and `link` are so in every theme. */
  const drawn = (kind: string): string =>
    [
      extra.get(`kind-${kind}-weight`) ?? '',
      extra.get(`kind-${kind}-style`) ?? (kind === 'comment' ? 'italic' : ''),
      kind === 'link' ? 'underline' : '',
    ].join('|')

  const KINDS = [
    'keyword',
    'function',
    'string',
    'number',
    'type',
    'punctuation',
    'comment',
    'link',
    'quote',
    'marker',
  ]

  it('draws no two kinds the same, plain text included', () => {
    const looks = [
      { kind: 'plain', lightness: lightnessOf('foreground'), rest: '||' },
      ...KINDS.map((kind) => ({
        kind,
        lightness: lightnessOf(`syntax-${kind}`),
        rest: drawn(kind),
      })),
    ]
    const same: string[] = []
    for (const [at, a] of looks.entries())
      for (const b of looks.slice(at + 1)) {
        // Comments and Markdown markers never share a place, but must still differ.
        const apart = Math.abs(a.lightness - b.lightness) >= 0.06
        if (!apart && a.rest === b.rest) same.push(`${a.kind} and ${b.kind}`)
      }
    expect(same).toEqual([])
  })

  it('has the highlighter read the weight and the italic the theme sets', () => {
    expect([...extra.keys()].sort()).toEqual([
      'kind-keyword-weight',
      'kind-quote-style',
      'kind-type-style',
    ])
    for (const name of extra.keys()) expect(highlight).toContain(`var(--${name}, inherit)`)
  })

  it('tells selected text, a find match and the current match apart by lightness', () => {
    /** The color of a see-through token over the page, mixed as the browser mixes it. */
    const over = (token: string): string => {
      const top = toHexString(parseColor(value(token)))
      const page = toHexString(parseColor(value('background')))
      const alpha = parseColor(value(token)).alpha
      const channel = (hex: string, at: number): number => parseInt(hex.slice(at, at + 2), 16)
      return `#${[1, 3, 5]
        .map((at) =>
          Math.round(channel(top, at) * alpha + channel(page, at) * (1 - alpha))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')}`
    }
    const steps = ['background', 'selection', 'find-match', 'find-match-active'].map((token) =>
      parseColor(over(token)),
    )
    for (let at = 1; at < steps.length; at++)
      expect(contrast(steps[at]!, steps[at - 1]!), String(at)).toBeGreaterThanOrEqual(1.3)
    // The text of a match still reads.
    const text = parseColor(value('foreground'))
    expect(contrast(text, steps[2]!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(text, steps[3]!)).toBeGreaterThanOrEqual(2.5)
  })
})

describe('file icons (ISC-801)', () => {
  const sheets = [
    'src/styles/tokens.css',
    ...readdirSync(resolve(root, 'src/styles/themes')).map((file) => `src/styles/themes/${file}`),
  ]

  it('are gray in Monochrome and nowhere else, and nothing else is filtered', () => {
    const filters = sheets.flatMap((sheet) =>
      [...read(sheet).matchAll(/([^{}]+)\{[^{}]*(?<![\w-])filter\s*:\s*([^;}]+)/g)].map((found) => [
        sheet,
        (found[1] ?? '').trim(),
        (found[2] ?? '').trim(),
      ]),
    )
    expect(filters).toEqual([
      [
        'src/styles/themes/monochrome.css',
        ":root[data-theme='monochrome'] [data-file-icon]",
        'grayscale(1)',
      ],
    ])
  })

  it('are what the tree marks, and only the tree draws them', () => {
    const sources = readdirSync(resolve(root, 'src'), { recursive: true, encoding: 'utf8' })
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => /\.(vue|ts)$/.test(file))
    const holding = (pattern: RegExp): string[] =>
      sources.filter((file) => pattern.test(readFileSync(resolve(root, 'src', file), 'utf8')))
    expect(holding(/data-file-icon/)).toEqual(['features/tree/FileIcon.vue'])
    expect(holding(/import FileIcon from/)).toEqual(['features/tree/FileTree.vue'])
  })
})
