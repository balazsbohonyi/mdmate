import { getHost } from '@/platform'
import { registerCommand, removeCommand } from './commands'
import { findPane } from './splitTree'
import { closeTabById, splitActivePane, workbenchLayout } from './store'
import { toggleSidebar } from './sidebar'

export const COMMAND_IDS = {
  splitRight: 'workbench.splitRight',
  splitDown: 'workbench.splitDown',
  closeTab: 'workbench.closeTab',
  toggleSidebar: 'view.toggleSidebar',
  exit: 'app.exit',
} as const

/** The active tab of the active pane, or null when there is none. */
function activeTab(): string | null {
  const layout = workbenchLayout.value
  return findPane(layout, layout.activePane)?.activeTab ?? null
}

/**
 * Registers the built-in commands with their default shortcuts and returns a function that removes
 * them. Anything already registered under these ids is replaced, because hot reload in development
 * mounts the new shell before the old one has removed its commands.
 *
 * The shortcuts avoid Ctrl+Alt, which many Windows layouts send for AltGr, and Ctrl+B, the usual
 * shortcut for bold (ISC-83, built in Phase 5).
 */
export function registerDefaultCommands(): () => void {
  for (const id of Object.values(COMMAND_IDS)) removeCommand(id)
  const disposers = [
    registerCommand({
      id: COMMAND_IDS.splitRight,
      title: 'Split Right',
      keybinding: 'Alt+Shift+2',
      run: () => {
        splitActivePane('row')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.splitDown,
      title: 'Split Down',
      keybinding: 'Alt+Shift+8',
      run: () => {
        splitActivePane('column')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.closeTab,
      title: 'Close Tab',
      keybinding: 'Mod+W',
      enabled: () => activeTab() !== null,
      run: () => {
        const tab = activeTab()
        if (tab !== null) closeTabById(tab)
      },
    }),
    registerCommand({
      id: COMMAND_IDS.toggleSidebar,
      title: 'Toggle Sidebar',
      keybinding: 'Mod+Shift+B',
      run: toggleSidebar,
    }),
    registerCommand({
      id: COMMAND_IDS.exit,
      title: 'Exit',
      run: async () => {
        await (await getHost()).windowControls.close()
      },
    }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
