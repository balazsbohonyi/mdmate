// @vitest-environment jsdom
/**
 * The fonts of the document text (P8-T1e: ISC-360 to ISC-363, ISC-392). The settings put values on
 * the page's root as custom properties; the editor's theme is the only reader. jsdom cannot resolve
 * `var()` into a drawn size, so what is checked here is the chain on each side of that step: the
 * file to the properties, and the properties to the theme rules by name. The drawn sizes and
 * families are read from the real window (ISA Verification).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import {
  cssFamilyList,
  documentFontVariables,
  familyStack,
  FONT_VARIABLES,
  resetDocumentFonts,
  updateDocumentFonts,
} from '@/editor/documentFonts'
import { applySettingsText, resetSettingsState } from '@/features/settings/store'
import { DEFAULT_SETTINGS, resetSettings } from '@/lib/settings'

const root = (): CSSStyleDeclaration => document.documentElement.style

function load(fonts: Record<string, unknown>): void {
  applySettingsText(JSON.stringify({ fonts }))
}

beforeEach(() => {
  resetSettings()
  resetSettingsState()
  resetDocumentFonts()
})

afterEach(() => {
  resetSettings()
  resetSettingsState()
  resetDocumentFonts()
})

describe('ISC-360: each family is used for its own kind of text', () => {
  it('puts a heading, body and code family in three different properties', () => {
    load({ heading: 'Georgia', body: 'Segoe UI', code: 'Consolas' })
    const css = root()
    expect(css.getPropertyValue(FONT_VARIABLES.body)).toBe('"Segoe UI", monospace')
    expect(css.getPropertyValue(FONT_VARIABLES.heading)).toBe('"Georgia", "Segoe UI", monospace')
    expect(css.getPropertyValue(FONT_VARIABLES.code)).toBe('"Consolas", var(--font-mono)')
  })

  it('does not let one family leak into another kind', () => {
    load({ code: 'Consolas' })
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toBe('monospace')
    expect(root().getPropertyValue(FONT_VARIABLES.heading)).toBe('monospace')
    load({ heading: 'Georgia' })
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toBe('monospace')
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe('var(--font-mono)')
  })

  it('takes a list, with or without quotes, and gives CSS one name per entry', () => {
    expect(familyStack('body', '"Fira Sans", Arial')).toBe('"Fira Sans", "Arial", monospace')
    expect(cssFamilyList("'Fira Sans' ,Arial")).toBe('"Fira Sans", "Arial"')
  })

  it('quotes a name CSS would not read bare, so it cannot blank the whole declaration', () => {
    // An unquoted name that starts with a digit is invalid CSS: the declaration would be dropped
    // and the text would not fall back to the built-in family.
    expect(cssFamilyList('3270 Font')).toBe('"3270 Font"')
    expect(cssFamilyList('A+B')).toBe('"A+B"')
    expect(cssFamilyList('Say "hi" now')).toBe('"Say \\"hi\\" now"')
    expect(cssFamilyList('"Unclosed')).toBe('"Unclosed"')
  })

  it('leaves the generic keywords as keywords, and drops empty entries', () => {
    expect(cssFamilyList('Georgia, serif')).toBe('"Georgia", serif')
    expect(cssFamilyList(' , ,')).toBe('')
    expect(familyStack('body', ' , ')).toBe('monospace')
  })
})

describe('ISC-361: an empty family is the built-in stack', () => {
  it('is the built-in family for each kind, and headings follow the body family', () => {
    load({ heading: '', body: '', code: '' })
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toBe('monospace')
    expect(root().getPropertyValue(FONT_VARIABLES.heading)).toBe('monospace')
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe('var(--font-mono)')
    load({ body: 'Segoe UI' })
    expect(root().getPropertyValue(FONT_VARIABLES.heading)).toBe('"Segoe UI", monospace')
  })

  it('goes back to the built-in stack when the keys are taken out of the file', () => {
    load({ heading: 'Georgia', body: 'Segoe UI', code: 'Consolas' })
    applySettingsText('{}')
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toBe('monospace')
    expect(root().getPropertyValue(FONT_VARIABLES.heading)).toBe('monospace')
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe('var(--font-mono)')
  })

  it('every stack ends in a family that always exists', () => {
    for (const kind of ['heading', 'body', 'code'] as const) {
      expect(familyStack(kind, 'No Such Font')).toMatch(/(monospace|var\(--font-mono\))$/)
    }
  })
})

describe('ISC-362: the size and each heading level follow the settings', () => {
  it('sets the body size in px and the six heading multiples', () => {
    load({ size: 20, headingScale: [2, 1.8, 1.6, 1.4, 1.2, 1] })
    expect(root().getPropertyValue(FONT_VARIABLES.size)).toBe('20px')
    for (const [index, multiple] of [2, 1.8, 1.6, 1.4, 1.2, 1].entries()) {
      expect(root().getPropertyValue(FONT_VARIABLES.headingScale(index + 1))).toBe(String(multiple))
    }
  })

  it('has the sizes the headings always had, until the file changes them', () => {
    updateDocumentFonts()
    expect(root().getPropertyValue(FONT_VARIABLES.size)).toBe('15px')
    expect(
      [1, 2, 3, 4, 5, 6].map((level) =>
        root().getPropertyValue(FONT_VARIABLES.headingScale(level)),
      ),
    ).toEqual(['1.7', '1.45', '1.25', '1.1', '1', '0.95'])
  })

  it('leaves a size that is refused where it was', () => {
    load({ size: 20 })
    load({ size: 'big' })
    expect(root().getPropertyValue(FONT_VARIABLES.size)).toBe('20px')
  })
})

/** The text of one rule of an editor theme file: from its selector to the closing brace. */
function ruleOf(file: string, selector: string): string {
  const text = readFileSync(join('src/editor', file), 'utf8')
  const start = text.indexOf(`'${selector}': {`)
  if (start < 0) throw new Error(`${file} has no rule ${selector}`)
  return text.slice(start, text.indexOf('}', start) + 1)
}

