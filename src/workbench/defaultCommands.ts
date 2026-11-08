import {
  canSaveActive,
  openFromDialog,
  requestCloseTab,
  saveActiveDocument,
} from '@/documents/store'
import { canGoBack, canGoForward, goBack, goForward } from '@/documents/history'
import { getHost } from '@/platform'
import { registerCommand, removeCommand } from './commands'
import { findPane } from './splitTree'
import { splitActivePane, workbenchLayout } from './store'
import { toggleRaw } from './rawMode'
import { toggleSidebar } from './sidebar'

export const COMMAND_IDS = {
  open: 'file.open',
  save: 'file.save',
  splitRight: 'workbench.splitRight',
  splitDown: 'workbench.splitDown',
  closeTab: 'workbench.closeTab',
  toggleSidebar: 'view.toggleSidebar',
  toggleRawSource: 'view.toggleRawSource',
  back: 'navigate.back',
  forward: 'navigate.forward',
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
      id: COMMAND_IDS.open,
      title: 'Open...',
      keybinding: 'Mod+O',
      run: openFromDialog,
    }),
    registerCommand({
      id: COMMAND_IDS.save,
      title: 'Save',
      keybinding: 'Mod+S',
      // Disabled when there is nothing to write, but the key is still taken from the page.
      enabled: canSaveActive,
      run: saveActiveDocument,
    }),
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
        if (tab !== null) requestCloseTab(tab)
      },
    }),
    registerCommand({
      id: COMMAND_IDS.toggleSidebar,
      title: 'Toggle Sidebar',
      keybinding: 'Mod+Shift+B',
      run: toggleSidebar,
    }),
    registerCommand({
      id: COMMAND_IDS.toggleRawSource,
      title: 'Toggle Raw Source',
      keybinding: 'Mod+E',
      // The mode belongs to the active pane, so it needs a tab to look at.
      enabled: () => activeTab() !== null,
      run: () => {
        toggleRaw(workbenchLayout.value.activePane)
      },
    }),
    registerCommand({
      id: COMMAND_IDS.back,
      title: 'Go Back',
      keybinding: 'Alt+ArrowLeft',
      enabled: canGoBack,
      run: async () => {
        await goBack()
      },
    }),
    registerCommand({
      id: COMMAND_IDS.forward,
      title: 'Go Forward',
      keybinding: 'Alt+ArrowRight',
      enabled: canGoForward,
      run: async () => {
        await goForward()
      },
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
