import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

/**
 * Behaviour of `openInActivePane` is tested in tests/documents/open.test.ts. This pins who calls
 * it: the three ways the user picks a file by hand, so that each can give a pane its own tab of a
 * file another pane already shows (ISC-246). A link, a history step, a reference and a recent file
 * must keep calling `openPath` with no pane.
 */
describe('who opens a file in the active pane (ISC-246)', () => {
  it('a tree click and Quick Open use it', () => {
    expect(read('src/features/tree/store.ts')).toMatch(/await openInActivePane\(row\.path\)/)
    expect(read('src/features/tree/store.ts')).not.toMatch(/\bopenPath\(/)
    expect(read('src/features/palette/PaletteHost.vue')).toMatch(
      /await openInActivePane\(row\.key\)/,
    )
    expect(read('src/features/palette/PaletteHost.vue')).not.toMatch(/\bopenPath\(/)
  })

  it('the open dialog uses it', () => {
    expect(read('src/documents/store.ts')).toMatch(/await openInActivePane\(path\)/)
  })

  it('links, history, references and recent files still jump to the existing tab', () => {
    for (const file of [
      'src/documents/links.ts',
      'src/documents/history.ts',
      'src/documents/recent.ts',
      'src/features/references/store.ts',
    ]) {
      const source = read(file)
      expect(source, file).toMatch(/\bopenPath\(/)
      expect(source, file).not.toMatch(/openInActivePane/)
    }
  })
})
