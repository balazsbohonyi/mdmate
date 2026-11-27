import darkCss from '@/styles/themes/dark.css?raw'
import lightCss from '@/styles/themes/light.css?raw'
import monochromeCss from '@/styles/themes/monochrome.css?raw'
import sepiaCss from '@/styles/themes/sepia.css?raw'

/**
 * The built-in themes as data. The CSS files in `src/styles/themes/` are the one source of their
 * colors; this module reads the same text the browser gets, so Customize can copy a theme into a
 * file and the color editor can show what a token is, with nothing typed in twice.
 */

/** Whether a theme is dark or light: the root's `dark` class (Tailwind's `dark:` variants) follows it. */
export type Scheme = 'dark' | 'light'

export const BUILT_IN_IDS = ['dark', 'light', 'sepia', 'monochrome'] as const
export type BuiltInId = (typeof BUILT_IN_IDS)[number]

export interface BuiltInTheme {
  readonly id: BuiltInId
  readonly label: string
  readonly scheme: Scheme
  /** Every token, by name without `--`, as the CSS file writes it (a `var(--x)` stays one). */
  readonly tokens: ReadonlyMap<string, string>
}

/** The `--name: value;` declarations of a stylesheet, by name without `--`. Comments are dropped. */
export function declarationsOf(css: string): Map<string, string> {
  const found = new Map<string, string>()
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of bare.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1] ?? '', (match[2] ?? '').trim())
  }
  return found
}

function schemeOf(css: string): Scheme {
  const match = /color-scheme\s*:\s*(dark|light)\s*;/.exec(css)
  return match?.[1] === 'light' ? 'light' : 'dark'
}

function make(id: BuiltInId, label: string, css: string): BuiltInTheme {
  return { id, label, scheme: schemeOf(css), tokens: declarationsOf(css) }
}

export const BUILT_IN_THEMES: Readonly<Record<BuiltInId, BuiltInTheme>> = {
  dark: make('dark', 'Dark', darkCss),
  light: make('light', 'Light', lightCss),
  sepia: make('sepia', 'Sepia', sepiaCss),
  monochrome: make('monochrome', 'Monochrome', monochromeCss),
}

/** The built-in theme an id names, in any case, or undefined. */
export function builtInFor(id: string): BuiltInTheme | undefined {
  const key = id.trim().toLowerCase()
  return BUILT_IN_IDS.find((have) => have === key) === undefined
    ? undefined
    : BUILT_IN_THEMES[key as BuiltInId]
}

/** The value of a token with every `var(--other)` followed, or undefined when it never ends in a color. */
export function resolveToken(
  tokens: ReadonlyMap<string, string>,
  name: string,
): string | undefined {
  let value = tokens.get(name)
  for (let hops = 0; value !== undefined && hops < 8; hops++) {
    const next = /^var\(--([\w-]+)\)$/.exec(value)?.[1]
    if (next === undefined) return value
    value = tokens.get(next)
  }
  return undefined
}
