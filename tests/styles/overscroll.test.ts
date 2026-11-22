// @vitest-environment jsdom
/**
 * Touchpad overscroll must not shift the whole window inside its frame (P9.1-T31, ISC-691):
 * - `html, body` lock the viewport (`overflow: hidden; overscroll-behavior: none;`).
 * - `.cm-scroller` stops scroll chaining and rubber-banding at the editor boundary.
 * - `.cm-md-table-wrap` contains horizontal overscroll only, so vertical scrolling over a table
 *   still chains to the editor.
 * - Top-level scrollable chrome panels carry `overscroll-none` (or `overscroll-x-none` on the
 *   horizontal tab strip).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { mountPreview } from '../helpers/blocks'
import { valuesOf } from '../helpers/editorRules'

const root = resolve(import.meta.dirname, '../..')
const read = (relative: string): string => readFileSync(resolve(root, relative), 'utf8')

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

describe('root viewport and scroller overscroll containment (ISC-691)', () => {
  it('locks html and body in tokens.css with overflow: hidden and overscroll-behavior: none', () => {
    const css = read('src/styles/tokens.css')
    const rule = /html,\s*body\s*\{([^}]*)\}/.exec(css)
    expect(rule).not.toBeNull()
    expect(rule?.[1]).toMatch(/\boverflow:\s*hidden\s*;/)
    expect(rule?.[1]).toMatch(/\boverscroll-behavior:\s*none\s*;/)
  })

  it('sets overscroll-behavior: none on the editor scroller', () => {
    const view = mountPreview('# Heading\n\nBody text\n', 0)
    views.push(view)
    expect(valuesOf('.cm-scroller', 'overscroll-behavior')).toEqual(['none'])
  })

  it('contains horizontal overscroll on tables without blocking vertical scroll chaining', () => {
    const table = '| a | b |\n|---|---|\n| 1 | 2 |\n\nafter\n'
    const view = mountPreview(table, table.length - 1)
    views.push(view)
    expect(valuesOf('.cm-md-table-wrap', 'overscroll-behavior-x')).toEqual(['contain'])
    expect(valuesOf('.cm-md-table-wrap', 'overscroll-behavior-y')).toEqual([])
    expect(valuesOf('.cm-md-table-wrap', 'overscroll-behavior')).toEqual([])
  })

  it('keeps overscroll containment on every top-level scrollable chrome panel', () => {
    const expected: readonly [string, RegExp][] = [
      ['src/workbench/TabStrip.vue', /\boverflow-x-auto\b[^"]*\boverscroll-x-none\b/],
      ['src/features/tree/FileTree.vue', /\boverflow-y-auto\b[^"]*\boverscroll-none\b/],
      ['src/features/outline/OutlinePanel.vue', /\boverflow-y-auto\b[^"]*\boverscroll-none\b/],
      ['src/features/search/SearchPanel.vue', /\boverflow-y-auto\b[^"]*\boverscroll-none\b/],
      [
        'src/features/references/ReferencesPanel.vue',
        /\boverflow-y-auto\b[^"]*\boverscroll-none\b/,
      ],
      ['src/features/palette/PaletteHost.vue', /\boverflow-y-auto\b[^"]*\boverscroll-none\b/],
      [
        'src/features/themes/preview/ThemePreview.vue',
        /\boverflow-y-auto\b[^"]*\boverscroll-none\b/,
      ],
      ['src/features/settings/FontPicker.vue', /\boverflow-y-auto\b[^"]*\boverscroll-none\b/],
    ]
    for (const [file, pattern] of expected) {
      expect(read(file), file).toMatch(pattern)
    }

    const settingsView = read('src/features/settings/SettingsView.vue')
    const settingsMatches = settingsView.match(/\boverflow-y-auto\b[^"]*\boverscroll-none\b/g) ?? []
    expect(settingsMatches.length).toBeGreaterThanOrEqual(2)
  })
})
