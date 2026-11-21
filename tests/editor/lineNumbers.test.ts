// @vitest-environment jsdom
/**
 * The line-number gutter (P9.1-T16, ISC-612 to ISC-615). jsdom draws no layout, so the gutter's
 * numbers are read from its elements (one per line CodeMirror draws), and where it sits is read from
 * the theme rules by name. The drawn look is the owner's check in the real window (ISC-616).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFollowerState, createState, createView } from '@/editor/create'
import { Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { refreshLineNumbers } from '@/editor/lineNumbers'
import { applySettingsText, resetSettingsState } from '@/features/settings/store'
import { DEFAULT_SETTINGS, resetSettings, settings } from '@/lib/settings'

const parents: HTMLElement[] = []
const views: EditorView[] = []

function mount(state: ReturnType<typeof createState>): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  parents.push(parent)
  const view = createView(parent, state)
  views.push(view)
  return view
}

/** A Markdown tab with live preview, as the app opens one. */
const markdown = (doc: string): EditorView => mount(createState(doc, [], { preview: true }))
/** A plain text tab: no parser, no preview. */
const plain = (doc: string): EditorView => mount(createState(doc, [], { parser: false }))
/** A tab as a follower shows it (a JSON file is one). */
const follower = (doc: string, parser = false): EditorView => {
  const parent = document.createElement('div')
  document.body.append(parent)
  parents.push(parent)
  const view = createView(parent, createFollowerState({ doc: Text.of(doc.split('\n')), parser }))
  views.push(view)
  return view
}

function load(editor: Record<string, unknown>): void {
  applySettingsText(JSON.stringify({ editor }))
}

/** The numbers the gutter shows, top to bottom, with an empty string for a row with none. */
function shown(view: EditorView): string[] {
  const gutter = view.dom.querySelector('.cm-lineNumbers')
  if (gutter === null) return []
  return [...gutter.querySelectorAll<HTMLElement>('.cm-gutterElement')]
    .filter((element) => element.style.visibility !== 'hidden')
    .map((element) => element.textContent.trim())
    .filter((text) => text !== '')
}

const gutterOn = (view: EditorView): boolean => view.dom.classList.contains('cm-lineNumbersOn')

beforeEach(() => {
  resetSettings()
  resetSettingsState()
})

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  for (const parent of parents.splice(0)) parent.remove()
  resetSettings()
  resetSettingsState()
})

describe('the setting (ISC-612)', () => {
  it('is off by default', () => {
    expect(DEFAULT_SETTINGS.editor.lineNumbers).toBe(false)
    expect(settings.editor.lineNumbers).toBe(false)
    const view = plain('one\ntwo\nthree')
    expect(gutterOn(view)).toBe(false)
    expect(shown(view)).toEqual([])
  })

  it('shows the gutter in a view that was already open when the file turns it on, and hides it again', () => {
    const view = plain('one\ntwo\nthree')
    load({ lineNumbers: true })
    expect(gutterOn(view)).toBe(true)
    expect(shown(view)).toEqual(['1', '2', '3'])
    load({ lineNumbers: false })
    expect(gutterOn(view)).toBe(false)
    expect(shown(view)).toEqual([])
  })

  it('goes back to off when the key leaves the file', () => {
    const view = plain('one\ntwo')
    load({ lineNumbers: true })
    expect(shown(view)).toEqual(['1', '2'])
    applySettingsText('{}')
    expect(gutterOn(view)).toBe(false)
  })

  it('keeps the last good value for a value that is not true or false', () => {
    const view = plain('one\ntwo')
    load({ lineNumbers: true })
    load({ lineNumbers: 'yes' })
    expect(settings.editor.lineNumbers).toBe(true)
    expect(shown(view)).toEqual(['1', '2'])
  })

  it('a refresh with the setting unchanged leaves the numbers as they are', () => {
    const view = plain('one\ntwo')
    load({ lineNumbers: true })
    refreshLineNumbers()
    expect(shown(view)).toEqual(['1', '2'])
  })
})

