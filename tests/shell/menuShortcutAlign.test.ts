/**
 * ISC-237: the key shown at the right of a menu item sits on the same text baseline as the item's
 * label. The label is 14 px and the key 12 px, both centred in the row, so the smaller text's
 * baseline lands about 0.75 px higher; the shortcut components lower it by that much. A browser
 * lays text out and jsdom does not, so this scans the sources; the real window measured the
 * baselines (0.25 px apart after the change, 0.75 px before).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const SURFACES = [
  'components/ui/context-menu/ContextMenuShortcut.vue',
  'components/ui/dropdown-menu/DropdownMenuShortcut.vue',
  'shell/TitleBarMenu.vue',
]

describe('menu key baseline (ISC-237)', () => {
  it.each(SURFACES)('%s lowers the small key text to the label baseline', (file) => {
    expect(readFileSync(join(SRC, file), 'utf8')).toMatch(/relative top-\[0\.75px\]/)
  })

  it('keeps the font sizes: the label stays text-sm and the key text-xs', () => {
    const item = readFileSync(join(SRC, 'components/ui/context-menu/ContextMenuItem.vue'), 'utf8')
    const key = readFileSync(join(SRC, 'components/ui/context-menu/ContextMenuShortcut.vue'), 'utf8')
    expect(item).toMatch(/\btext-sm\b/)
    expect(key).toMatch(/\btext-xs\b/)
  })
})
