import type { EditorState, TransactionSpec } from '@codemirror/state'
import {
  BOLD,
  INLINE_CODE,
  insertLink,
  ITALIC,
  shiftHeading,
  STRIKETHROUGH,
  toggleInline,
} from '@/editor/format'
import { clearRecent } from '@/documents/recent'
import {
  canRevertActive,
  canSaveActive,
  canSaveActiveAs,
  closeAllTabs,
  followerOfTab,
  activePaneHasTabs,
  openFromDialog,
  requestCloseTab,
  requestRevert,
  saveActiveDocument,
  saveActiveDocumentAs,
} from '@/documents/store'
import { newUntitledTab } from '@/documents/untitled'
import { canGoBack, canGoForward, goBack, goForward } from '@/documents/history'
import { togglePalette } from '@/features/palette/state'
import { showOutline } from '@/features/outline/store'
import { showSearch } from '@/features/search/store'
import { focusTree, openFolderDialog } from '@/features/tree/store'
import { getHost } from '@/platform'
import { registerCommand, removeCommand } from './commands'
import { canFind, openFind, stepFind } from './find'
import { findPane } from './splitTree'
import { splitActivePane, workbenchLayout } from './store'
import { toggleRaw } from './rawMode'
import { showSidebar, toggleSidebar } from './sidebar'
import { activeTabId, findTabReferences, renameTab, tabMenuState, tabPath } from './tabMenu'

export const COMMAND_IDS = {
  newFile: 'file.new',
  open: 'file.open',
  openFolder: 'file.openFolder',
  quickOpen: 'file.quickOpen',
  commandPalette: 'view.commandPalette',
  save: 'file.save',
  saveAs: 'file.saveAs',
  revert: 'file.revert',
  rename: 'file.rename',
  findReferences: 'file.findReferences',
  clearRecent: 'file.clearRecent',
  find: 'edit.find',
  replace: 'edit.replace',
  findNext: 'edit.findNext',
  findPrevious: 'edit.findPrevious',
  findInFolders: 'edit.findInFolders',
  showOutline: 'view.showOutline',
  splitRight: 'workbench.splitRight',
  splitDown: 'workbench.splitDown',
  closeTab: 'workbench.closeTab',
  closeAll: 'workbench.closeAll',
  toggleSidebar: 'view.toggleSidebar',
  focusSidebar: 'view.focusSidebar',
  toggleRawSource: 'view.toggleRawSource',
  back: 'navigate.back',
  forward: 'navigate.forward',
  bold: 'format.bold',
  italic: 'format.italic',
  link: 'format.link',
  inlineCode: 'format.inlineCode',
  strikethrough: 'format.strikethrough',
  headingUp: 'format.headingUp',
  headingDown: 'format.headingDown',
  exit: 'app.exit',
} as const

/** The active tab of the active pane, or null when there is none. */
function activeTab(): string | null {
  const layout = workbenchLayout.value
  return findPane(layout, layout.activePane)?.activeTab ?? null
}

/** A format command: computes the change on the active tab's state and makes it there. */
function formatActive(make: (state: EditorState) => TransactionSpec | null): () => void {
  return () => {
    const tab = activeTab()
    const follower = tab === null ? undefined : followerOfTab(tab)
    if (follower === undefined) return
    const spec = make(follower.state)
    if (spec !== null) follower.dispatch(spec)
  }
}

const hasTab = (): boolean => activeTab() !== null

/** The format commands, with the shortcuts the owner chose (Phase 5 decisions). */
const FORMATS = [
  {
    id: COMMAND_IDS.bold,
    title: 'Bold',
    keybinding: 'Mod+B',
    make: (s: EditorState) => toggleInline(s, BOLD),
  },
  {
    id: COMMAND_IDS.italic,
    title: 'Italic',
    keybinding: 'Mod+I',
    make: (s: EditorState) => toggleInline(s, ITALIC),
  },
  { id: COMMAND_IDS.link, title: 'Insert Link', keybinding: 'Mod+K', make: insertLink },
  {
    id: COMMAND_IDS.inlineCode,
    title: 'Inline Code',
    keybinding: 'Mod+`',
    make: (s: EditorState) => toggleInline(s, INLINE_CODE),
  },
  {
    id: COMMAND_IDS.strikethrough,
    title: 'Strikethrough',
    keybinding: 'Alt+Shift+5',
    make: (s: EditorState) => toggleInline(s, STRIKETHROUGH),
  },
  {
    id: COMMAND_IDS.headingUp,
    title: 'Raise Heading',
    keybinding: 'Mod+Shift+ArrowUp',
    make: (s: EditorState) => shiftHeading(s, 'raise'),
  },
  {
    id: COMMAND_IDS.headingDown,
    title: 'Lower Heading',
    keybinding: 'Mod+Shift+ArrowDown',
    make: (s: EditorState) => shiftHeading(s, 'lower'),
  },
] as const

