// @vitest-environment jsdom
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { languageChoices } from '@/editor/codeLanguages'
import {
  extensionOf,
  hasSourceLanguage,
  refreshSourceLanguages,
  sourceLanguage,
} from '@/editor/sourceLanguage'
import { DEFAULT_HIGHLIGHT_EXTENSIONS, resetSettings, settings } from '@/lib/settings'
import { checkExtension, SETTING_DEFS } from '@/lib/settingsFile'

function shown(name: string, text: string): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  return new EditorView({
    parent,
    state: EditorState.create({ doc: text, extensions: [sourceLanguage(name)] }),
  })
}

afterEach(() => {
  resetSettings()
})

describe('colors for a plain-source file, by its extension', () => {
  it('reads the extension of a name', () => {
    expect(extensionOf('settings.json')).toBe('json')
    expect(extensionOf('A.JSON')).toBe('json')
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('Makefile')).toBe('')
  })

  it('follows the setting: json is in the default list, a text file is not', () => {
    expect(hasSourceLanguage('settings.json')).toBe(true)
    expect(hasSourceLanguage('App.TSX')).toBe(true)
    expect(hasSourceLanguage('notes.txt')).toBe(false)
    settings.editor.highlightExtensions = ['txt']
    expect(hasSourceLanguage('notes.txt')).toBe(true)
    expect(hasSourceLanguage('settings.json')).toBe(false)
  })

  it('loads the JSON parser for settings.json and parses the text with it', async () => {
    const view = shown('settings.json', '{ "theme": "light", "size": 15, "on": true }')
    await expect.poll(() => syntaxTree(view.state).length, { timeout: 5000 }).toBeGreaterThan(0)
    const names: string[] = []
    syntaxTree(view.state).iterate({ enter: (node) => void names.push(node.name) })
    expect(names).toEqual(expect.arrayContaining(['Object', 'Property', 'String', 'Number']))
    view.destroy()
  })

  it('follows a rename: colors come with a new extension, go with a plain one, and change language', async () => {
    let name = 'notes.txt'
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '{ "theme": "light" }',
        extensions: [sourceLanguage(() => name)],
      }),
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(syntaxTree(view.state).length).toBe(0)

    name = 'notes.json'
    refreshSourceLanguages()
    await expect.poll(() => syntaxTree(view.state).length, { timeout: 5000 }).toBeGreaterThan(0)
    const asJson = syntaxTree(view.state).topNode.name

    name = 'notes.rs'
    refreshSourceLanguages()
    await expect.poll(() => syntaxTree(view.state).topNode.name, { timeout: 5000 }).not.toBe(asJson)

    name = 'notes.txt'
    refreshSourceLanguages()
    await expect.poll(() => syntaxTree(view.state).length, { timeout: 5000 }).toBe(0)
    view.destroy()
  })

  it('leaves a file with no language as plain text', async () => {
    const view = shown('notes.txt', '{ "theme": "light" }')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(syntaxTree(view.state).length).toBe(0)
    view.destroy()
  })

  it('takes the colors away and gives them back when the setting changes, with the view open', async () => {
    const view = shown('main.rs', 'fn main() { let x = 1; }')
    await expect.poll(() => syntaxTree(view.state).length, { timeout: 5000 }).toBeGreaterThan(0)
    settings.editor.highlightExtensions = settings.editor.highlightExtensions.filter(
      (extension) => extension !== 'rs',
    )
    refreshSourceLanguages()
    await expect.poll(() => syntaxTree(view.state).length, { timeout: 5000 }).toBe(0)
    settings.editor.highlightExtensions = [...DEFAULT_HIGHLIGHT_EXTENSIONS]
    refreshSourceLanguages()
    await expect.poll(() => syntaxTree(view.state).length, { timeout: 5000 }).toBeGreaterThan(0)
    view.destroy()
  })
})

describe('the default list and the picker', () => {
  it('has a CodeMirror language for every default extension, and the picker offers them', async () => {
    const choices = await languageChoices()
    const known = new Set(
      choices.flatMap((choice) => choice.extensions.map((e) => e.toLowerCase())),
    )
    expect(DEFAULT_HIGHLIGHT_EXTENSIONS.filter((extension) => !known.has(extension))).toEqual([])
    expect(choices.some((choice) => choice.name === 'Markdown')).toBe(false)
    expect(choices.map((choice) => choice.name)).toContain('Rust')
  })

  it('checks an extension: lower case, no dot, letters and digits', () => {
    expect(checkExtension('.RS')).toEqual({ ok: true, value: 'rs' })
    expect(checkExtension(' ts ')).toEqual({ ok: true, value: 'ts' })
    expect(checkExtension('c++')).toEqual({ ok: true, value: 'c++' })
    expect(checkExtension('').ok).toBe(false)
    expect(checkExtension('a/b').ok).toBe(false)
    expect(checkExtension(7).ok).toBe(false)
  })

  it('checks the list: repeats collapse, one bad item refuses it all', () => {
    const check = SETTING_DEFS['editor.highlightExtensions'].check
    expect(check(['ts', '.TS', 'rs'])).toEqual({ ok: true, value: ['ts', 'rs'] })
    expect(check(['ts', 'a b']).ok).toBe(false)
    expect(check('ts').ok).toBe(false)
  })
})
