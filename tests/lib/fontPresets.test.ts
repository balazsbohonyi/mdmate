/**
 * Bundled Google Font presets (P9.1-T38, ISC-715): the three presets, their display names and
 * bundled stacks, bundled family alias expansion, optical inline-code scale, and the OFL-1.1
 * license file.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyDensity,
  BUNDLED_FONT_NAMES,
  compactLineHeight,
  compactSize,
  DEFAULT_FONT_DENSITY,
  DEFAULT_FONT_PRESET,
  expandBundledFamily,
  FONT_DENSITIES,
  FONT_PRESET_IDS,
  FONT_PRESETS,
  inlineCodeScaleFor,
  resolveFontMetrics,
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

describe('ISC-722: per-preset default typography metrics', () => {
  it('assigns tuned default text/code sizes, line heights and heading scales to all four presets', () => {
    const scale = [1.7, 1.45, 1.25, 1.1, 1, 0.95]

    expect(FONT_PRESETS.system).toMatchObject({
      builtIn: true,
      size: 16,
      lineHeight: 1.5,
      codeSize: 14,
      codeLineHeight: 1.5,
      headingScale: scale,
    })
    expect(FONT_PRESETS.editorial).toMatchObject({
      builtIn: true,
      size: 18,
      lineHeight: 1.6,
      codeSize: 14,
      codeLineHeight: 1.5,
      headingScale: scale,
    })
    expect(FONT_PRESETS.modern).toMatchObject({
      builtIn: true,
      size: 17,
      lineHeight: 1.6,
      codeSize: 14,
      codeLineHeight: 1.5,
      headingScale: scale,
    })
    expect(FONT_PRESETS.journal).toMatchObject({
      builtIn: true,
      size: 18,
      lineHeight: 1.6,
      codeSize: 14,
      codeLineHeight: 1.5,
      headingScale: scale,
    })
  })
})

describe('ISC-724: Comfort vs Compact density scaling', () => {
  it('defines comfort (default) and compact densities', () => {
    expect(DEFAULT_FONT_DENSITY).toBe('comfort')
    expect(FONT_DENSITIES).toEqual(['comfort', 'compact'])
  })

  it('scales sizes by x0.86 rounded to whole px with a 10px floor', () => {
    expect(compactSize(14)).toBe(12)
    expect(compactSize(16)).toBe(14)
    expect(compactSize(17)).toBe(15)
    expect(compactSize(18)).toBe(15)
    expect(compactSize(20)).toBe(17)
    expect(compactSize(21)).toBe(18)
    expect(compactSize(11)).toBe(10)
    expect(compactSize(8)).toBe(10)
  })

  it('reduces line heights by 0.1 in 0.05 steps with a 1.15 floor', () => {
    expect(compactLineHeight(1.6)).toBe(1.5)
    expect(compactLineHeight(1.5)).toBe(1.4)
    expect(compactLineHeight(1.4)).toBe(1.3)
    expect(compactLineHeight(1.2)).toBe(1.15)
    expect(compactLineHeight(1.0)).toBe(1.15)
  })

  it('leaves metrics unchanged in comfort and scales text & code in compact without touching headingScale', () => {
    const base = {
      size: 18,
      lineHeight: 1.6,
      codeSize: 14,
      codeLineHeight: 1.5,
      headingScale: [1.7, 1.45, 1.25, 1.1, 1, 0.95],
    }
    expect(applyDensity(base, 'comfort')).toEqual(base)
    expect(applyDensity(base, 'compact')).toEqual({
      size: 15,
      lineHeight: 1.5,
      codeSize: 12,
      codeLineHeight: 1.4,
      headingScale: [1.7, 1.45, 1.25, 1.1, 1, 0.95],
    })
  })

  it('resolves null overrides from the active preset and applies density on top of overrides', () => {
    const inherited = resolveFontMetrics(
      {
        preset: 'editorial',
        density: 'compact',
        heading: '',
        body: '',
        code: '',
        size: null,
        lineHeight: null,
        codeSize: null,
        codeLineHeight: null,
        headingScale: null,
      },
      FONT_PRESETS.editorial,
    )
    expect(inherited.customized).toBe(false)
    expect(inherited.base.size).toBe(18)
    expect(inherited.base.lineHeight).toBe(1.6)
    expect(inherited.effective.size).toBe(15)
    expect(inherited.effective.lineHeight).toBe(1.5)
    expect(inherited.effective.codeSize).toBe(12)
    expect(inherited.effective.codeLineHeight).toBe(1.4)

    const overridden = resolveFontMetrics(
      {
        preset: 'system',
        density: 'compact',
        heading: '',
        body: '',
        code: '',
        size: 20,
        lineHeight: 1.7,
        codeSize: null,
        codeLineHeight: null,
        headingScale: null,
      },
      FONT_PRESETS.system,
    )
    expect(overridden.customized).toBe(true)
    expect(overridden.base.size).toBe(20)
    expect(overridden.effective.size).toBe(17)
    expect(overridden.effective.lineHeight).toBe(1.6)
  })
})
