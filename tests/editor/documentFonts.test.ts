// @vitest-environment jsdom
/**
 * The fonts of the document text (P8-T1e: ISC-360 to ISC-363, ISC-392; P9.1-T5: ISC-563;
 * P9.1-T38: ISC-716, ISC-717). The settings put values on the page's root as custom properties;
 * the editor's theme is the only reader. jsdom cannot resolve `var()` into a drawn size, so what
 * is checked here is the chain on each side of that step: the file to the properties, and the
 * properties to the theme rules by name.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import {
  BUILT_IN_BODY_FAMILY,
  BUILT_IN_CODE_FAMILY,
  BUILT_IN_HEADING_FAMILY,
  cssFamilyList,
  documentFontVariables,
  familyStack,
  FONT_VARIABLES,
  resetDocumentFonts,
  updateDocumentFonts,
} from '@/editor/documentFonts'
import { applySettingsText, resetSettingsState } from '@/features/settings/store'
import { FONT_PRESETS } from '@/lib/fontPresets'
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
    expect(css.getPropertyValue(FONT_VARIABLES.body)).toBe(`"Segoe UI", ${BUILT_IN_BODY_FAMILY}`)
    expect(css.getPropertyValue(FONT_VARIABLES.heading)).toBe(
      `"Georgia", ${BUILT_IN_HEADING_FAMILY}`,
    )
    expect(css.getPropertyValue(FONT_VARIABLES.code)).toBe(`"Consolas", ${BUILT_IN_CODE_FAMILY}`)
  })

  it('does not let one family leak into another kind', () => {
    load({ code: 'Consolas' })
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toBe(BUILT_IN_BODY_FAMILY)
    expect(root().getPropertyValue(FONT_VARIABLES.heading)).toBe(BUILT_IN_HEADING_FAMILY)
    load({ heading: 'Georgia' })
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toBe(BUILT_IN_BODY_FAMILY)
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe(BUILT_IN_CODE_FAMILY)
  })

  it('takes a list, with or without quotes, and gives CSS one name per entry', () => {
    expect(familyStack('body', '"Fira Sans", Arial')).toBe(
      `"Fira Sans", "Arial", ${BUILT_IN_BODY_FAMILY}`,
    )
    expect(cssFamilyList("'Fira Sans' ,Arial")).toBe('"Fira Sans", "Arial"')
  })

  it('expands bundled variable display names to their bundled faces (ISC-716)', () => {
    expect(cssFamilyList('Montserrat')).toBe('"Montserrat Variable", "Montserrat"')
    expect(cssFamilyList('Lora')).toBe('"Lora Variable", "Lora"')
    expect(cssFamilyList('Fira Code, "JetBrains Mono"')).toBe(
      '"Fira Code Variable", "Fira Code", "JetBrains Mono Variable", "JetBrains Mono"',
    )
    expect(cssFamilyList('IBM Plex Mono')).toBe('"IBM Plex Mono"')
  })

  it('quotes a name CSS would not read bare, so it cannot blank the whole declaration', () => {
    // An unquoted name that starts with a digit is invalid CSS: the declaration would be dropped
    // and the text would not fall back to the preset family.
    expect(cssFamilyList('3270 Font')).toBe('"3270 Font"')
    expect(cssFamilyList('A+B')).toBe('"A+B"')
    expect(cssFamilyList('Say "hi" now')).toBe('"Say \\"hi\\" now"')
    expect(cssFamilyList('"Unclosed')).toBe('"Unclosed"')
  })

  it('leaves the generic keywords as keywords, and drops empty entries', () => {
    expect(cssFamilyList('Georgia, serif')).toBe('"Georgia", serif')
    expect(cssFamilyList(' , ,')).toBe('')
    expect(familyStack('body', ' , ')).toBe(BUILT_IN_BODY_FAMILY)
  })
})

describe('ISC-361 & ISC-716: an empty family uses the active preset stack', () => {
  it('uses System by default and switches cleanly for Editorial, Modern and Journal', () => {
    load({ heading: '', body: '', code: '' })
    expect(root().getPropertyValue(FONT_VARIABLES.heading)).toBe('monospace')
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toBe('monospace')
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe('var(--font-mono)')

    load({ preset: 'editorial' })
    expect(root().getPropertyValue(FONT_VARIABLES.heading)).toBe(
      FONT_PRESETS.editorial.heading.stack,
    )
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toBe(FONT_PRESETS.editorial.body.stack)
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe(FONT_PRESETS.editorial.code.stack)

    load({ preset: 'modern' })
    expect(root().getPropertyValue(FONT_VARIABLES.heading)).toBe(FONT_PRESETS.modern.heading.stack)
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toBe(FONT_PRESETS.modern.body.stack)
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe(FONT_PRESETS.modern.code.stack)

    load({ preset: 'journal' })
    expect(root().getPropertyValue(FONT_VARIABLES.heading)).toBe(FONT_PRESETS.journal.heading.stack)
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toBe(FONT_PRESETS.journal.body.stack)
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe(FONT_PRESETS.journal.code.stack)
  })

  it('goes back to the default preset stack when the keys are taken out of the file', () => {
    load({ preset: 'modern', heading: 'Georgia', body: 'Segoe UI', code: 'Consolas' })
    applySettingsText('{}')
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toBe(BUILT_IN_BODY_FAMILY)
    expect(root().getPropertyValue(FONT_VARIABLES.heading)).toBe(BUILT_IN_HEADING_FAMILY)
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe(BUILT_IN_CODE_FAMILY)
  })

  it('every stack ends in a family that always exists', () => {
    for (const kind of ['heading', 'body', 'code'] as const) {
      expect(familyStack(kind, 'No Such Font')).toMatch(
        /(monospace|serif|sans-serif|var\(--font-mono\))$/,
      )
    }
  })
})

describe('ISC-362 & ISC-716: the size and each heading level follow the settings', () => {
  it('sets the body size in px and the six heading multiples', () => {
    load({ size: 20, headingScale: [2, 1.8, 1.6, 1.4, 1.2, 1] })
    expect(root().getPropertyValue(FONT_VARIABLES.size)).toBe('20px')
    for (const [index, multiple] of [2, 1.8, 1.6, 1.4, 1.2, 1].entries()) {
      expect(root().getPropertyValue(FONT_VARIABLES.headingScale(index + 1))).toBe(String(multiple))
    }
  })

  it('has default size 16px, lineHeight 1.5 and the six heading multiples until the file changes them', () => {
    updateDocumentFonts()
    expect(root().getPropertyValue(FONT_VARIABLES.size)).toBe('16px')
    expect(root().getPropertyValue(FONT_VARIABLES.lineHeight)).toBe('1.5')
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
  return text.slice(start, text.indexOf('\n  },', start) + 5)
}

/** The rules that draw inline code: in text, and in a table cell. */
const INLINE_CODE_RULES = [
  ['livePreview/theme.ts', '.cm-md-code'],
  ['livePreview/blocks/theme.ts', '.cm-md-table code'],
] as const

