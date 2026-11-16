import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const read = (relative: string): string => readFileSync(resolve(root, relative), 'utf8')

/**
 * The settings switch (ISC-390). The generated shadcn Switch styles its track and thumb with the
 * variants `data-checked:` and `data-unchecked:`, which a Base UI switch sets as attributes. Reka
 * UI sets `data-state`, so without the two variants the stylesheet defines the switch has no track
 * and no thumb: it was drawn as nothing in the first real run of the Settings screen.
 */
describe('the switch has a track and a thumb (ISC-390)', () => {
  const css = read('src/styles/tokens.css')
  const switchSource = read('src/components/ui/switch/Switch.vue')

  it('defines each state variant the generated Switch styles itself with', () => {
    const used = new Set(
      [...switchSource.matchAll(/(?<![\w-])data-(checked|unchecked):/g)].map((match) => match[1]),
    )
    // The generated file must still use them, or this test and the stylesheet note are stale.
    expect([...used].sort()).toEqual(['checked', 'unchecked'])
    for (const state of used) {
      expect(css).toMatch(
        new RegExp(
          `@custom-variant data-${String(state)} \\(&:is\\(\\[data-state='${String(state)}'\\]\\)\\);`,
        ),
      )
    }
  })
})
