/**
 * The CSS CodeMirror injects for the editor's themes, read back as rules. jsdom cannot resolve
 * `var()` into a drawn value, so a test of what the editor's theme says reads the rules as text:
 * which selector carries which declaration.
 */

export interface InjectedRule {
  /** The selector list of the rule, split, with CodeMirror's scope class cut off each entry. */
  readonly selectors: readonly string[]
  /** The text between the braces. */
  readonly body: string
}

/** Every rule CodeMirror has put into the page so far. */
export function injectedRules(): InjectedRule[] {
  const css = [...document.querySelectorAll('style')].map((style) => style.textContent).join('\n')
  const found: InjectedRule[] = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((selector) =>
      selector
        .trim()
        .replace(/^\.ͼ\d+/, '')
        .trim(),
    )
    found.push({ selectors, body: match[2] ?? '' })
  }
  return found
}

/** The values a CSS property has in the rules whose selector list holds exactly this selector. */
export function valuesOf(selector: string, property: string): string[] {
  const declaration = new RegExp(String.raw`(?:^|;)\s*${property}:\s*([^;]+)`, 'g')
  return injectedRules()
    .filter((rule) => rule.selectors.includes(selector))
    .flatMap((rule) => [...rule.body.matchAll(declaration)])
    .map((match) => (match[1] ?? '').trim())
}