/**
 * Registers the built-in commands with their default shortcuts and returns a function that removes
 * them. Anything already registered under these ids is replaced, because hot reload in development
 * mounts the new shell before the old one has removed its commands.
 *
 * The shortcuts avoid Ctrl+Alt, which many Windows layouts send for AltGr. Ctrl+B, Ctrl+I, Ctrl+K
 * and Ctrl+` are the format commands (P5-T4); the owner chose them, and the keys the editor also
 * uses are taken out of its keymap (`APP_KEYS`).
 */
export function registerDefaultCommands(): () => void {
  for (const id of Object.values(COMMAND_IDS)) removeCommand(id)
  const disposers = [
    registerCommand({
      id: COMMAND_IDS.newFile,
      title: 'New File',
      keybinding: 'Mod+N',
      run: newUntitledTab,
    }),
    registerCommand({
      id: COMMAND_IDS.open,
      title: 'Open...',
      keybinding: 'Mod+O',
      run: openFromDialog,
    }),
    registerCommand({
      id: COMMAND_IDS.openFolder,
      title: 'Open Folder...',
      keybinding: 'Mod+Shift+O',
      run: openFolderDialog,
    }),
    registerCommand({
      id: COMMAND_IDS.quickOpen,
      title: 'Go to File...',
      keybinding: 'Mod+P',
      run: () => {
        togglePalette('files')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.commandPalette,
      title: 'Show Command Palette...',
      keybinding: 'Mod+Shift+P',
      run: () => {
        togglePalette('commands')
      },
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
      id: COMMAND_IDS.saveAs,
      title: 'Save As...',
      keybinding: 'Mod+Shift+S',
      enabled: canSaveActiveAs,
      run: saveActiveDocumentAs,
    }),
    registerCommand({
      id: COMMAND_IDS.revert,
      title: 'Revert File',
      enabled: canRevertActive,
      run: requestRevert,
    }),
    registerCommand({
      id: COMMAND_IDS.rename,
      title: 'Rename...',
      keybinding: 'F2',
      // A new file has no name to change, so naming it is Save As. A file on disk is renamed in its
      // tree row, with the links that point at it, so it has to be in an open folder.
      enabled: () => {
        const tab = activeTabId()
        return tab !== null && tabMenuState(tab).canRename
      },
      run: () => {
        const tab = activeTabId()
        return tab === null ? undefined : renameTab(tab)
      },
    }),
    registerCommand({
      id: COMMAND_IDS.findReferences,
      title: 'Find File References',
      keybinding: 'Shift+F12',
      enabled: () => {
        const tab = activeTabId()
        return tab !== null && tabPath(tab) !== null
      },
      run: () => {
        const tab = activeTabId()
        return tab === null ? undefined : findTabReferences(tab)
      },
    }),
    registerCommand({
      id: COMMAND_IDS.find,
      title: 'Find...',
      keybinding: 'Mod+F',
      // The key is taken from the page even with nothing to search, so the browser's own find never opens.
      enabled: canFind,
      run: () => {
        openFind(false)
      },
    }),
    registerCommand({
      id: COMMAND_IDS.replace,
      title: 'Replace...',
      keybinding: 'Mod+H',
      enabled: canFind,
      run: () => {
        openFind(true)
      },
    }),
    registerCommand({
      id: COMMAND_IDS.findNext,
      title: 'Find Next',
      keybinding: 'F3',
      enabled: canFind,
      run: () => {
        stepFind('next')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.findPrevious,
      title: 'Find Previous',
      keybinding: 'Shift+F3',
      enabled: canFind,
      run: () => {
        stepFind('previous')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.clearRecent,
      title: 'Clear Recent',
      run: clearRecent,
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
      id: COMMAND_IDS.closeAll,
      title: 'Close All',
      keybinding: 'Mod+Shift+W',
      enabled: activePaneHasTabs,
      run: async () => {
        await closeAllTabs()
      },
    }),
    registerCommand({
      id: COMMAND_IDS.findInFolders,
      title: 'Search in Folders...',
      keybinding: 'Mod+Shift+F',
      // The query box takes focus; the selected line of the editor, if any, is the query.
      run: showSearch,
    }),
    registerCommand({
      id: COMMAND_IDS.showOutline,
      title: 'Show Outline',
      keybinding: 'Mod+Shift+L',
      // The list takes focus, so the arrow keys move through the headings at once.
      run: showOutline,
    }),
    registerCommand({
      id: COMMAND_IDS.toggleSidebar,
      title: 'Toggle Sidebar',
      keybinding: 'Mod+Shift+B',
      run: toggleSidebar,
    }),
    registerCommand({
      id: COMMAND_IDS.focusSidebar,
      title: 'Focus Sidebar',
      keybinding: 'Mod+Shift+E',
      // The tree is in the Folders panel; show that panel, and the sidebar if it was hidden.
      run: () => {
        showSidebar('folders')
        focusTree()
      },
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
    ...FORMATS.map((format) =>
      registerCommand({
        id: format.id,
        title: format.title,
        keybinding: format.keybinding,
        enabled: hasTab,
        run: formatActive(format.make),
      }),
    ),
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