/** The rules that draw inline code: in text, and in a table cell. */
const INLINE_CODE_RULES = [
  ['livePreview/theme.ts', '.cm-md-code'],
  ['livePreview/blocks/theme.ts', '.cm-md-table code'],
] as const

describe('ISC-563: inline code is at the size of the text around it', () => {
  it.each(INLINE_CODE_RULES)(
    '%s: %s has the code family at 1em and reads no code size',
    (file, selector) => {
      const rule = ruleOf(file, selector)
      expect(rule).toContain(`var(${FONT_VARIABLES.code},`)
      expect(rule).toMatch(/fontSize: '1em'/)
      expect(rule).not.toContain(FONT_VARIABLES.codeRatio)
    },
  )

  it('stays at the text size however the code size is set', () => {
    // jsdom cannot draw `var()`, so this checks the two ends: the code size goes to a property
    // that only the block rule reads, and the inline rules read no property of the code size.
    load({ size: 15, codeSize: 18 })
    expect(Number(root().getPropertyValue(FONT_VARIABLES.codeRatio)) * 15).toBeCloseTo(18, 10)
    for (const [file, selector] of INLINE_CODE_RULES) {
      expect(ruleOf(file, selector), file).not.toMatch(/--doc-code-(ratio|size)/)
    }
  })

  it('has no other rule that sizes inline code', () => {
    // Every use of the ratio in the editor is the block rule.
    const users = [
      'create.ts',
      'livePreview/theme.ts',
      'livePreview/blocks/theme.ts',
      'livePreview/box.ts',
    ].filter((file) =>
      readFileSync(join('src/editor', file), 'utf8').includes(FONT_VARIABLES.codeRatio),
    )
    // The code block, and the line-number gutter, which sizes its numbers from the code size (T21).
    expect(users).toEqual(['create.ts', 'livePreview/box.ts'])
    const create = readFileSync(join('src/editor', 'create.ts'), 'utf8')
    const uses = create.split('\n').filter((line) => line.includes(FONT_VARIABLES.codeRatio))
    expect(uses).toHaveLength(1)
    expect(uses[0]).toContain('* 0.9')
  })
})

/** Every rule that draws code text: inline code in text, in a table cell, and a code block. */
const CODE_TEXT_RULES = [...INLINE_CODE_RULES, ['livePreview/box.ts', '.cm-md-box-code']] as const

describe('ISC-581: code text uses the code font from the settings', () => {
  it.each(CODE_TEXT_RULES)('%s: %s takes the code family and nothing else', (file, selector) => {
    const rule = ruleOf(file, selector)
    expect(rule).toContain("fontFamily: 'var(--doc-font-code, var(--font-mono))'")
    expect(rule).not.toMatch(/--doc-font-(body|heading)|--font-sans/)
  })

  it('puts the configured code font first, ahead of the built-in code stack', () => {
    load({ code: 'Fira Code, "JetBrains Mono"' })
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe(
      '"Fira Code", "JetBrains Mono", var(--font-mono)',
    )
    // The body font does not reach it.
    load({ body: 'Georgia', code: '' })
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe('var(--font-mono)')
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toContain('Georgia')
  })
})

describe('ISC-363: the code size is its own setting', () => {
  it('sets the code size as a multiple of the text size and leaves the text size alone', () => {
    load({ codeSize: 18 })
    expect(Number(root().getPropertyValue(FONT_VARIABLES.codeRatio)) * 15).toBeCloseTo(18, 10)
    expect(root().getPropertyValue(FONT_VARIABLES.size)).toBe('15px')
  })

  it('keeps the code at its own size when the text size changes', () => {
    load({ size: 20, codeSize: 18 })
    expect(Number(root().getPropertyValue(FONT_VARIABLES.codeRatio)) * 20).toBeCloseTo(18, 10)
    load({ size: 30, codeSize: 18 })
    expect(Number(root().getPropertyValue(FONT_VARIABLES.codeRatio)) * 30).toBeCloseTo(18, 10)
  })

  it('sizes the code blocks as a multiple of the surrounding text', () => {
    // The rule is `calc(ratio * 1em)`: 1em is the text the block sits in. A fixed px size here
    // would not follow the text size setting. The ratio is for blocks only (ISC-563).
    const rule = ruleOf('livePreview/box.ts', '.cm-md-box-code')
    expect(rule).toMatch(/calc\(var\(--doc-code-ratio, [^)]+\)+ \* 1em\)/)
    expect(rule).not.toMatch(/--doc-code-size/)
  })
})

