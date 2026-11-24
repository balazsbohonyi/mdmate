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
import { FONT_PRESETS } from '@/lib/fontPresets'
import { DEFAULT_SETTINGS, resetSettings, settings } from '@/lib/settings'
import { valuesOf } from '../helpers/editorRules'

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

  it('sits against the column: the gutter takes the free space on its left, the column its room as a margin', () => {
    const create = readFileSync(join(import.meta.dirname, '../../src/editor/create.ts'), 'utf8')
    // With the gutter on, the gutter stays at the pane's edge and takes the free space on its left
    // (`auto`), and the column keeps its room from the gutter as a margin, so the pair sits together
    // in the middle. The room is outside the content box (P9.1-T22), which is why it is a margin.
    expect(create).toContain("'&.cm-lineNumbersOn .cm-content'")
    expect(create).toContain("'&.cm-lineNumbersOn .cm-scroller'")
    expect(create).toContain("'&.cm-lineNumbersOn .cm-gutters'")
    const content = /'&\.cm-lineNumbersOn \.cm-content': \{([^}]*)\}/.exec(create)?.[1]
    expect(content).toContain('marginInlineStart: CONTENT_PADDING_X')
    const scroller = /'&\.cm-lineNumbersOn \.cm-scroller': \{([^}]*)\}/.exec(create)?.[1]
    expect(scroller).toContain("paddingInlineStart: '0'")
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

describe('the number of a heading line is centered on the heading (ISC-687)', () => {
  const DOC = [
    '# One', // 1
    '',
    'text', // 3
    '',
    '## Two', // 5
    '',
    '### Three', // 7
    '',
    '#### Four', // 9
    '',
    '##### Five', // 11
    '',
    '###### Six', // 13
    '',
    'Setext', // 15
    '======',
    '',
    '> # Quoted', // 18
    '',
    'end', // 20
  ].join('\n')

  /** The classes of the gutter element of each numbered line, by its number. */
  function classesByNumber(view: EditorView): Map<string, string[]> {
    const found = new Map<string, string[]>()
    for (const element of view.dom.querySelectorAll<HTMLElement>(
      '.cm-lineNumbers .cm-gutterElement',
    )) {
      const text = element.textContent.trim()
      if (text !== '') found.set(text, [...element.classList])
    }
    return found
  }

  it('marks the gutter element of each heading line with its level, and no other line', () => {
    load({ lineNumbers: true })
    const view = markdown(DOC)
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    const marks = classesByNumber(view)
    const levelOf = (number: string): string | undefined =>
      marks.get(number)?.find((name) => /^cm-gutter-h\d$/.test(name))
    expect(levelOf('1')).toBe('cm-gutter-h1')
    expect(levelOf('5')).toBe('cm-gutter-h2')
    expect(levelOf('7')).toBe('cm-gutter-h3')
    expect(levelOf('9')).toBe('cm-gutter-h4')
    expect(levelOf('11')).toBe('cm-gutter-h5')
    expect(levelOf('13')).toBe('cm-gutter-h6')
    // The text line of a Setext heading, not its underline; a heading in a quote.
    expect(levelOf('15')).toBe('cm-gutter-h1')
    expect(levelOf('16')).toBeUndefined()
    expect(levelOf('18')).toBe('cm-gutter-h1')
    for (const number of ['2', '3', '4', '20']) expect(levelOf(number), number).toBeUndefined()
  })

  it('marks a heading line while the caret is on it, when its hashes show', () => {
    load({ lineNumbers: true })
    const view = markdown(DOC)
    view.dispatch({ selection: { anchor: 3 } })
    expect(classesByNumber(view).get('1')).toContain('cm-gutter-h1')
  })

  it('follows an edit: a line turned into a heading is marked, one turned back is not', () => {
    load({ lineNumbers: true })
    const view = markdown('plain\n\nend')
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    expect(classesByNumber(view).get('1')).not.toContain('cm-gutter-h2')
    view.dispatch({ changes: { from: 0, insert: '## ' } })
    expect(classesByNumber(view).get('1')).toContain('cm-gutter-h2')
    view.dispatch({ changes: { from: 0, to: 3 } })
    expect(classesByNumber(view).get('1')).not.toContain('cm-gutter-h2')
  })

  it('moves the number down by the heading line top padding and half of what its taller line adds', () => {
    markdown('# One\n\nend')
    const element = '.cm-lineNumbersOn .cm-lineNumbers .cm-gutterElement'
    // Heading line: top padding P*S*text + half of ((S-1) * line height * text), so the middle of the
    // number meets the middle of the heading's first row. (H1: P = 0.3em, S = the level 1 scale.)
    expect(valuesOf(`${element}.cm-gutter-h1`, 'padding-top')).toEqual([
      'calc(0.3 * var(--doc-heading-1, 1.7) * var(--doc-size, 15px) + (var(--doc-heading-1, 1.7) - 1) * var(--doc-line-height, 1.4) * var(--doc-size, 15px) / 2)',
    ])
    expect(valuesOf(`${element}.cm-gutter-h4`, 'padding-top')).toEqual([
      'calc(0 * var(--doc-heading-4, 1.1) * var(--doc-size, 15px) + (var(--doc-heading-4, 1.1) - 1) * var(--doc-line-height, 1.4) * var(--doc-size, 15px) / 2)',
    ])
  })

  it('uses the same top padding for a heading line that the editor gives the line itself', () => {
    markdown('# One\n\nend')
    const paddings = ['0.3em', '0.25em', '0.2em']
    paddings.forEach((padding, index) => {
      expect(
        valuesOf(`.cm-md-h${String(index + 1)}`, 'padding-top'),
        `h${String(index + 1)}`,
      ).toEqual([padding])
      expect(
        valuesOf(
          `.cm-lineNumbersOn .cm-lineNumbers .cm-gutterElement.cm-gutter-h${String(index + 1)}`,
          'padding-top',
        )[0],
      ).toContain(`calc(${padding.replace('em', '')} *`)
    })
  })
})

