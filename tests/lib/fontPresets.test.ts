/**
 * Bundled Google Font presets (P9.1-T38, ISC-715): the three presets, their display names and
 * bundled stacks, bundled family alias expansion, optical inline-code scale, and the OFL-1.1
 * license file.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BUNDLED_FONT_NAMES,
  DEFAULT_FONT_PRESET,
  expandBundledFamily,
  FONT_PRESET_IDS,
  FONT_PRESETS,
  inlineCodeScaleFor,
} from '@/lib/fontPresets'

describe('ISC-715: four font presets (System default + three bundled Google Font pairings)', () => {
  it('defines System (default), Editorial, Modern and Journal with the agreed pairings', () => {
    expect(DEFAULT_FONT_PRESET).toBe('system')
    expect(FONT_PRESET_IDS).toEqual(['system', 'editorial', 'modern', 'journal'])

    expect(FONT_PRESETS.system.label).toBe('System')
    expect(FONT_PRESETS.system.heading.stack).toBe('monospace')
    expect(FONT_PRESETS.system.body.stack).toBe('monospace')
    expect(FONT_PRESETS.system.code.stack).toBe('var(--font-mono)')
    expect(FONT_PRESETS.system.inlineCodeScale).toBe(0.82)

    expect(FONT_PRESETS.editorial.label).toBe('Editorial')
    expect(FONT_PRESETS.editorial.heading.name).toBe('Montserrat')
    expect(FONT_PRESETS.editorial.body.name).toBe('Lora')
    expect(FONT_PRESETS.editorial.code.name).toBe('JetBrains Mono')
    expect(FONT_PRESETS.editorial.inlineCodeScale).toBe(0.9)

    expect(FONT_PRESETS.modern.label).toBe('Modern')
    expect(FONT_PRESETS.modern.heading.name).toBe('Raleway')
    expect(FONT_PRESETS.modern.body.name).toBe('Open Sans')
    expect(FONT_PRESETS.modern.code.name).toBe('Fira Code')
    expect(FONT_PRESETS.modern.inlineCodeScale).toBe(0.9)

    expect(FONT_PRESETS.journal.label).toBe('Journal')
    expect(FONT_PRESETS.journal.heading.name).toBe('Oswald')
    expect(FONT_PRESETS.journal.body.name).toBe('Merriweather')
    expect(FONT_PRESETS.journal.code.name).toBe('IBM Plex Mono')
    expect(FONT_PRESETS.journal.inlineCodeScale).toBe(0.9)
  })

  it('lists all bundled font display names A to Z', () => {
    expect(BUNDLED_FONT_NAMES).toEqual([
      'Fira Code',
      'IBM Plex Mono',
      'Inter',
      'JetBrains Mono',
      'Lora',
      'Merriweather',
      'Montserrat',
      'Open Sans',
      'Oswald',
      'Raleway',
    ])
  })

  it('expands bundled variable display names so choosing a display name loads the bundled face', () => {
    expect(expandBundledFamily('Montserrat')).toEqual(['Montserrat Variable', 'Montserrat'])
    expect(expandBundledFamily('Lora')).toEqual(['Lora Variable', 'Lora'])
    expect(expandBundledFamily('jetbrains mono')).toEqual([
      'JetBrains Mono Variable',
      'JetBrains Mono',
    ])
    expect(expandBundledFamily('Inter')).toEqual(['Inter Variable', 'Inter'])
    // Static bundled fonts keep their exact family name.
    expect(expandBundledFamily('IBM Plex Mono')).toEqual(['IBM Plex Mono'])
    // System fonts are left untouched.
    expect(expandBundledFamily('Georgia')).toEqual(['Georgia'])
  })

  it('computes the optical inline-code scale from preset or body override', () => {
    expect(inlineCodeScaleFor('system', '')).toBe(0.82)
    expect(inlineCodeScaleFor('editorial', '')).toBe(0.9)
    expect(inlineCodeScaleFor('modern', '')).toBe(0.9)
    expect(inlineCodeScaleFor('journal', '')).toBe(0.9)
    expect(inlineCodeScaleFor('editorial', 'monospace')).toBe(0.82)
    expect(inlineCodeScaleFor('modern', 'Lora')).toBe(0.9)
    expect(inlineCodeScaleFor('editorial', 'Open Sans, sans-serif')).toBe(0.9)
    expect(inlineCodeScaleFor('editorial', 'Georgia')).toBe(0.9)
  })

  it('ships local @fontsource imports and OFL-1.1 license notices for Inter and all 9 document fonts', () => {
    const fontsCss = readFileSync('src/styles/fonts.css', 'utf8')
    const tokensCss = readFileSync('src/styles/tokens.css', 'utf8')
    expect(tokensCss).toContain("@import './fonts.css';")
    for (const pkg of [
      '@fontsource-variable/montserrat',
      '@fontsource-variable/lora',
      '@fontsource-variable/raleway',
      '@fontsource-variable/open-sans',
      '@fontsource-variable/oswald',
      '@fontsource-variable/merriweather',
      '@fontsource-variable/jetbrains-mono',
      '@fontsource-variable/fira-code',
      '@fontsource/ibm-plex-mono',
    ]) {
      expect(fontsCss, pkg).toContain(pkg)
    }

    expect(existsSync('public/fonts-LICENSE.txt')).toBe(true)
    const license = readFileSync('public/fonts-LICENSE.txt', 'utf8')
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
    for (const name of BUNDLED_FONT_NAMES) {
      expect(license, name).toContain(name)
    }
  })
})
