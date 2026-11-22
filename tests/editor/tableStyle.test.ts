// @vitest-environment jsdom
/**
 * How a table looks (P9.1-T29): a taller header, rounded outer corners, every second body row in a
 * stripe colour that the setting `editor.stripedTables` turns on and off. jsdom draws nothing, so the
 * rules CodeMirror injects are read as text (`valuesOf`) and the setting is read from the custom
 * property it sets; the look in the real window is the owner's claim (ISC-677).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { FONT_VARIABLES, resetDocumentFonts } from '@/editor/documentFonts'
import { blocksOf } from '@/editor/livePreview/blocks'
import { HEADER_EXTRA, ROW_HEIGHT } from '@/editor/livePreview/blocks/widgets'
import { applySettingsText, resetSettingsState } from '@/features/settings/store'
import { DEFAULT_SETTINGS, resetSettings, settings } from '@/lib/settings'
import { SETTING_DEFS } from '@/lib/settingsFile'
import { SETTING_ROWS } from '@/features/settings/rows'
import { valuesOf } from '../helpers/editorRules'
import { blockStateOf, mountPreview } from '../helpers/blocks'

const views: EditorView[] = []
beforeEach(() => {
  resetSettings()
  resetSettingsState()
  resetDocumentFonts()
})
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
  resetSettings()
  resetSettingsState()
  resetDocumentFonts()
})

const TABLE = ['| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |', '| 5 | 6 |'].join('\n')
/** A view over `doc` with the caret at its end, away from the table, so the table is drawn. */
function mount(doc: string): EditorView {
  const text = `${doc}\n\nafter\n`
  const view = mountPreview(text, text.length - 1)
  views.push(view)
  return view
}
/** The leading vertical padding of a `padding` value such as `0.55em 0.8em`, in em. */
const verticalEm = (padding: string | undefined): number =>
  Number.parseFloat((padding ?? '').split(/\s+/)[0] ?? 'NaN')

describe('the setting editor.stripedTables (ISC-672)', () => {
  it('is on by default, checked as a boolean, and a switch in the Editor category', () => {
    expect(DEFAULT_SETTINGS.editor.stripedTables).toBe(true)
    expect(settings.editor.stripedTables).toBe(true)
    const def = SETTING_DEFS['editor.stripedTables']
    expect(def.path).toEqual(['editor', 'stripedTables'])
    expect(def.check(false)).toEqual({ ok: true, value: false })
    expect(def.check('yes').ok).toBe(false)
    const row = SETTING_ROWS.find((candidate) => candidate.key === 'editor.stripedTables')
    expect(row?.category).toBe('editor')
    expect(row?.control.kind).toBe('switch')
  })

  it('reaches the page as --doc-table-stripe, the theme token when on and transparent when off, live', () => {
    const root = document.documentElement
    const view = mount(TABLE)
    applySettingsText('{}')
    expect(root.style.getPropertyValue(FONT_VARIABLES.tableStripe)).toBe('var(--table-stripe)')
    applySettingsText('{"editor": {"stripedTables": false}}')
    expect(settings.editor.stripedTables).toBe(false)
    expect(root.style.getPropertyValue(FONT_VARIABLES.tableStripe)).toBe('transparent')
    applySettingsText('{"editor": {"stripedTables": true}}')
    expect(root.style.getPropertyValue(FONT_VARIABLES.tableStripe)).toBe('var(--table-stripe)')
    expect(view.dom.isConnected).toBe(true)
  })
})

describe('the stripe rule (ISC-676)', () => {
  it('colours every second body row cell with the variable, and nothing else', () => {
    mount(TABLE)
    expect(valuesOf('.cm-md-table tbody tr:nth-child(even) td', 'background-color')).toEqual([
      'var(--doc-table-stripe, transparent)',
    ])
    // The header keeps the muted fill of its own.
    expect(valuesOf('.cm-md-table th', 'background-color')).toEqual(['var(--muted)'])
  })

  it('draws three body rows, so the second one is the striped one', () => {
    const view = mount(TABLE)
    const rows = view.contentDOM.querySelectorAll('.cm-md-table tbody tr')
    expect(rows).toHaveLength(3)
  })
})

describe('the header cell (ISC-674)', () => {
  it('has more vertical padding than a body cell', () => {
    mount(TABLE)
    // The shared cell rule comes first and the header rule after it, so the last one wins.
    const head = valuesOf('.cm-md-table th', 'padding').at(-1)
    const [body] = valuesOf('.cm-md-table td', 'padding')
    expect(verticalEm(body)).toBeGreaterThan(0)
    expect(verticalEm(head)).toBeGreaterThan(verticalEm(body))
  })

  it('is counted in the height a table is estimated at', () => {
    const doc = `${TABLE}
`
    const estimate = blocksOf(blockStateOf(doc, doc.length))[0]?.estimatedHeight
    expect(HEADER_EXTRA).toBeGreaterThan(0)
    // The header and three body rows, the taller header, and the padding round the table.
    expect(estimate).toBe(4 * ROW_HEIGHT + HEADER_EXTRA + 16)
  })
})

describe('the rounded corners (ISC-675)', () => {
  const RADIUS = 'var(--radius)'
  const corners: [string, string][] = [
    ['.cm-md-table thead tr:first-child th:first-child', 'border-top-left-radius'],
    ['.cm-md-table thead tr:first-child th:last-child', 'border-top-right-radius'],
    ['.cm-md-table tbody tr:last-child td:first-child', 'border-bottom-left-radius'],
    ['.cm-md-table tbody tr:last-child td:last-child', 'border-bottom-right-radius'],
  ]

  it('round the four outer corners with the radius token', () => {
    mount(TABLE)
    for (const [selector, property] of corners) {
      expect(valuesOf(selector, property), selector).toEqual([RADIUS])
    }
  })

  it('keep a one pixel border on every cell edge, so the grid is whole', () => {
    mount(TABLE)
    expect(valuesOf('.cm-md-table', 'border-collapse')).toEqual(['separate'])
    expect(valuesOf('.cm-md-table', 'border-spacing')).toEqual(['0'])
    expect(valuesOf('.cm-md-table th', 'border-bottom')).toEqual(['1px solid var(--border)'])
    expect(valuesOf('.cm-md-table td', 'border-bottom')).toEqual(['1px solid var(--border)'])
    expect(valuesOf('.cm-md-table th', 'border-right')).toEqual(['1px solid var(--border)'])
    expect(valuesOf('.cm-md-table thead th', 'border-top')).toEqual(['1px solid var(--border)'])
    expect(valuesOf('.cm-md-table tr > :first-child', 'border-left')).toEqual([
      '1px solid var(--border)',
    ])
  })

  it('apply to a table in a list item, which has the same table element and classes', () => {
    const view = mount(`- item\n\n  ${TABLE.split('\n').join('\n  ')}`)
    const shell = view.contentDOM.querySelector('.cm-md-table-indented')
    expect(shell).not.toBeNull()
    expect(shell?.querySelector('.cm-md-table-wrap > table.cm-md-table')).not.toBeNull()
  })
})
