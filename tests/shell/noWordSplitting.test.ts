/**
 * ISC-235: a tooltip or dialog never splits a word across lines when the word fits on a line of its
 * own. `break-all` and `word-break: break-all` cut anywhere ("loa" / "d"); `break-words` moves the
 * whole word down and only cuts a word that is longer than the line (a long path). A browser lays
 * text out, jsdom does not, so this scans the sources that style tooltips and dialogs.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const SURFACES = [
  'components/HoverHint.vue',
  'components/ui/tooltip/TooltipContent.vue',
  'features/tree/DeleteDialog.vue',
  'styles/tokens.css',
]

describe('words in hints and dialogs (ISC-235)', () => {
  it.each(SURFACES)('%s never breaks a word anywhere', (file) => {
    const text = readFileSync(join(SRC, file), 'utf8')
    expect(text).not.toMatch(/\bbreak-all\b/)
    expect(text).not.toMatch(/word-break\s*:\s*break-all/)
  })

  it('the hint box and the editor hint wrap by word, cutting only a word too long for the line', () => {
    expect(readFileSync(join(SRC, 'components/HoverHint.vue'), 'utf8')).toMatch(/\bbreak-words\b/)
    expect(readFileSync(join(SRC, 'styles/tokens.css'), 'utf8')).toMatch(
      /\.editor-hint\s*\{[^}]*overflow-wrap:\s*break-word/s,
    )
  })
})
