// @vitest-environment jsdom
/**
 * ISC-70: a fenced block is colored by the language its fence names, with the theme's syntax
 * tokens. The lazy loading that ISC-71 asks for is in codeLanguagesLazy.test.ts (runtime) and
 * `node scripts/check-arch.mjs languages-lazy` (the entry bundle of a build).
 *
 * The colors are read as the class `highlightTree` gives each token, which is the class the page
 * puts on its span, and compared with the class the style gives a tag. Which color a class has is
 * a property of `tokenHighlight`, tested at the end against the theme files.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { syntaxTree } from '@codemirror/language'
import { highlightTree, tags as t, type Tag } from '@lezer/highlight'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { codeLanguage } from '@/editor/codeLanguages'
import { createState, createView } from '@/editor/create'
import { tokenHighlight } from '@/editor/highlight'

// Each block waits for a parser to load, which can take longer than the default test time.
vi.setConfig({ testTimeout: 30_000 })

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

function mount(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createView(parent, createState(doc, [], { preview: true }))
  views.push(view)
  return view
}

/** `text=class` for every highlighted piece of the document as it is parsed now. */
function pieces(view: EditorView): Map<string, string> {
  const doc = view.state.doc.toString()
  const found = new Map<string, string>()
  highlightTree(syntaxTree(view.state), tokenHighlight, (from, to, classes) => {
    found.set(doc.slice(from, to), classes)
  })
  return found
}

/** The class the style gives a tag, which is what a token of that kind carries on the page. */
function classOf(...tags: Tag[]): string {
  const classes = tokenHighlight.style(tags)
  if (classes === null) throw new Error('the style has no class for these tags')
  return classes
}

/** Waits until `text` is a highlighted piece, which happens once its block's parser has loaded. */
async function colored(view: EditorView, text: string): Promise<void> {
  await vi.waitFor(() => expect(pieces(view).has(text)).toBe(true), { timeout: 15_000 })
}

describe('the fence word', () => {
  it('gives no language for nothing, for blanks, or for a word that is too long', () => {
    expect(codeLanguage('')).toBeNull()
    expect(codeLanguage('   ')).toBeNull()
    expect(codeLanguage('x'.repeat(41))).toBeNull()
  })

  it('gives the same description for the same word in any case, so a language loads once', () => {
    const first = codeLanguage('js')
    expect(first).not.toBeNull()
    expect(codeLanguage('js')).toBe(first)
    expect(codeLanguage(' JS ')).toBe(first)
    expect(codeLanguage('ts')).not.toBe(first)
  })

  it('does not load anything until a block asks', () => {
    const description = codeLanguage('go')
    expect(description?.support).toBeUndefined()
  })

  it('loads one parser for a name and its aliases, and another for another language', async () => {
    const js = await codeLanguage('js')?.load()
    expect(js).toBeDefined()
    expect(await codeLanguage('javascript')?.load()).toBe(js)
    // "py" and "rs" are file extensions, not names or aliases in the list: they must still find a language.
    const python = await codeLanguage('python')?.load()
    expect(python?.language.name).toBe('python')
    expect((await codeLanguage('py')?.load())?.language).toBe(python?.language)
    expect((await codeLanguage('rs')?.load())?.language.name).toBe('rust')
    expect((await codeLanguage('yml')?.load())?.language.name).toBe('yaml')
    expect(python).not.toBe(js)
    expect(await codeLanguage('not-a-language-at-all')?.load()).not.toBe(js)
  })

  it('treats a word the list does not know as plain text, and says so without failing', async () => {
    const support = await codeLanguage('not-a-language-at-all')?.load()
    expect(support).toBeDefined()
    const view = mount('```not-a-language-at-all\nlet x = 1\n```\n')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(pieces(view).has('let')).toBe(false)
    expect(view.state.doc.toString()).toContain('let x = 1')
  })
})

