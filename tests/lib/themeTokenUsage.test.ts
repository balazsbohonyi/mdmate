import { describe, expect, it } from 'vitest'
import { THEME_TOKEN_NAMES, THEME_TOKENS } from '@/lib/themeTokens'
import { THEME_TOKEN_USAGE, usageOf } from '@/lib/themeTokenUsage'

describe('where each theme token is used (ISC-540)', () => {
  it('has a sentence for every token', () => {
    const missing = THEME_TOKENS.filter(
      (token) => (THEME_TOKEN_USAGE[token.name] ?? '') === '',
    ).map((token) => token.name)
    expect(missing).toEqual([])
  })

  it('says what the two line-number tokens colour (ISC-630)', () => {
    expect(usageOf('gutter')).toContain('line numbers')
    expect(usageOf('gutter-foreground')).toContain('line numbers')
  })

  it('has no sentence for a token that does not exist', () => {
    const stray = Object.keys(THEME_TOKEN_USAGE).filter((name) => !THEME_TOKEN_NAMES.has(name))
    expect(stray).toEqual([])
  })

  it('keeps each sentence short enough for a hover hint, ending as a sentence', () => {
    const bad = Object.entries(THEME_TOKEN_USAGE)
      .filter(([, text]) => text.length < 10 || text.length > 260 || !/[.]$/.test(text))
      .map(([name]) => name)
    expect(bad).toEqual([])
  })

  it('names a token only by a name it has when it writes one as --name', () => {
    const wrong: string[] = []
    for (const [name, text] of Object.entries(THEME_TOKEN_USAGE))
      for (const found of text.matchAll(/--([a-z-]+)/g))
        if (!THEME_TOKEN_NAMES.has(found[1] ?? '')) wrong.push(`${name}: ${found[0]}`)
    expect(wrong).toEqual([])
  })

  it('gives an empty text for a name it does not know, so the hint stays off', () => {
    expect(usageOf('not-a-token')).toBe('')
    expect(usageOf('destructive-foreground')).toContain('close-window')
  })
})
