import { getCommand, isCommandEnabled, shortcutLabel } from '@/workbench/commands'
import { COMMAND_IDS } from '@/workbench/defaultCommands'
import { detectPlatform, type Platform } from '@/workbench/keybinding'

/** One line of the app menu. An item's `id` is a command id: the menu runs it with `runCommand`. */
export type MenuEntry =
  | {
      readonly kind: 'item'
      readonly id: string
      readonly label: string
      readonly shortcut?: string
      readonly disabled?: boolean
    }
  | { readonly kind: 'separator' }

/** The order of the menu: command ids, with `'-'` for a separator. */
const MENU_LAYOUT: readonly string[] = [
  COMMAND_IDS.open,
  COMMAND_IDS.openFolder,
  COMMAND_IDS.save,
  '-',
  COMMAND_IDS.splitRight,
  COMMAND_IDS.splitDown,
  COMMAND_IDS.closeTab,
  '-',
  COMMAND_IDS.toggleSidebar,
  COMMAND_IDS.toggleRawSource,
  '-',
  COMMAND_IDS.exit,
]

/**
 * The menu as it is right now: labels and shortcuts come from the command registry, and an item is
 * disabled while its command is. Reads reactive state, so call it inside a computed.
 */
export function buildMenuEntries(platform: Platform = detectPlatform()): readonly MenuEntry[] {
  const entries: MenuEntry[] = []
  for (const id of MENU_LAYOUT) {
    if (id === '-') {
      entries.push({ kind: 'separator' })
      continue
    }
    const command = getCommand(id)
    if (command === undefined) continue
    const shortcut = shortcutLabel(id, platform)
    entries.push({
      kind: 'item',
      id,
      label: command.title,
      ...(shortcut === undefined ? {} : { shortcut }),
      disabled: !isCommandEnabled(id),
    })
  }
  return entries
}