describe('ISC-563 & ISC-717: inline code scales optically with its surroundings and ignores codeSize', () => {
  it.each(INLINE_CODE_RULES)(
    '%s: %s has the code family, reads --doc-inline-code-scale and reads no code size',
    (file, selector) => {
      const rule = ruleOf(file, selector)
      expect(rule).toContain(`var(${FONT_VARIABLES.code},`)
      expect(rule).toMatch(/fontSize: 'calc\(var\(--doc-inline-code-scale, 0\.82\) \* 1em\)'/)
      expect(rule).not.toContain(FONT_VARIABLES.codeRatio)
    },
  )

  it('sets --doc-inline-code-scale to 0.82 for System/monospace and 0.9 for Editorial, Modern, Journal and custom fonts', () => {
    load({ preset: 'system' })
    expect(root().getPropertyValue(FONT_VARIABLES.inlineCodeScale)).toBe('0.82')
    load({ preset: 'editorial' })
    expect(root().getPropertyValue(FONT_VARIABLES.inlineCodeScale)).toBe('0.9')
    load({ preset: 'modern' })
    expect(root().getPropertyValue(FONT_VARIABLES.inlineCodeScale)).toBe('0.9')
    load({ preset: 'journal' })
    expect(root().getPropertyValue(FONT_VARIABLES.inlineCodeScale)).toBe('0.9')
    load({ preset: 'editorial', body: 'Georgia' })
    expect(root().getPropertyValue(FONT_VARIABLES.inlineCodeScale)).toBe('0.9')
    load({ preset: 'modern', body: 'monospace' })
    expect(root().getPropertyValue(FONT_VARIABLES.inlineCodeScale)).toBe('0.82')
  })

  it('stays independent of codeSize', () => {
    load({ size: 16, codeSize: 18 })
    expect(Number(root().getPropertyValue(FONT_VARIABLES.codeRatio)) * 16).toBeCloseTo(18, 10)
    for (const [file, selector] of INLINE_CODE_RULES) {
      expect(ruleOf(file, selector), file).not.toMatch(/--doc-code-(ratio|size)/)
    }
  })

  it('reads --doc-code-ratio only in code blocks, source mode and the line-number gutter', () => {
    const users = [
      'create.ts',
      'livePreview/theme.ts',
      'livePreview/blocks/theme.ts',
      'livePreview/box.ts',
    ].filter((file) =>
      readFileSync(join('src/editor', file), 'utf8').includes(FONT_VARIABLES.codeRatio),
    )
    expect(users).toEqual(['create.ts', 'livePreview/box.ts'])
  })
})

