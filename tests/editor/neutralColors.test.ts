// @vitest-environment jsdom
/**
 * Headings and inline code take their color from the theme tokens, which the three themes set to
 * the body text color (ISC-694, ISC-695), and the toast warning icon no longer borrows the heading
 * token (ISC-696).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

function open(): void {
  const parent = document.createElement('div')
  document.body.append(parent)
  views.push(createView(parent, createState('###### Six\n\n`code`', [], { preview: true })))
}

/** The style rules CodeMirror injected, as selector and body (spacing taken out). */
function rules(): { selector: string; body: string }[] {
  const text: string[] = []
  for (const style of document.querySelectorAll('style')) text.push(style.textContent ?? '')
  for (const sheet of document.adoptedStyleSheets)
    for (const rule of sheet.cssRules) text.push(rule.cssText)
  const found: { selector: string; body: string }[] = []
  for (const match of text.join('\n').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    found.push({
      selector: (match[1] ?? '').replace(/\s+/g, ' ').trim(),
      body: (match[2] ?? '').replace(/\s+/g, ''),
    })
  }
  return found
}

const bodyOf = (selector: string): string =>
  rules()
    .filter((rule) => rule.selector.endsWith(selector))
    .map((rule) => rule.body)
    .join(';')

const root = resolve(import.meta.dirname, '../..')

describe('heading and code colors come from the tokens (ISC-694, ISC-695)', () => {
  it('colors every heading level with the heading token, and level 6 sets no color of its own', () => {
    open()
    expect(bodyOf('.cm-md-h')).toContain('color:var(--syntax-heading)')
    expect(bodyOf('.cm-md-h6')).not.toContain('color')
  })

  it('keeps the inline code color on the code token, in the document and in table cells', () => {
    open()
    expect(bodyOf('.cm-md-code')).toContain('color:var(--syntax-code)')
    const cells = readFileSync(resolve(root, 'src/editor/livePreview/blocks/theme.ts'), 'utf8')
    expect(cells).toContain("color: 'var(--syntax-code)'")
  })

  it('colors headings in the source view with the same token', () => {
    const source = readFileSync(resolve(root, 'src/editor/highlight.ts'), 'utf8')
    expect(source).toMatch(/tag: t\.heading[^}]*var\(--syntax-heading\)/)
  })
})

describe('the toast warning icon (ISC-696)', () => {
  it('reads --warning and no heading token', () => {
    const css = readFileSync(resolve(root, 'src/styles/toasts.css'), 'utf8')
    const rule = /\[data-type='warning'\]\s*\[data-icon\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('var(--warning)')
    expect(css).not.toContain('--syntax-heading')
  })
})