describe('a change reaches the editors that are open, once', () => {
  const views: EditorView[] = []
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy()
    document.body.replaceChildren()
  })

  function open(): EditorView {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = createView(parent, createState('# Title\n\ntext', [], { preview: true }))
    views.push(view)
    return view
  }

  it('asks each open view to measure again when a font changes', () => {
    const first = open()
    const second = open()
    const measureFirst = vi.spyOn(first, 'requestMeasure')
    const measureSecond = vi.spyOn(second, 'requestMeasure')
    load({ size: 20 })
    expect(measureFirst).toHaveBeenCalledTimes(1)
    expect(measureSecond).toHaveBeenCalledTimes(1)
  })

  it('does not ask again for a change that is not about fonts', () => {
    load({ size: 20 })
    const view = open()
    const measure = vi.spyOn(view, 'requestMeasure')
    applySettingsText(JSON.stringify({ fonts: { size: 20 }, recent: { files: 4 } }))
    expect(measure).not.toHaveBeenCalled()
  })

  it('forgets a view that was closed', () => {
    const view = open()
    const measure = vi.spyOn(view, 'requestMeasure')
    view.destroy()
    views.splice(0)
    load({ size: 22 })
    expect(measure).not.toHaveBeenCalled()
  })
})

describe('the properties are what the editor theme reads', () => {
  const theme = (file: string): string => readFileSync(join('src/editor', file), 'utf8')

  it('the body, heading and code rules name the property for their kind of text', () => {
    const create = theme('create.ts')
    expect(create).toContain(`var(${FONT_VARIABLES.body},`)
    expect(create).toContain(`var(${FONT_VARIABLES.size},`)
    const preview = theme('livePreview/theme.ts')
    expect(preview).toContain(`var(${FONT_VARIABLES.heading},`)
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(preview).toContain(`var(${FONT_VARIABLES.headingScale(level)},`)
    }
    for (const file of [
      'livePreview/theme.ts',
      'livePreview/blocks/theme.ts',
      'livePreview/box.ts',
    ]) {
      expect(theme(file), file).toContain(`var(${FONT_VARIABLES.code},`)
    }
    // Only the code blocks read the code size (ISC-563).
    expect(theme('livePreview/box.ts')).toContain(`var(${FONT_VARIABLES.codeRatio},`)
  })

  it('has fallbacks that are the defaults, for a file that is not read yet or cannot be', () => {
    const fallback = (text: string, name: string): string | undefined =>
      new RegExp(`var\\(${name}, (calc\\([^)]*\\)|[^)]+)\\)`).exec(text)?.[1]
    expect(fallback(theme('create.ts'), FONT_VARIABLES.size)).toBe(
      `${DEFAULT_SETTINGS.fonts.size}px`,
    )
    const preview = theme('livePreview/theme.ts')
    DEFAULT_SETTINGS.fonts.headingScale.forEach((multiple, index) => {
      expect(fallback(preview, FONT_VARIABLES.headingScale(index + 1))).toBe(String(multiple))
    })
    expect(fallback(theme('livePreview/box.ts'), FONT_VARIABLES.codeRatio)).toBe(
      `calc(${DEFAULT_SETTINGS.fonts.codeSize} / ${DEFAULT_SETTINGS.fonts.size})`,
    )
  })

  it('has no em size left in the code rules that the setting should own', () => {
    // The old literal was `fontSize: '0.92em'` beside the code family.
    for (const file of [
      'livePreview/theme.ts',
      'livePreview/blocks/theme.ts',
      'livePreview/box.ts',
    ]) {
      expect(theme(file), file).not.toMatch(/fontSize: '0\.92em'/)
    }
  })
})

describe('ISC-392: only the editor reads the font properties', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? sources(path) : [path]
    })
  }

  it('names a --doc- property in no file outside src/editor and the code that sets them', () => {
    const allowed = (path: string): boolean => path.replaceAll('\\', '/').startsWith('src/editor/')
    const readers = sources('src')
      .filter((path) => /\.(ts|vue|css)$/.test(path))
      .filter((path) => readFileSync(path, 'utf8').includes('--doc-'))
      .filter((path) => !allowed(path))
    expect(readers).toEqual([])
  })

  it('has the page chrome on the app font tokens, not on the document ones', () => {
    const tokens = readFileSync('src/styles/tokens.css', 'utf8')
    expect(tokens).not.toContain('--doc-')
    expect(documentFontVariables()).not.toHaveProperty('--font-sans')
  })
})
