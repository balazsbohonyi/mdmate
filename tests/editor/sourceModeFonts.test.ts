// @vitest-environment jsdom
/**
 * Plain-source files and Markdown Raw Mode (P9.1-T38, ISC-718): both carry `.cm-source-mode`,
 * switching `.cm-content` to the code font, code size and code line height instead of the
 * proportional Markdown body font.
 */
import { readFileSync } from 'node:fs'
import { Text } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { createFollowerState, createState, createView, SOURCE_MODE_CLASS } from '@/editor/create'
import { previewEffect, previewShown } from '@/editor/previewMode'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

function mount(state: ReturnType<typeof createState>): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createView(parent, state)
  views.push(view)
  return view
}

describe('ISC-718: plain-source and Raw Mode use the code font', () => {
  it('marks plain-source states (parser: false) with cm-source-mode', () => {
    const follower = mount(createFollowerState({ doc: Text.of(['{}']), parser: false }))
    expect(follower.dom.classList.contains(SOURCE_MODE_CLASS)).toBe(true)

    const plain = mount(createState('{}', [], { parser: false }))
    expect(plain.dom.classList.contains(SOURCE_MODE_CLASS)).toBe(true)
  })

  it('leaves live-preview Markdown without cm-source-mode and adds it in Raw Mode', () => {
    const view = mount(createFollowerState({ doc: Text.of(['# Heading', '', 'Body text']) }))
    expect(previewShown(view.state)).toBe(true)
    expect(view.dom.classList.contains(SOURCE_MODE_CLASS)).toBe(false)

    const toRaw = previewEffect(view.state, false)
    expect(toRaw).not.toBeNull()
    if (toRaw !== null) view.dispatch({ effects: toRaw })
    expect(previewShown(view.state)).toBe(false)
    expect(view.dom.classList.contains(SOURCE_MODE_CLASS)).toBe(true)

    const toPreview = previewEffect(view.state, true)
    expect(toPreview).not.toBeNull()
    if (toPreview !== null) view.dispatch({ effects: toPreview })
    expect(previewShown(view.state)).toBe(true)
    expect(view.dom.classList.contains(SOURCE_MODE_CLASS)).toBe(false)
  })

  it('styles cm-source-mode content and gutter in create.ts with the code font, size and line height', () => {
    const source = readFileSync('src/editor/create.ts', 'utf8')
    const contentRuleStart = source.indexOf('[`&.${SOURCE_MODE_CLASS} .cm-content`]: {')
    expect(contentRuleStart).toBeGreaterThan(-1)
    const contentRule = source.slice(contentRuleStart, source.indexOf('\n  },', contentRuleStart))
    expect(contentRule).toContain('--doc-font-code')
    expect(contentRule).toContain('--doc-code-ratio')
    expect(contentRule).toContain('--doc-code-line-height')

    const gutterRuleStart = source.indexOf(
      '[`&.cm-lineNumbersOn.${SOURCE_MODE_CLASS} .cm-gutters`]: {',
    )
    expect(gutterRuleStart).toBeGreaterThan(-1)
    const gutterRule = source.slice(gutterRuleStart, source.indexOf('\n  },', gutterRuleStart))
    expect(gutterRule).toContain('--doc-code-line-height')
    expect(gutterRule).toContain('--doc-code-ratio')
  })
})
