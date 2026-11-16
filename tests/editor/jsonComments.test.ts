// @vitest-environment jsdom
/**
 * The comments of a JSON file are colored as comments (ISC-430): the JSON grammar has none, so
 * `// "theme": "dark",` would otherwise show its string and its value in the colors of live code.
 */
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { jsonCommentRanges } from '@/editor/jsonComments'
import { refreshSourceLanguages, sourceLanguage } from '@/editor/sourceLanguage'
import { resetSettings } from '@/lib/settings'

const slices = (text: string): string[] =>
  jsonCommentRanges(text).map(([from, to]) => text.slice(from, to))

afterEach(() => {
  resetSettings()
  document.body.replaceChildren()
})

describe('jsonCommentRanges', () => {
  it('finds a line comment to the end of its line, whole or after a value', () => {
    expect(slices('{\n  // "a": 1,\n  "b": 2, // why\n}')).toEqual(['// "a": 1,', '// why'])
  })

  it('finds a block comment on one line and across lines, and one that never closes', () => {
    expect(slices('{ /* a */ "x": 1 }')).toEqual(['/* a */'])
    expect(slices('{\n/* one\n   two */ "x": 1 }')).toEqual(['/* one\n   two */'])
    expect(slices('{ "x": 1 } /* open')).toEqual(['/* open'])
  })

  it('leaves slashes inside a string alone, escaped quotes included', () => {
    expect(slices('{"url": "http://x.y/*not*/", "q": "a\\"//b"}')).toEqual([])
    expect(slices('{"url": "http://x.y", // real\n"b": 1}')).toEqual(['// real'])
  })

  it('finds nothing in a file with no comment', () => {
    expect(jsonCommentRanges('{"a": [1, 2, {"b": null}]}')).toEqual([])
  })
})

describe('a json file shows its comments in the comment color', () => {
  function shown(name: string, text: string): EditorView {
    const parent = document.createElement('div')
    document.body.append(parent)
    return new EditorView({
      parent,
      state: EditorState.create({ doc: text, extensions: [sourceLanguage(name)] }),
    })
  }
  const marked = (view: EditorView): string[] =>
    [...view.dom.querySelectorAll('.cm-jsonc-comment')].map((one) => one.textContent)

  it('marks each comment of settings.json, and not the live entries or their strings', async () => {
    const view = shown('settings.json', '{\n  // "theme": "dark",\n  "size": 15, // note\n}\n')
    await expect
      .poll(() => marked(view), { timeout: 5000 })
      .toEqual(['// "theme": "dark",', '// note'])
    view.destroy()
  })

  it('marks nothing in a file that is not json, and follows a rename', async () => {
    let name = 'notes.txt'
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: '{ // c\n}', extensions: [sourceLanguage(() => name)] }),
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(marked(view)).toEqual([])
    name = 'notes.json'
    refreshSourceLanguages()
    await expect.poll(() => marked(view), { timeout: 5000 }).toEqual(['// c'])
    name = 'notes.rs'
    refreshSourceLanguages()
    await expect.poll(() => marked(view), { timeout: 5000 }).toEqual([])
    view.destroy()
  })

  it('moves the marks with an edit', async () => {
    const view = shown('keybindings.json', '{\n  "a": 1\n}\n')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect.poll(() => view.dom.querySelector('.cm-line') !== null).toBe(true)
    view.dispatch({ changes: { from: 4, insert: '// hi\n  ' } })
    await expect.poll(() => marked(view), { timeout: 5000 }).toEqual(['// hi'])
    view.destroy()
  })
})
