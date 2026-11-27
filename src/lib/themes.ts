import {
  BUILT_IN_THEMES,
  builtInFor,
  resolveToken,
  type BuiltInId,
  type Scheme,
} from './builtinThemes'
import { checkThemeColor } from './themeFile'
import { THEME_TOKEN_NAMES, THEME_TOKENS } from './themeTokens'

/**
 * Which theme is shown and how it gets onto the page. The `theme` setting names one of five
 * built-ins (Dark, Light, Sepia, Monochrome, System) or a user theme file. A theme is a palette (the root's
 * `data-theme`, which the CSS in `src/styles/themes/` keys on) plus color overrides from a user
 * file, which are set as properties on the root. Darkness is separate from the palette: the root
 * carries the `dark` class only for a dark palette, so Tailwind's `dark:` variants never follow
 * Sepia or a theme based on a light palette.
 */

/** The follow-the-OS choice. Not a palette: it is Dark or Light, whichever the system is using. */
export const SYSTEM_THEME = 'system'

export interface ThemeChoice {
  readonly value: string
  readonly label: string
}

/** The themes this build ships, in the order they are offered. */
export const BUILT_IN_CHOICES: readonly ThemeChoice[] = [
  { value: 'dark', label: BUILT_IN_THEMES.dark.label },
  { value: 'light', label: BUILT_IN_THEMES.light.label },
  { value: 'sepia', label: BUILT_IN_THEMES.sepia.label },
  { value: 'monochrome', label: BUILT_IN_THEMES.monochrome.label },
  { value: SYSTEM_THEME, label: 'System' },
]

/** A user theme file that was read and is usable. */
export interface UserTheme {
  /** The file's name without `.json`; what `theme` holds to select it. */
  readonly id: string
  readonly label: string
  readonly base: BuiltInId
  readonly colors: ReadonlyMap<string, string>
  /** What in the file was ignored, one sentence each. */
  readonly problems: readonly string[]
}

/** A user theme file, by lower-cased id: usable, or the reason it is not. */
export type UserThemeSlot =
  | { readonly ok: true; readonly theme: UserTheme }
  | { readonly ok: false; readonly id: string; readonly message: string }

/** A theme as it is shown: the palette, how dark it is, the overrides on top and what to tell the user. */
export interface ResolvedTheme {
  /** The `theme` setting this came from. */
  readonly setting: string
  readonly palette: BuiltInId
  readonly scheme: Scheme
  readonly overrides: ReadonlyMap<string, string>
  /** Shown as the theme's name (the user theme's own name, or Dark for a fallback). */
  readonly label: string
  /** Set when the choice could not be honored as written, or part of a file was ignored. */
  readonly notice: string | null
  /** The user theme in use, when one is. */
  readonly user: UserTheme | null
}

export interface ResolveContext {
  /** Whether the operating system is using a dark appearance, for System. */
  readonly systemDark: boolean
  /** Whether the themes folder has been read yet; until it has, an unknown name is not an error. */
  readonly loaded: boolean
}

const NO_OVERRIDES: ReadonlyMap<string, string> = new Map()

function builtIn(
  setting: string,
  id: BuiltInId,
  notice: string | null,
  label?: string,
): ResolvedTheme {
  const theme = BUILT_IN_THEMES[id]
  return {
    setting,
    palette: id,
    scheme: theme.scheme,
    overrides: NO_OVERRIDES,
    label: label ?? theme.label,
    notice,
    user: null,
  }
}

/** The key a user theme is found by: file names are not case-sensitive on Windows. */
export const slotKey = (id: string): string => id.trim().toLowerCase()

/**
 * Works out what to show for the `theme` setting. A built-in or System is that. A user theme is its
 * base palette with its colors on top; a file that cannot be used shows Dark and says why; a name
 * with no file shows Dark and says so, once the folder has been read.
 */
export function resolveTheme(
  setting: string,
  user: ReadonlyMap<string, UserThemeSlot>,
  context: ResolveContext,
): ResolvedTheme {
  const text = setting.trim()
  if (text.toLowerCase() === SYSTEM_THEME) {
    return builtIn(setting, context.systemDark ? 'dark' : 'light', null, 'System')
  }
  const known = builtInFor(text)
  if (known !== undefined) return builtIn(setting, known.id, null)
  const slot = user.get(slotKey(text))
  if (slot === undefined) {
    return builtIn(
      setting,
      'dark',
      context.loaded ? `Theme "${text}" was not found in the themes folder. Showing Dark.` : null,
    )
  }
  if (!slot.ok) {
    return builtIn(
      setting,
      'dark',
      `Theme "${slot.id}" could not be used: ${slot.message} Showing Dark.`,
    )
  }
  const theme = slot.theme
  const base = BUILT_IN_THEMES[theme.base]
  const shown = theme.problems.slice(0, 3).join(' ')
  return {
    setting,
    palette: theme.base,
    scheme: base.scheme,
    overrides: theme.colors,
    label: theme.label,
    notice:
      theme.problems.length === 0
        ? null
        : `Theme "${theme.id}": ${shown}${theme.problems.length > 3 ? ' And more.' : ''} Those colors were ignored.`,
    user: theme,
  }
}

/** Every token of a shown theme as a color: the palette's value, or the override on top of it. */
export function effectiveTokens(
  theme: Pick<ResolvedTheme, 'palette' | 'overrides'>,
): Map<string, string> {
  const base = BUILT_IN_THEMES[theme.palette].tokens
  const out = new Map<string, string>()
  for (const { name } of THEME_TOKENS) {
    const value = theme.overrides.get(name) ?? resolveToken(base, name)
    if (value !== undefined) out.set(name, value)
  }
  return out
}

/** The properties the last `applyTheme` set on the root, so the next one can take them off. */
const appliedProperties = new WeakMap<HTMLElement, Set<string>>()

/**
 * Puts a theme on the page: the palette in `data-theme`, the `dark` class for a dark palette, and
 * each override as a property on the root (inline styles beat the stylesheet). This is the one
 * place a theme file's value becomes a style, and it checks each value again: only a known token
 * with a color that passes `checkThemeColor` is set, so a caller cannot slip anything else through.
 */
export function applyTheme(
  theme: Pick<ResolvedTheme, 'palette' | 'scheme' | 'overrides'>,
  root: HTMLElement | undefined = typeof document === 'undefined'
    ? undefined
    : document.documentElement,
): void {
  if (root === undefined) return
  root.dataset.theme = theme.palette
  root.classList.toggle('dark', theme.scheme === 'dark')
  const before = appliedProperties.get(root) ?? new Set<string>()
  const now = new Set<string>()
  for (const [token, value] of theme.overrides) {
    if (!THEME_TOKEN_NAMES.has(token) || !checkThemeColor(value).ok) continue
    root.style.setProperty(`--${token}`, value)
    now.add(token)
  }
  for (const token of before) if (!now.has(token)) root.style.removeProperty(`--${token}`)
  appliedProperties.set(root, now)
}
