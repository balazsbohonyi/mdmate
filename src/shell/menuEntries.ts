import { clearRecent, openRecentFile, openRecentFolder, recentLists } from '@/documents/recent'
import { getCommand, isCommandEnabled, shortcutLabel } from '@/workbench/commands'
import { COMMAND_IDS } from '@/workbench/defaultCommands'
import { detectPlatform, type Platform } from '@/workbench/keybinding'

/**
 * One selectable line of the app menu. An item's `id` is a command id: the menu runs it with
 * `runCommand`. An item with a `run` of its own (a recent file) runs that instead.
 */
export interface MenuItem {
  readonly kind: 'item'
  readonly id: string
  readonly label: string
  readonly shortcut?: string
  /** Smaller text after the label, such as the folder of a recent file. */
  readonly detail?: string
  readonly disabled?: boolean
  readonly run?: () => Promise<void>
}

/** A line inside a submenu that names the group below it. */
export interface HeadingEntry {
  readonly kind: 'heading'
  readonly label: string
}

/** A line of a submenu. */
export type SubmenuEntry = MenuItem | { readonly kind: 'separator' } | HeadingEntry

/** One line of the app menu. */
export type MenuEntry =
  | MenuItem
  | { readonly kind: 'separator' }
  | { readonly kind: 'submenu'; readonly label: string; readonly items: readonly SubmenuEntry[] }

/** Stands for the Open Recent submenu in `MENU_LAYOUT`. */
const RECENT = '@recent'

/** The order of the menu: command ids, with `'-'` for a separator. */
const MENU_LAYOUT: readonly string[] = [
  COMMAND_IDS.newFile,
  COMMAND_IDS.open,
  COMMAND_IDS.openFolder,
  RECENT,
  '-',
  COMMAND_IDS.save,
  COMMAND_IDS.saveAs,
  COMMAND_IDS.revert,
  '-',
  COMMAND_IDS.splitRight,
  COMMAND_IDS.splitDown,
  COMMAND_IDS.closeTab,
  COMMAND_IDS.closeAll,
  '-',
  COMMAND_IDS.find,
  COMMAND_IDS.replace,
  COMMAND_IDS.findNext,
  COMMAND_IDS.findPrevious,
  COMMAND_IDS.findInFolders,
  '-',
  COMMAND_IDS.toggleSidebar,
  COMMAND_IDS.toggleRawSource,
  '-',
  COMMAND_IDS.exit,
]

/** The last part of a path, and the folder before it. */
function splitPath(path: string): { name: string; folder: string } {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1
    ? { name: path, folder: '' }
    : { name: path.slice(cut + 1), folder: path.slice(0, cut) }
}

/** The Open Recent submenu: files, folders, then Clear Recent. */
function recentMenu(): MenuEntry {
  const { files, folders } = recentLists.value
  const items: SubmenuEntry[] = []
  if (files.length === 0 && folders.length === 0) {
    items.push({ kind: 'item', id: 'recent.none', label: 'No recent files', disabled: true })
  }
  if (files.length > 0) items.push({ kind: 'heading', label: 'Files' })
  for (const path of files) {
    const { name, folder } = splitPath(path)
    items.push({
      kind: 'item',
      id: `recent.file:${path}`,
      label: name,
      detail: folder,
      run: () => openRecentFile(path),
    })
  }
  if (files.length > 0 && folders.length > 0) items.push({ kind: 'separator' })
  if (folders.length > 0) items.push({ kind: 'heading', label: 'Folders' })
  for (const path of folders) {
    const { name, folder } = splitPath(path)
    items.push({
      kind: 'item',
      id: `recent.folder:${path}`,
      label: name,
      detail: folder,
      run: () => openRecentFolder(path),
    })
  }
  items.push({ kind: 'separator' })
  items.push({
    kind: 'item',
    id: 'recent.clear',
    label: 'Clear Recent',
    disabled: files.length === 0 && folders.length === 0,
    run: clearRecent,
  })
  return { kind: 'submenu', label: 'Open Recent', items }
}

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
    if (id === RECENT) {
      entries.push(recentMenu())
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

/** The item with this id, wherever it sits in the menu. */
export function findMenuItem(entries: readonly MenuEntry[], id: string): MenuItem | undefined {
  for (const entry of entries) {
    if (entry.kind === 'item' && entry.id === id) return entry
    if (entry.kind === 'submenu') {
      const inside = entry.items.find(
        (item): item is MenuItem => item.kind === 'item' && item.id === id,
      )
      if (inside !== undefined) return inside
    }
  }
  return undefined
}