describe('the look of the gutter (ISC-632, ISC-669)', () => {
  const GUTTERS = '.cm-lineNumbersOn .cm-gutters'

  it('paints the strip with its own background token, not the page color', () => {
    markdown('a\nb')
    expect(valuesOf(GUTTERS, 'background-color')).toEqual(['var(--gutter)'])
  })

  it('colors the numbers with their own token, which is not the body text or the muted text', () => {
    markdown('a\nb')
    expect(valuesOf(GUTTERS, 'color')).toEqual(['var(--gutter-foreground)'])
  })

  it('draws the numbers in the code font family', () => {
    markdown('a\nb')
    expect(valuesOf(GUTTERS, 'font-family')[0]).toMatch(/^var\(--doc-font-code,/)
  })

  it('draws the numbers at 0.9 times the code size, which is the code ratio times the text size', () => {
    markdown('a\nb')
    expect(valuesOf(GUTTERS, 'font-size')).toEqual([
      'calc(var(--doc-code-ratio, calc(14 / 16)) * var(--doc-size, 16px) * 0.9)',
    ])
  })

  it('has the fallback of the size equal to 0.9 of the default code size', () => {
    // 14 / 16 of a 16 px text is the 14 px default code size; 0.9 of it is 12.6 px.
    expect(FONT_PRESETS.system.codeSize / FONT_PRESETS.system.size).toBeCloseTo(14 / 16, 10)
    expect(FONT_PRESETS.system.codeSize * 0.9).toBeCloseTo(12.6, 10)
  })

  it('gives the digits the same room on both sides, 10 px each (ISC-669)', () => {
    markdown('a\nb')
    const element = '.cm-lineNumbersOn .cm-lineNumbers .cm-gutterElement'
    expect(valuesOf(element, 'padding-left')).toEqual(['10px'])
    expect(valuesOf(element, 'padding-right')).toEqual(['10px'])
  })

  it('keeps the number of the line with the caret in the foreground color on no extra strip', () => {
    markdown('a\nb')
    expect(valuesOf('.cm-lineNumbersOn .cm-activeLineGutter', 'color')).toEqual([
      'var(--foreground)',
    ])
    expect(valuesOf('.cm-lineNumbersOn .cm-activeLineGutter', 'background-color')).toEqual([
      'transparent',
    ])
  })
})
