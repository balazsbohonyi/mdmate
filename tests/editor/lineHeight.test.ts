// @vitest-environment jsdom
/**
 * The line heights of the document (P9.1-T20: ISC-626, ISC-627). Two settings put two unitless
 * numbers on the page's root, and the editor's theme is the only reader. jsdom cannot resolve
 * `var()` into a drawn height, so the CSS that CodeMirror injects is read as text: which rules
 * carry a line height, and which property each one reads. The drawn heights are read from the real
 * window (ISA Verification).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import {
  documentFontVariables,
  FONT_VARIABLES,
  resetDocumentFonts,
  updateDocumentFonts,
} from '@/editor/documentFonts'
import { applySettingsText, resetSettingsState } from '@/features/settings/store'
import { DEFAULT_SETTINGS, resetSettings } from '@/lib/settings'
import { injectedRules, valuesOf } from '../helpers/editorRules'

const root = (): CSSStyleDeclaration => document.documentElement.style

function load(fonts: Record<string, unknown>): void {
  applySettingsText(JSON.stringify({ fonts }))
}

const views: EditorView[] = []

function open(doc = '# Title\n\ntext'): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createView(parent, createState(doc, [], { preview: true }))
  views.push(view)
  return view
}

const rules = injectedRules
const lineHeightOf = (selector: string): string[] => valuesOf(selector, 'line-height')

beforeEach(() => {
  resetSettings()
  resetSettingsState()
  resetDocumentFonts()
})

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
  resetSettings()
  resetSettingsState()
  resetDocumentFonts()
})

describe('ISC-625: the properties carry the line heights', () => {
  it('has the line height CodeMirror always gave the text until the file changes it', () => {
    updateDocumentFonts()
    expect(root().getPropertyValue(FONT_VARIABLES.lineHeight)).toBe('1.4')
    expect(root().getPropertyValue(FONT_VARIABLES.codeLineHeight)).toBe('1.4')
    expect(DEFAULT_SETTINGS.fonts.lineHeight).toBe(1.4)
    expect(DEFAULT_SETTINGS.fonts.codeLineHeight).toBe(1.4)
  })

  it('sets the two properties from the file, each on its own', () => {
    load({ lineHeight: 2 })
    expect(root().getPropertyValue(FONT_VARIABLES.lineHeight)).toBe('2')
    expect(root().getPropertyValue(FONT_VARIABLES.codeLineHeight)).toBe('1.4')
    load({ codeLineHeight: 1.65 })
    expect(root().getPropertyValue(FONT_VARIABLES.lineHeight)).toBe('1.4')
    expect(root().getPropertyValue(FONT_VARIABLES.codeLineHeight)).toBe('1.65')
  })

  it('has no unit on either value, so it scales with the size of each line', () => {
    load({ lineHeight: 1.85, codeLineHeight: 2.5 })
    const variables = documentFontVariables()
    expect(variables[FONT_VARIABLES.lineHeight]).toMatch(/^\d+(\.\d+)?$/)
    expect(variables[FONT_VARIABLES.codeLineHeight]).toMatch(/^\d+(\.\d+)?$/)
  })

  it('leaves a value that is refused where it was', () => {
    load({ lineHeight: 2 })
    load({ lineHeight: 3.5, codeLineHeight: 0.9 })
    expect(root().getPropertyValue(FONT_VARIABLES.lineHeight)).toBe('2')
    expect(root().getPropertyValue(FONT_VARIABLES.codeLineHeight)).toBe('1.4')
  })
})

describe('ISC-626: the body, lists, quotes, tables and every heading take the body line height', () => {
  it('sets the body line height on the content, from the property, with today as the fallback', () => {
    open()
    expect(lineHeightOf('.cm-content')).toEqual([`var(${FONT_VARIABLES.lineHeight}, 1.4)`])
  })

  it('has no line height of its own on any heading level', () => {
    open('# one\n\n## two\n\n### three\n\n#### four\n\n##### five\n\n###### six\n')
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(lineHeightOf(`.cm-md-h${String(level)}`), `H${String(level)}`).toEqual([])
    }
    expect(lineHeightOf('.cm-md-h')).toEqual([])
  })

  it('leaves lists, quotes and tables to inherit the content line height', () => {
    open('- item\n\n> quote\n\n| a | b |\n| - | - |\n| 1 | 2 |\n')
    const selectors = [
      '.cm-md-quote',
      '.cm-md-list-mark',
      '.cm-md-table',
      '.cm-md-table td',
      '.cm-md-table th',
      '.cm-md-table-wrap',
    ]
    for (const selector of selectors) expect(lineHeightOf(selector), selector).toEqual([])
  })

  it('has a line height on only five owners: the scroller, the content, the gutter, the code box and its label', () => {
    // Anything else would be a line height the setting does not reach.
    open('# h\n\n```ts\nconst a = 1\n```\n\n| a |\n| - |\n| 1 |\n')
    const owners = rules()
      .filter((rule) => /(?:^|;)\s*line-height:/.test(rule.body))
      .flatMap((rule) => rule.selectors)
      .sort()
    expect(owners).toEqual(
      [
        '.cm-scroller',
        '.cm-content',
        '.cm-lineNumbersOn .cm-gutters',
        '.cm-md-box-code',
        '.cm-md-box-first[data-box-label]::after',
        '.cm-md-box-only[data-box-label]::after',
      ].sort(),
    )
  })

  it('keeps the gutter numbers on the lines they number, at any line height', () => {
    open()
    expect(lineHeightOf('.cm-lineNumbersOn .cm-gutters')).toEqual([
      `calc(var(${FONT_VARIABLES.lineHeight}, 1.4) * var(--doc-size, 15px))`,
    ])
  })

  it('changes the property live, and asks each open view to measure again', () => {
    const first = open()
    const second = open()
    const measureFirst = vi.spyOn(first, 'requestMeasure')
    const measureSecond = vi.spyOn(second, 'requestMeasure')
    load({ lineHeight: 2 })
    expect(root().getPropertyValue(FONT_VARIABLES.lineHeight)).toBe('2')
    expect(measureFirst).toHaveBeenCalledTimes(1)
    expect(measureSecond).toHaveBeenCalledTimes(1)
    load({ lineHeight: 1.2 })
    expect(root().getPropertyValue(FONT_VARIABLES.lineHeight)).toBe('1.2')
    expect(measureFirst).toHaveBeenCalledTimes(2)
  })

  it('goes back to the default when the key is taken out of the file', () => {
    load({ lineHeight: 2.2, codeLineHeight: 1.1 })
    applySettingsText('{}')
    expect(root().getPropertyValue(FONT_VARIABLES.lineHeight)).toBe('1.4')
    expect(root().getPropertyValue(FONT_VARIABLES.codeLineHeight)).toBe('1.4')
  })
})

describe('ISC-627: code blocks take the code line height and nothing else does', () => {
  it('sets the code box line height from its own property, with today as the fallback', () => {
    open('```ts\nconst a = 1\n```\n')
    expect(lineHeightOf('.cm-md-box-code')).toEqual([`var(${FONT_VARIABLES.codeLineHeight}, 1.4)`])
  })

  it('does not read the code property anywhere but the code block', () => {
    open('text `code` here\n\n```ts\nx\n```\n')
    const readers = rules()
      .filter((rule) => rule.body.includes(FONT_VARIABLES.codeLineHeight))
      .flatMap((rule) => rule.selectors)
    expect(readers).toEqual(['.cm-md-box-code'])
  })

  it('does not read the body property in the code block, so one does not move the other', () => {
    open('```ts\nx\n```\n')
    const box = rules().find((rule) => rule.selectors.includes('.cm-md-box-code'))
    expect(box?.body).not.toContain(FONT_VARIABLES.lineHeight)
  })

  it('has no line height on inline code, which follows the text around it', () => {
    open('text `code` here\n\n| a |\n| - |\n| `c` |\n')
    expect(lineHeightOf('.cm-md-code')).toEqual([])
    expect(lineHeightOf('.cm-md-table code')).toEqual([])
  })

  it('keeps the code box label on a fixed line height, since it is out of the flow of the lines', () => {
    open('```ts\nx\n```\n')
    expect(lineHeightOf('.cm-md-box-only[data-box-label]::after')).toEqual(['1.4'])
  })
})
