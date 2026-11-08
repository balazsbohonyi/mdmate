// @vitest-environment jsdom
/**
 * ISC-71, the runtime half: the list of languages is code, and an editor that opens a file with
 * no fenced block must not fetch it. The module is replaced here by one that counts how often it
 * is imported and serves the real list; each test file has its own module registry, so the count
 * starts at zero. The other half, no parser in the entry bundle of a build, is
 * `node scripts/check-arch.mjs languages-lazy`.
 */
import { syntaxTree } from '@codemirror/language'
import { highlightTree } from '@lezer/highlight'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import { tokenHighlight } from '@/editor/highlight'

const listLoads = vi.hoisted(() => ({ count: 0 }))
vi.mock('@codemirror/language-data', async (importOriginal) => {
  listLoads.count++
  return await importOriginal<typeof import('@codemirror/language-data')>()
})

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

function highlighted(view: EditorView): Set<string> {
  const doc = view.state.doc.toString()
  const found = new Set<string>()
  highlightTree(syntaxTree(view.state), tokenHighlight, (from, to) =>
    found.add(doc.slice(from, to)),
  )
  return found
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 400))

describe('the language list is loaded on demand (ISC-71)', () => {
  it('is not fetched for documents with no fence word', async () => {
    mount('# Title\n\nsome `inline code` and text\n\n- [ ] task\n')
    mount('```\nno language named\n```\n')
    mount('~~~   \nblank info\n~~~\n')
    await settle()
    expect(listLoads.count).toBe(0)
  })

  it('is fetched once, when a block names a language, however many blocks and views', async () => {
    const first = mount('```js\nconst a = 1\n```\n\n```py\ndef f(): pass\n```\n')
    const second = mount('```rust\nlet a = 1;\n```\n')
    await vi.waitFor(
      () => {
        expect(highlighted(first).has('const')).toBe(true)
        expect(highlighted(first).has('def')).toBe(true)
        expect(highlighted(second).has('let')).toBe(true)
      },
      { timeout: 15_000 },
    )
    expect(listLoads.count).toBe(1)
  })
})
