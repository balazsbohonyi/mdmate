/**
 * The color tokens a theme has, in the groups the color editor shows them in. A token is named as
 * it is in the theme files without the leading `--` (`background` is `--background`). The theme
 * files in `src/styles/themes/` are the source of which tokens exist; `tests/styles/themes.test.ts`
 * fails when this list and those files disagree, so a token added to the CSS cannot be left out of
 * the editor.
 */

export const THEME_GROUPS = [
  { id: 'core', label: 'Core' },
  { id: 'sidebar', label: 'Sidebar' },
  { id: 'chrome', label: 'Chrome' },
  { id: 'editor', label: 'Editor' },
  { id: 'syntax', label: 'Syntax' },
] as const

export type ThemeGroup = (typeof THEME_GROUPS)[number]['id']

export interface ThemeToken {
  readonly name: string
  readonly group: ThemeGroup
  /** The name in words, for the editor's rows. */
  readonly label: string
}

const NAMES: Readonly<Record<ThemeGroup, readonly string[]>> = {
  core: [
    'background',
    'foreground',
    'card',
    'card-foreground',
    'popover',
    'popover-foreground',
    'primary',
    'primary-foreground',
    'secondary',
    'secondary-foreground',
    'muted',
    'muted-foreground',
    'accent',
    'accent-foreground',
    'destructive',
    'warning',
    'success',
    'border',
    'input',
    'ring',
    'tooltip',
    'tooltip-foreground',
  ],
  sidebar: [
    'sidebar',
    'sidebar-foreground',
    'sidebar-accent',
    'sidebar-accent-foreground',
    'sidebar-border',
  ],
  chrome: [
    'titlebar',
    'titlebar-foreground',
    'tabstrip',
    'tab-foreground',
    'tab-active',
    'tab-active-foreground',
    'statusbar',
    'statusbar-foreground',
    'handle',
    'handle-active',
    'scrollbar-thumb',
    'scrollbar-thumb-hover',
    'drop-preview',
  ],
  editor: ['selection', 'find-match', 'find-match-active', 'caret'],
  syntax: [
    'syntax-heading',
    'syntax-link',
    'syntax-code',
    'syntax-code-background',
    'syntax-quote',
    'syntax-marker',
    'syntax-keyword',
    'syntax-string',
    'syntax-number',
    'syntax-comment',
    'syntax-function',
    'syntax-type',
    'syntax-punctuation',
    'syntax-invalid',
  ],
}

function labelOf(name: string): string {
  const text = name.replaceAll('-', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Every token, grouped as shown, in the order of the theme files. */
export const THEME_TOKENS: readonly ThemeToken[] = THEME_GROUPS.flatMap((group) =>
  NAMES[group.id].map((name) => ({ name, group: group.id, label: labelOf(name) })),
)

export const THEME_TOKEN_NAMES: ReadonlySet<string> = new Set(
  THEME_TOKENS.map((token) => token.name),
)

/** The tokens of one group. */
export function tokensOf(group: ThemeGroup): readonly ThemeToken[] {
  return THEME_TOKENS.filter((token) => token.group === group)
}

/**
 * [text token, the surface it sits on, the lowest contrast ratio]. A theme is readable when every
 * pair holds; the theme contract test checks the built-in themes with it and the color editor warns
 * with it. Marks that are dim on purpose only need 3.
 */
export const CONTRAST_PAIRS: readonly (readonly [string, string, number])[] = [
  ['foreground', 'background', 7],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['card-foreground', 'card', 4.5],
  ['popover-foreground', 'popover', 4.5],
  ['tooltip-foreground', 'tooltip', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['primary', 'background', 4.5],
  ['destructive', 'background', 4.5],
  ['warning', 'background', 4.5],
  ['success', 'background', 4.5],
  ['sidebar-foreground', 'sidebar', 4.5],
  ['sidebar-accent-foreground', 'sidebar-accent', 4.5],
  ['titlebar-foreground', 'titlebar', 4.5],
  ['tab-foreground', 'tabstrip', 4.5],
  ['tab-active-foreground', 'tab-active', 7],
  ['statusbar-foreground', 'statusbar', 4.5],
  ['syntax-heading', 'background', 4.5],
  ['syntax-link', 'background', 4.5],
  ['syntax-code', 'syntax-code-background', 4.5],
  ['syntax-quote', 'background', 4.5],
  ['syntax-keyword', 'background', 4.5],
  ['syntax-string', 'background', 4.5],
  ['syntax-number', 'background', 4.5],
  ['syntax-function', 'background', 4.5],
  ['syntax-type', 'background', 4.5],
  ['syntax-punctuation', 'background', 4.5],
  ['syntax-invalid', 'background', 4.5],
  ['syntax-marker', 'background', 3],
  ['syntax-comment', 'background', 3],
]