describe('every kind of text tab (ISC-613)', () => {
  it('numbers a Markdown tab, a plain text tab and a follower tab', () => {
    load({ lineNumbers: true })
    expect(shown(markdown('# Title\n\ntext'))).toEqual(['1', '2', '3'])
    expect(shown(plain('{\n  "a": 1\n}'))).toEqual(['1', '2', '3'])
    expect(shown(follower('a\nb'))).toEqual(['1', '2'])
    expect(shown(follower('# a\n\nb', true))).toEqual(['1', '2', '3'])
  })

  it('numbers the lines of a document that opens with the setting already on', () => {
    load({ lineNumbers: true })
    const view = markdown('a\nb\nc\nd')
    expect(gutterOn(view)).toBe(true)
    expect(shown(view)).toEqual(['1', '2', '3', '4'])
  })

  it('sits against the column: the theme steps the column to the gutter and centers the pair', () => {
    const create = readFileSync(join(import.meta.dirname, '../../src/editor/create.ts'), 'utf8')
    // With the gutter on, the column no longer centers itself; the gutter takes the free space on
    // its left and the column the free space on its right, so the two sit together in the middle.
    expect(create).toContain("'&.cm-lineNumbersOn .cm-content.cm-lineWrapping'")
    expect(create).toContain("'&.cm-lineNumbersOn .cm-gutters'")
    const rule = /'&\.cm-lineNumbersOn \.cm-content\.cm-lineWrapping': \{([^}]*)\}/.exec(
      create,
    )?.[1]
    expect(rule).toContain("marginInlineStart: '0'")
    const gutters = /'&\.cm-lineNumbersOn \.cm-gutters': \{([^}]*)\}/.exec(create)?.[1]
    expect(gutters).toContain("marginInlineStart: 'auto'")
  })

  it('draws no gutter box while the setting is off', () => {
    const create = readFileSync(join(import.meta.dirname, '../../src/editor/create.ts'), 'utf8')
    expect(create).toContain("'&:not(.cm-lineNumbersOn) .cm-gutters': { display: 'none' }")
  })
})

describe('the frontmatter (ISC-614)', () => {
  const FRONT = '---\ntitle: a\ntags: b\ndate: c\n---\nbody one\nbody two\n'

  it('counts its lines: the first body line after a 5-line frontmatter is 6, and the pill has no number', () => {
    load({ lineNumbers: true })
    const view = markdown(FRONT)
    // Caret at the end of the document, away from the frontmatter, so the pill is drawn.
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    const rows = shown(view)
    expect(rows).toContain('6')
    expect(rows).toContain('7')
    for (const hidden of ['1', '2', '3', '4', '5']) expect(rows).not.toContain(hidden)
  })

  it('numbers its lines 1 to 5 again with the caret inside it', () => {
    load({ lineNumbers: true })
    const view = markdown(FRONT)
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } })
    expect(shown(view)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })
})

describe('wrapped lines, blocks and the active line (ISC-615)', () => {
  it('shows a long line once, whatever its length', () => {
    load({ lineNumbers: true })
    const view = markdown(`${'word '.repeat(400)}\nshort`)
    expect(shown(view)).toEqual(['1', '2'])
  })

  it('numbers a table by its first source line and skips the lines it hides', () => {
    load({ lineNumbers: true })
    const view = markdown('intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter')
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    const rows = shown(view)
    expect(rows).toContain('3')
    for (const hidden of ['4', '5']) expect(rows).not.toContain(hidden)
    expect(rows).toContain('7')
    expect(rows.filter((row) => row === '3')).toHaveLength(1)
  })

  it('numbers the lines of the table again when the caret is in it', () => {
    load({ lineNumbers: true })
    const view = markdown('intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter')
    view.dispatch({ selection: { anchor: view.state.doc.line(4).from } })
    expect(shown(view)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
  })

  it('numbers an image block by its first source line', () => {
    load({ lineNumbers: true })
    const view = markdown('before\n\n![alt](pic.png)\n\nafter')
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    const rows = shown(view)
    expect(rows).toContain('3')
    expect(rows).toContain('5')
  })

  it('marks the number of the line with the caret, and moves the mark with it', () => {
    load({ lineNumbers: true })
    const view = plain('one\ntwo\nthree')
    const active = (): string[] =>
      [...view.dom.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-activeLineGutter')].map(
        (element) => element.textContent.trim(),
      )
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } })
    expect(active()).toEqual(['2'])
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from } })
    expect(active()).toEqual(['3'])
  })
})
