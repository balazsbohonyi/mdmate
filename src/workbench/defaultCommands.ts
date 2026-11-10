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
import {
  canSaveActive,
  followerOfTab,
  openFromDialog,
  requestCloseTab,
  saveActiveDocument,
} from '@/documents/store'
import { canGoBack, canGoForward, goBack, goForward } from '@/documents/history'
import { togglePalette } from '@/features/palette/state'
import { openFolderDialog } from '@/features/tree/store'
import { getHost } from '@/platform'
import { registerCommand, removeCommand } from './commands'
import { findPane } from './splitTree'
import { splitActivePane, workbenchLayout } from './store'
import { toggleRaw } from './rawMode'
import { toggleSidebar } from './sidebar'

export const COMMAND_IDS = {
  open: 'file.open',
  openFolder: 'file.openFolder',
  quickOpen: 'file.quickOpen',
  commandPalette: 'view.commandPalette',
  save: 'file.save',
  splitRight: 'workbench.splitRight',
  splitDown: 'workbench.splitDown',
  closeTab: 'workbench.closeTab',
  toggleSidebar: 'view.toggleSidebar',
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
