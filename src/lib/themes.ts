/** The themes that exist. Sepia, System and user theme files arrive with the themes (P8-T3). */
export const THEME_CHOICES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
] as const

/** The class on the page's root that picks a theme's colors (`themes/*.css`). Dark is the fallback. */
export function themeClass(theme: string): 'dark' | 'light' {
  return theme === 'light' ? 'light' : 'dark'
}

/**
 * Puts the theme in force: the root carries exactly one theme class, so the tokens of that theme
 * win and Tailwind's `dark:` variants follow. A name this build does not know shows Dark.
 */
export function applyTheme(
  theme: string,
  root: HTMLElement | undefined = typeof document === 'undefined'
    ? undefined
    : document.documentElement,
): void {
  if (root === undefined) return
  const next = themeClass(theme)
  root.classList.remove('dark', 'light')
  root.classList.add(next)
}