describe('a fenced block (ISC-70)', () => {
  it('is plain on first sight and colored once its parser has loaded', async () => {
    // No other test in this file loads Go, so this block really is the first to ask for it.
    const view = mount('# t\n\n```go\nfunc main() { x := 42 } // note\n```\n')
    expect(pieces(view).has('func')).toBe(false)
    await colored(view, 'func')
    expect(pieces(view).get('func')).toBe(classOf(t.keyword))
    expect(pieces(view).get('42')).toBe(classOf(t.number))
    expect(pieces(view).get('// note')).toBe(classOf(t.lineComment))
  })

  it.each([
    [
      'js',
      'const a = "s" // c',
      { const: [t.keyword], '"s"': [t.string], '// c': [t.lineComment] },
    ],
    ['ts', 'let n: number = 1', { let: [t.keyword], number: [t.typeName], '1': [t.number] }],
    ['python', 'def f():\n    return 7', { def: [t.keyword], '7': [t.number] }],
    ['py', 'def f(): pass', { def: [t.keyword] }],
    ['json', '{"k": "v", "n": 1}', { '"v"': [t.string], '1': [t.number] }],
    ['css', 'a { margin: 0 /* c */ }', { '/* c */': [t.blockComment] }],
    ['sh', 'echo "hi" # c', { '"hi"': [t.string], '# c': [t.comment] }],
  ] as const)('colors %s with the style of each token kind', async (word, code, expected) => {
    const view = mount(`\`\`\`${word}\n${code}\n\`\`\`\n`)
    for (const [text, tags] of Object.entries(expected)) {
      await colored(view, text)
      expect(pieces(view).get(text), `${word}: ${text}`).toBe(
        tokenHighlight.style([...tags]) ?? 'no class',
      )
    }
  })

  it('colors in the words of a fence written in capitals', async () => {
    const view = mount('```JS\nconst a = 1\n```\n')
    await colored(view, 'const')
    expect(pieces(view).get('const')).toBe(classOf(t.keyword))
  })

  it('colors each block by its own language', async () => {
    const view = mount('```python\nreturn 1\n```\n\n```rust\nfn main() {}\n```\n')
    await colored(view, 'return')
    await colored(view, 'fn')
    expect(pieces(view).get('return')).toBe(classOf(t.keyword))
    expect(pieces(view).get('fn')).toBe(classOf(t.keyword))
  })

  it('leaves the text of the block exactly as it is: coloring edits nothing', async () => {
    const doc = '```js\nconst a = 1\n```\n'
    const view = mount(doc)
    await colored(view, 'const')
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('keeps the block editable: typing inside it is colored again', async () => {
    const view = mount('```js\nconst a = 1\n```\n')
    await colored(view, 'const')
    const at = view.state.doc.toString().indexOf('1')
    view.dispatch({ changes: { from: at, to: at + 1, insert: '"text"' } })
    await colored(view, '"text"')
    expect(pieces(view).get('"text"')).toBe(classOf(t.string))
    expect(view.state.doc.toString()).toContain('const a = "text"')
  })
})

describe('the colors', () => {
  const themes = ['light', 'dark'].map((name) =>
    readFileSync(join(process.cwd(), 'src', 'styles', 'themes', `${name}.css`), 'utf8'),
  )
  const rules = tokenHighlight.module?.getRules() ?? ''

  it('are theme tokens, never color values', () => {
    expect(rules.length).toBeGreaterThan(0)
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb|hsl|oklch|color-mix/)
    expect(rules).toContain('var(--syntax-keyword)')
  })

  it('all exist in both themes', () => {
    const used = new Set(rules.match(/--syntax-[a-z-]+/g))
    expect(used.size).toBeGreaterThanOrEqual(8)
    for (const [i, theme] of themes.entries()) {
      for (const token of used) {
        expect(theme, `${['light', 'dark'][i] ?? ''} theme: ${token}`).toMatch(
          new RegExp(`${token}\\s*:`),
        )
      }
    }
  })

  it('give keywords, strings, numbers and comments four different classes', () => {
    const classes = new Set([
      classOf(t.keyword),
      classOf(t.string),
      classOf(t.number),
      classOf(t.comment),
      classOf(t.typeName),
      classOf(t.function(t.variableName)),
    ])
    expect(classes.size).toBe(6)
  })
})
