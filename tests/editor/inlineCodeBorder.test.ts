// @vitest-environment jsdom
/**
 * The border and the padding of code (ISC-711, ISC-712): inline code, in text and in a table cell,
 * has a 1px border in the code border token and a little padding; the part a selection covers draws
 * no border; a code block takes its border from the same token and other containers keep theirs.
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
  views.push(
    createView(parent, createState('use `pnpm dev` now\n\n```ts\nx\n```', [], { preview: true })),
  )
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

describe('inline code has a border and padding (ISC-711)', () => {
  it('draws a 1px border in the code border token with no padding above and below and 2px at the sides', () => {
    open()
    const body = bodyOf('.cm-md-code')
    expect(body).toContain('border:1pxsolidvar(--syntax-code-border)')
    expect(body).toContain('padding:02px')
    // Optically scaled to the text around it (ISC-717).
    expect(body).toContain('font-size:calc(var(--doc-inline-code-scale,0.82)*1em)')
  })

  it('draws the same in a table cell', () => {
    open()
    const body = bodyOf('.cm-md-table code')
    expect(body).toContain('border:1pxsolidvar(--syntax-code-border)')
    expect(body).toContain('padding:02px')
    expect(body).toContain('font-size:calc(var(--doc-inline-code-scale,0.82)*1em)')
  })

  it('leaves the border off the part a selection covers, and keeps the padding so nothing moves', () => {
    open()
    const body = bodyOf('.cm-md-code.cm-md-code-selected')
    expect(body).toContain('border-color:transparent')
    expect(body).not.toContain('padding')
  })
})

describe('a code block takes its border from the same token (ISC-712)', () => {
  it('sets the border of a code container to the token, and leaves other containers the plain one', () => {
    open()
    expect(bodyOf('.cm-md-box-code')).toContain('--box-border:var(--syntax-code-border)')
    expect(bodyOf('.cm-md-box')).toContain('--box-border:var(--border)')
  })
})

describe('the token is wired up everywhere a token is (ISC-710)', () => {
  const read = (path: string): string =>
    readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')

  it('is mapped to a Tailwind color', () => {
    expect(read('src/styles/tokens.css')).toContain(
      '--color-syntax-code-border: var(--syntax-code-border);',
    )
  })
})
