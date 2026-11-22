// @vitest-environment jsdom
/**
 * The width of the text column of an editor tab (ISC-439 to ISC-443). jsdom draws nothing, so what
 * is checked here is the chain on each side of the drawing: the settings to the property on the
 * page's root, and the property to the theme rule by name. The drawn widths are read from the real
 * window (ISA Verification).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Text } from '@codemirror/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFollowerState, createView } from '@/editor/create'
import { resetDocumentFonts } from '@/editor/documentFonts'
import {
  contentWidthValue,
  fullWidthFor,
  FULL_WIDTH_CLASS,
  keepsFullWidth,
  refreshFullWidth,
  resetContentWidth,
  WIDTH_VARIABLE,
} from '@/editor/documentWidth'
import { applySettingsText, resetSettingsState } from '@/features/settings/store'
import { DEFAULT_SETTINGS, resetSettings } from '@/lib/settings'

const rootValue = (): string => document.documentElement.style.getPropertyValue(WIDTH_VARIABLE)

function load(editor: Record<string, unknown>): void {
  applySettingsText(JSON.stringify({ editor }))
}

const parents: HTMLElement[] = []

function viewFor(name: () => string): ReturnType<typeof createView> {
  const parent = document.createElement('div')
  document.body.append(parent)
  parents.push(parent)
  return createView(
    parent,
    createFollowerState({ doc: Text.of(['a line of text']), extensions: fullWidthFor(name) }),
  )
}

beforeEach(() => {
  resetSettings()
  resetSettingsState()
  resetContentWidth()
  resetDocumentFonts()
})

afterEach(() => {
  for (const parent of parents.splice(0)) parent.remove()
  resetSettings()
  resetSettingsState()
  resetContentWidth()
  resetDocumentFonts()
})

describe('ISC-439: the column stops at the width, not counting the padding', () => {
  it('puts the default 1024px plus the padding on both sides on the root', () => {
    applySettingsText('{}')
    expect(rootValue()).toBe('1024px')
  })

  it('follows the width that was set', () => {
    load({ contentMaxWidth: 700 })
    expect(rootValue()).toBe('700px')
    load({ contentMaxWidth: 1200 })
    expect(rootValue()).toBe('1200px')
  })

  it('keeps the last good width when the value is out of range', () => {
    load({ contentMaxWidth: 700 })
    load({ contentMaxWidth: 5 })
    expect(rootValue()).toBe('700px')
  })

  it('has a theme rule that reads the property, centers the column and has no other width', () => {
    const create = readFileSync(join(import.meta.dirname, '../../src/editor/create.ts'), 'utf8')
    expect(create).toContain('maxWidth: `var(${WIDTH_VARIABLE},')
    expect(create).toContain("marginInline: 'auto'")
    // The app's own JSON files keep the whole width.
    expect(create).toContain('&.${FULL_WIDTH_CLASS} .cm-content')
    // Without wrapping there is no column to keep, so the rule steps aside.
    expect(create).toContain("'.cm-content:not(.cm-lineWrapping)': { maxWidth: 'none'")
  })
})

describe('ISC-440: with the limit off the column uses the whole width', () => {
  it('puts none on the root, and the width again when the limit comes back', () => {
    load({ limitContentWidth: false })
    expect(rootValue()).toBe('none')
    load({ limitContentWidth: true })
    expect(rootValue()).toBe('1024px')
  })

  it('ignores the width while the limit is off', () => {
    load({ limitContentWidth: false, contentMaxWidth: 500 })
    expect(rootValue()).toBe('none')
  })
})

describe('ISC-441: a change reaches the open tabs at once', () => {
  it('asks each open view to measure again, once per change, and not when nothing changed', () => {
    // The first settings read also sets the fonts, which measures once; start from the default.
    applySettingsText('{}')
    const view = viewFor(() => 'notes.md')
    const measure = vi.spyOn(view, 'requestMeasure')
    load({ limitContentWidth: false })
    const afterChange = measure.mock.calls.length
    expect(afterChange).toBeGreaterThan(0)
    // The same text read again changes nothing, so no view is asked again.
    load({ limitContentWidth: false })
    expect(measure.mock.calls.length).toBe(afterChange)
    // CodeMirror measures on its own updates too, so only a growth after a real change counts.
    load({ contentMaxWidth: 800 })
    expect(measure.mock.calls.length).toBeGreaterThan(afterChange)
  })

  it('follows a hand edit of the file the same way', () => {
    applySettingsText('{"editor": {"contentMaxWidth": 640}}')
    expect(rootValue()).toBe('640px')
    applySettingsText('{}')
    expect(rootValue()).toBe('1024px')
  })
})

describe('ISC-442: the two JSON files keep the whole width', () => {
  it('knows the names, in any case, and nothing else', () => {
    expect(keepsFullWidth('settings.json')).toBe(true)
    expect(keepsFullWidth('keybindings.json')).toBe(true)
    expect(keepsFullWidth('Settings.JSON')).toBe(true)
    expect(keepsFullWidth('notes.md')).toBe(false)
    expect(keepsFullWidth('my-settings.json')).toBe(false)
    expect(keepsFullWidth('package.json')).toBe(false)
  })

  it('puts the class on the view of one of them and not on an ordinary file', () => {
    const settings = viewFor(() => 'settings.json')
    const keys = viewFor(() => 'keybindings.json')
    const notes = viewFor(() => 'notes.md')
    expect(settings.dom.classList.contains(FULL_WIDTH_CLASS)).toBe(true)
    expect(keys.dom.classList.contains(FULL_WIDTH_CLASS)).toBe(true)
    expect(notes.dom.classList.contains(FULL_WIDTH_CLASS)).toBe(false)
  })

  it('moves a tab in or out when it is renamed', () => {
    let name = 'notes.md'
    const view = viewFor(() => name)
    expect(view.dom.classList.contains(FULL_WIDTH_CLASS)).toBe(false)
    name = 'settings.json'
    refreshFullWidth()
    expect(view.dom.classList.contains(FULL_WIDTH_CLASS)).toBe(true)
    name = 'notes.md'
    refreshFullWidth()
    expect(view.dom.classList.contains(FULL_WIDTH_CLASS)).toBe(false)
  })

  it('is read by the editor alone, so the Settings screen and the chrome keep their layout', () => {
    const readers: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (readFileSync(path, 'utf8').includes(WIDTH_VARIABLE)) readers.push(path)
      }
    }
    walk(join(import.meta.dirname, '../../src'))
    expect(readers.map((path) => path.replaceAll('\\', '/').split('/src/')[1]).sort()).toEqual([
      'editor/documentWidth.ts',
    ])
  })
})

describe('ISC-443: the fallback is the default', () => {
  it('has the default width in the theme, for a file that is not read yet or cannot be', () => {
    expect(contentWidthValue(DEFAULT_SETTINGS.editor)).toBe('1024px')
    expect(DEFAULT_SETTINGS.editor.limitContentWidth).toBe(true)
    expect(DEFAULT_SETTINGS.editor.contentMaxWidth).toBe(1024)
  })

  it('is what the view has before any setting is applied', () => {
    // No applySettingsText here: nothing is on the root, so the theme's own fallback is in force.
    expect(rootValue()).toBe('')
    const view = viewFor(() => 'notes.md')
    expect(view.dom.classList.contains(FULL_WIDTH_CLASS)).toBe(false)
  })
})