/** Every rule that draws code text: inline code in text, in a table cell, and a code block. */
const CODE_TEXT_RULES = [...INLINE_CODE_RULES, ['livePreview/box.ts', '.cm-md-box-code']] as const

describe('ISC-581: code text uses the code font from the settings', () => {
  it.each(CODE_TEXT_RULES)('%s: %s takes the code family and nothing else', (file, selector) => {
    const rule = ruleOf(file, selector)
    expect(rule).toContain('var(--doc-font-code,')
    expect(rule).not.toMatch(/--doc-font-(body|heading)|--font-sans/)
  })

  it('puts the configured code font first, ahead of the active preset code stack', () => {
    load({ code: 'Fira Code, "JetBrains Mono"' })
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe(
      `"Fira Code Variable", "Fira Code", "JetBrains Mono Variable", "JetBrains Mono", ${BUILT_IN_CODE_FAMILY}`,
    )
    // The body font does not reach it.
    load({ body: 'Georgia', code: '' })
    expect(root().getPropertyValue(FONT_VARIABLES.code)).toBe(BUILT_IN_CODE_FAMILY)
    expect(root().getPropertyValue(FONT_VARIABLES.body)).toContain('Georgia')
  })
})

describe('ISC-363: the code size is its own setting', () => {
  it('sets the code size as a multiple of the text size and leaves the text size alone', () => {
    load({ codeSize: 18 })
    expect(Number(root().getPropertyValue(FONT_VARIABLES.codeRatio)) * 16).toBeCloseTo(18, 10)
    expect(root().getPropertyValue(FONT_VARIABLES.size)).toBe('16px')
  })

  it('keeps the code at its own size when the text size changes', () => {
    load({ size: 20, codeSize: 18 })
    expect(Number(root().getPropertyValue(FONT_VARIABLES.codeRatio)) * 20).toBeCloseTo(18, 10)
    load({ size: 30, codeSize: 18 })
    expect(Number(root().getPropertyValue(FONT_VARIABLES.codeRatio)) * 30).toBeCloseTo(18, 10)
  })

  it('sizes the code blocks as a multiple of the surrounding text', () => {
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

  it('asks each open view to measure again when a font or preset changes', () => {
    const first = open()
    const second = open()
    const measureFirst = vi.spyOn(first, 'requestMeasure')
    const measureSecond = vi.spyOn(second, 'requestMeasure')
    load({ preset: 'modern' })
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
    expect(theme('livePreview/box.ts')).toContain(`var(${FONT_VARIABLES.codeRatio},`)
  })

  it('has fallbacks that are the defaults, for a file that is not read yet or cannot be', () => {
    const fallback = (text: string, name: string): string | undefined =>
      new RegExp(`var\\(${name}, (calc\\([^)]*\\)|[^)]+)\\)`).exec(text)?.[1]
    const system = FONT_PRESETS.system
    expect(fallback(theme('create.ts'), FONT_VARIABLES.size)).toBe(`${String(system.size)}px`)
    const preview = theme('livePreview/theme.ts')
    system.headingScale.forEach((multiple, index) => {
      expect(fallback(preview, FONT_VARIABLES.headingScale(index + 1))).toBe(String(multiple))
    })
    expect(fallback(theme('livePreview/box.ts'), FONT_VARIABLES.codeRatio)).toBe(
      `calc(${String(system.codeSize)} / ${String(system.size)})`,
    )
  })

  it('ISC-725: emits per-preset typography metrics and Compact density scaling into CSS properties', () => {
    const editorial = documentFontVariables({
      ...DEFAULT_SETTINGS.fonts,
      preset: 'editorial',
      density: 'comfort',
    })
    expect(editorial[FONT_VARIABLES.size]).toBe('18px')
    expect(editorial[FONT_VARIABLES.lineHeight]).toBe('1.6')
    expect(editorial[FONT_VARIABLES.codeRatio]).toBe(String(14 / 18))
    expect(editorial[FONT_VARIABLES.codeLineHeight]).toBe('1.5')

    const editorialCompact = documentFontVariables({
      ...DEFAULT_SETTINGS.fonts,
      preset: 'editorial',
      density: 'compact',
    })
    expect(editorialCompact[FONT_VARIABLES.size]).toBe('15px')
    expect(editorialCompact[FONT_VARIABLES.lineHeight]).toBe('1.5')
    expect(editorialCompact[FONT_VARIABLES.codeRatio]).toBe(String(12 / 15))
    expect(editorialCompact[FONT_VARIABLES.codeLineHeight]).toBe('1.4')

    const modernCompact = documentFontVariables({
      ...DEFAULT_SETTINGS.fonts,
      preset: 'modern',
      density: 'compact',
    })
    expect(modernCompact[FONT_VARIABLES.size]).toBe('15px')
    expect(modernCompact[FONT_VARIABLES.lineHeight]).toBe('1.5')
  })

  it('has no hardcoded 0.92em left in the code rules', () => {
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
