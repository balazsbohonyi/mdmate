import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { markdownSupport } from '@/editor/markdownSupport'

function nodeNames(doc: string, extension: Extension): Set<string> {
  const state = EditorState.create({ doc, extensions: [extension] })
  ensureSyntaxTree(state, doc.length, 5000)
  const names = new Set<string>()
  syntaxTree(state).iterate({
    enter(node) {
      names.add(node.name)
    },
  })
  return names
}

describe('the Markdown parser', () => {
  it('is GFM: the default markdown() has no strikethrough, ours does', () => {
    expect(nodeNames('a ~~gone~~ b', markdown()).has('Strikethrough')).toBe(false)
    expect(nodeNames('a ~~gone~~ b', markdownSupport()).has('Strikethrough')).toBe(true)
  })

  it('also parses tables and task lists, which Phase 4 needs', () => {
    const names = nodeNames('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] todo\n', markdownSupport())
    expect(names.has('Table')).toBe(true)
    expect(names.has('TaskMarker')).toBe(true)
  })
})
