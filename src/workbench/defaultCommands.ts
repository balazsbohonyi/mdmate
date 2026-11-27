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
  describe,
  followerOfTab,
  activePaneHasTabs,
  openFromDialog,
  openInActivePane,
  requestCloseTab,
  requestRevert,
  saveActiveDocument,
  saveActiveDocumentAs,
} from '@/documents/store'
import { newUntitledTab } from '@/documents/untitled'
import { canGoBack, canGoForward, goBack, goForward } from '@/documents/history'
import { openPicker, togglePalette } from '@/features/palette/state'
import { ensureKeybindingsTemplate } from '@/features/keybindings/store'
import { flipSetting, isToggleOn } from '@/features/settings/quick'
import { ensureSettingsTemplate } from '@/features/settings/store'
import { zoomBy, zoomTo } from '@/features/settings/zoom'
import { showOutline } from '@/features/outline/store'
import { showSearch } from '@/features/search/store'
import { focusTree, openFolderDialog } from '@/features/tree/store'
import { settings } from '@/lib/settings'
import { ZOOM_DEFAULT } from '@/lib/zoom'
import { getHost } from '@/platform'
import { reportError } from '@/shell/toasts'
import { registerCommand, removeCommand } from './commands'
import { canFind, openFind, stepFind } from './find'
import { findPane } from './splitTree'
import { openSettingsTab, splitActivePane, workbenchLayout } from './store'
import { toggleRaw } from './rawMode'
import { showSidebar, toggleSidebar } from './sidebar'
import { canCycleTabs, cycleTabs, stepTabs } from './tabCycle'
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
  cycleTabs: 'workbench.cycleTabs',
  cycleTabsBack: 'workbench.cycleTabsBack',
  nextTab: 'workbench.nextTab',
  previousTab: 'workbench.previousTab',
  toggleSidebar: 'view.toggleSidebar',
  focusSidebar: 'view.focusSidebar',
  toggleRawSource: 'view.toggleRawSource',
  toggleWordWrap: 'view.toggleWordWrap',
  toggleLineNumbers: 'view.toggleLineNumbers',
  toggleStickyHeadings: 'view.toggleStickyHeadings',
  toggleContentWidth: 'view.toggleContentWidth',
  switchTheme: 'view.switchTheme',
  zoomIn: 'view.zoomIn',
  zoomOut: 'view.zoomOut',
  zoomReset: 'view.zoomReset',
  back: 'navigate.back',
  forward: 'navigate.forward',
  goToLine: 'navigate.goToLine',
  bold: 'format.bold',
  italic: 'format.italic',
  link: 'format.link',
  inlineCode: 'format.inlineCode',
  strikethrough: 'format.strikethrough',
  headingUp: 'format.headingUp',
  headingDown: 'format.headingDown',
  openDevtools: 'tools.openDevtools',
  toggleDevtools: 'tools.toggleDevtools',
  openSettings: 'tools.openSettings',
  openSettingsFile: 'tools.openSettingsFile',
  openKeybindingsFile: 'tools.openKeybindingsFile',
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
      group: 'File',
      title: 'New File',
      keybinding: 'Mod+N',
      run: newUntitledTab,
    }),
    registerCommand({
      id: COMMAND_IDS.open,
      group: 'File',
      title: 'Open...',
      keybinding: 'Mod+O',
      run: openFromDialog,
    }),
    registerCommand({
      id: COMMAND_IDS.openFolder,
      group: 'File',
      title: 'Open Folder...',
      keybinding: 'Mod+Shift+O',
      run: openFolderDialog,
    }),
    registerCommand({
      id: COMMAND_IDS.quickOpen,
      group: 'File',
      title: 'Go to File...',
      keybinding: 'Mod+P',
      run: () => {
        togglePalette('files')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.commandPalette,
      group: 'View',
      title: 'Show Command Palette...',
      keybinding: 'Mod+Shift+P',
      run: () => {
        togglePalette('commands')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.save,
      group: 'File',
      title: 'Save',
      keybinding: 'Mod+S',
      // Disabled when there is nothing to write, but the key is still taken from the page.
      enabled: canSaveActive,
      run: saveActiveDocument,
    }),
    registerCommand({
      id: COMMAND_IDS.saveAs,
      group: 'File',
      title: 'Save As...',
      keybinding: 'Mod+Shift+S',
      enabled: canSaveActiveAs,
      run: saveActiveDocumentAs,
    }),
    registerCommand({
      id: COMMAND_IDS.revert,
      group: 'File',
      title: 'Revert File',
      enabled: canRevertActive,
      run: requestRevert,
    }),
    registerCommand({
      id: COMMAND_IDS.rename,
      group: 'File',
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
      id: COMMAND_IDS.openSettings,
      group: 'App',
      title: 'Open Settings',
      keybinding: 'Mod+,',
      // There is one Settings tab; a second run shows that one (ISC-343).
      run: () => {
        openSettingsTab()
      },
    }),
    registerCommand({
      id: COMMAND_IDS.openSettingsFile,
      group: 'App',
      title: 'Open settings.json',
      run: async () => {
        try {
          // Rust makes the file if it is missing and grants that one path; a file that holds
          // nothing becomes the commented template first, so it shows what can be added.
          const path = await (await getHost()).settingsFile()
          await ensureSettingsTemplate()
          await openInActivePane(path)
        } catch (error) {
          reportError(`Could not open settings.json: ${describe(error)}`)
        }
      },
    }),
    registerCommand({
      id: COMMAND_IDS.openKeybindingsFile,
      group: 'App',
      title: 'Open keybindings.json',
      keybinding: 'Mod+Shift+K',
      run: async () => {
        try {
          // Rust makes the file if it is missing and grants that one path; a file that holds
          // nothing becomes the commented template first, so it shows every command.
          const path = await (await getHost()).keybindingsFile()
          await ensureKeybindingsTemplate()
          await openInActivePane(path)
        } catch (error) {
          reportError(`Could not open keybindings.json: ${describe(error)}`)
        }
      },
    }),
    registerCommand({
      id: COMMAND_IDS.openDevtools,
      group: 'App',
      title: 'Open Developer Tools',
      keybinding: 'F12',
      // Off until the `devtools` setting turns it on; Rust refuses the call too while it is off.
      enabled: () => settings.devtools,
      run: async () => {
        await (await getHost()).devtoolsOpen()
      },
    }),
    registerCommand({
      id: COMMAND_IDS.toggleDevtools,
      group: 'App',
      title: 'Toggle Developer Tools',
      // The setting that lets F12 open the tools; the command that opens them is above.
      state: () => isToggleOn('devtools'),
      run: async () => {
        await flipSetting('devtools')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.toggleWordWrap,
      group: 'View',
      title: 'Toggle Word Wrap',
      state: () => isToggleOn('editor.wordWrap'),
      run: async () => {
        await flipSetting('editor.wordWrap')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.toggleLineNumbers,
      group: 'View',
      title: 'Toggle Line Numbers',
      state: () => isToggleOn('editor.lineNumbers'),
      run: async () => {
        await flipSetting('editor.lineNumbers')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.toggleStickyHeadings,
      group: 'View',
      title: 'Toggle Sticky Headings',
      state: () => isToggleOn('editor.stickyHeadings'),
      run: async () => {
        await flipSetting('editor.stickyHeadings')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.toggleContentWidth,
      group: 'View',
      title: 'Toggle Limit Content Width',
      keybinding: 'Alt+Shift+W',
      // `editor.limitContentWidth`: a readable centered column, or the whole width of the tab.
      state: () => isToggleOn('editor.limitContentWidth'),
      run: async () => {
        await flipSetting('editor.limitContentWidth')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.zoomIn,
      group: 'View',
      title: 'Zoom In',
      // Ctrl+plus and the numpad plus work too (`zoomAliasCommand` in keyboard.ts).
      keybinding: 'Mod+=',
      run: async () => {
        await zoomBy(1)
      },
    }),
    registerCommand({
      id: COMMAND_IDS.zoomOut,
      group: 'View',
      title: 'Zoom Out',
      keybinding: 'Mod+-',
      run: async () => {
        await zoomBy(-1)
      },
    }),
    registerCommand({
      id: COMMAND_IDS.zoomReset,
      group: 'View',
      title: 'Reset Zoom',
      keybinding: 'Mod+0',
      run: async () => {
        await zoomTo(ZOOM_DEFAULT)
      },
    }),
    registerCommand({
      id: COMMAND_IDS.switchTheme,
      group: 'View',
      title: 'Switch Theme',
      // A pick list of the themes there are; choosing one writes `theme` (features/palette).
      run: () => {
        openPicker('themes')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.findReferences,
      group: 'File',
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
      group: 'Find',
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
      group: 'Find',
      title: 'Replace...',
      keybinding: 'Mod+H',
      enabled: canFind,
      run: () => {
        openFind(true)
      },
    }),
    registerCommand({
      id: COMMAND_IDS.findNext,
      group: 'Find',
      title: 'Find Next',
      keybinding: 'F3',
      enabled: canFind,
      run: () => {
        stepFind('next')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.findPrevious,
      group: 'Find',
      title: 'Find Previous',
      keybinding: 'Shift+F3',
      enabled: canFind,
      run: () => {
        stepFind('previous')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.goToLine,
      group: 'Tabs & Navigation',
      title: 'Go to Line...',
      keybinding: 'Mod+G',
      // Off for an image or the Settings tab. The tabs Find can search are the ones with lines.
      enabled: canFind,
      run: () => {
        togglePalette('line')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.clearRecent,
      group: 'File',
      title: 'Clear Recent',
      run: clearRecent,
    }),
    registerCommand({
      id: COMMAND_IDS.splitRight,
      group: 'Tabs & Navigation',
      title: 'Split Right',
      keybinding: 'Alt+Shift+2',
      run: () => {
        splitActivePane('row')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.splitDown,
      group: 'Tabs & Navigation',
      title: 'Split Down',
      keybinding: 'Alt+Shift+8',
      run: () => {
        splitActivePane('column')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.closeTab,
      group: 'Tabs & Navigation',
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
      group: 'Tabs & Navigation',
      title: 'Close All',
      keybinding: 'Mod+Shift+W',
      enabled: activePaneHasTabs,
      run: async () => {
        await closeAllTabs()
      },
    }),
    registerCommand({
      id: COMMAND_IDS.cycleTabs,
      group: 'Tabs & Navigation',
      title: 'Cycle Tabs',
      // Opens the tab list of the focused pane with the next tab marked; each press moves the mark
      // and letting go of Ctrl switches. From the palette there is no key to let go of, so it just
      // switches to the next tab.
      keybinding: 'Mod+Tab',
      enabled: canCycleTabs,
      run: () => {
        cycleTabs('next')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.cycleTabsBack,
      group: 'Tabs & Navigation',
      title: 'Cycle Tabs Backward',
      keybinding: 'Mod+Shift+Tab',
      enabled: canCycleTabs,
      run: () => {
        cycleTabs('previous')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.nextTab,
      group: 'Tabs & Navigation',
      title: 'Next Tab',
      keybinding: 'Mod+PageDown',
      enabled: canCycleTabs,
      run: () => {
        stepTabs('next')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.previousTab,
      group: 'Tabs & Navigation',
      title: 'Previous Tab',
      keybinding: 'Mod+PageUp',
      enabled: canCycleTabs,
      run: () => {
        stepTabs('previous')
      },
    }),
    registerCommand({
      id: COMMAND_IDS.findInFolders,
      group: 'Find',
      title: 'Search in Folders...',
      keybinding: 'Mod+Shift+F',
      // The query box takes focus; the selected line of the editor, if any, is the query.
      run: showSearch,
    }),
    registerCommand({
      id: COMMAND_IDS.showOutline,
      group: 'View',
      title: 'Show Outline',
      keybinding: 'Mod+Shift+L',
      // The list takes focus, so the arrow keys move through the headings at once.
      run: showOutline,
    }),
    registerCommand({
      id: COMMAND_IDS.toggleSidebar,
      group: 'View',
      title: 'Toggle Sidebar',
      keybinding: 'Mod+Shift+B',
      run: toggleSidebar,
    }),
    registerCommand({
      id: COMMAND_IDS.focusSidebar,
      group: 'View',
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
      group: 'View',
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
      group: 'Tabs & Navigation',
      title: 'Go Back',
      keybinding: 'Alt+ArrowLeft',
      enabled: canGoBack,
      run: async () => {
        await goBack()
      },
    }),
    registerCommand({
      id: COMMAND_IDS.forward,
      group: 'Tabs & Navigation',
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
        group: 'Formatting',
        title: format.title,
        keybinding: format.keybinding,
        enabled: hasTab,
        run: formatActive(format.make),
      }),
    ),
    registerCommand({
      id: COMMAND_IDS.exit,
      group: 'App',
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
