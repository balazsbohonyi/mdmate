/**
 * The Theme preview tab (P8-T7): one tab, beside the Settings screen (ISC-511, ISC-512), never
 * copied by a split (ISC-513), named in the tab and the title bar (ISC-514), and closing cleanly
 * with the document commands doing nothing while it is the active tab (ISC-516).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hostCalls: string[] = []
vi.mock('@/platform', () => ({
  getHost: () =>
    Promise.resolve(
      new Proxy(
        {},
        {
          get: (_target, name) => () => {
            hostCalls.push(String(name))
            return Promise.resolve(undefined)
          },
        },
      ),
    ),
}))

import { requestCloseTab } from '@/documents/store'
import { activeFileLabel } from '@/shell/activeFile'
import { clearCommands, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { findPane, panesOf } from '@/workbench/splitTree'
import { tabMenuState, tabPath } from '@/workbench/tabMenu'
import {
  focusPane,
  openSettingsTab,
  openThemePreviewTab,
  resetWorkbench,
  selectTab,
  settingsTabId,
  splitActivePane,
  tabInfo,
  tabRecord,
  tabTitle,
  themePreviewTabId,
  workbenchLayout,
} from '@/workbench/store'
import { openNewTab } from '../helpers/tabs'

beforeEach(() => {
  resetWorkbench()
  hostCalls.length = 0
})

/** The preview tabs, wherever they are. */
function previews(): string[] {
  return panesOf(workbenchLayout.value).flatMap((pane) =>
    pane.tabs.filter((id) => tabRecord(id)?.kind === 'themePreview'),
  )
}

/** The pane a tab is in, as its place among the panes (0 is the first). */
function paneIndexOf(tab: string): number {
  return panesOf(workbenchLayout.value).findIndex((pane) => pane.tabs.includes(tab))
}

describe('opening the Theme preview (ISC-511)', () => {
  it('opens one tab, named Theme preview, in a new pane to the right of Settings', () => {
    const settings = openSettingsTab()
    const preview = openThemePreviewTab()

    expect(previews()).toEqual([preview])
    expect(tabRecord(preview)).toEqual({ kind: 'themePreview' })
    expect(tabTitle(preview)).toBe('Theme preview')
    const panes = panesOf(workbenchLayout.value)
    expect(panes).toHaveLength(2)
    expect(panes[0]?.tabs).toEqual([settings])
    expect(panes[1]?.tabs).toEqual([preview])
    // It is the one shown and the pane that holds it is the active one.
    expect(panes[1]?.activeTab).toBe(preview)
    expect(workbenchLayout.value.activePane).toBe(panes[1]?.id)
  })

  it('shows that tab again on a second press, and opens no second', () => {
    openSettingsTab()
    const first = openThemePreviewTab()
    focusPane(panesOf(workbenchLayout.value)[0]?.id ?? '')
    const second = openThemePreviewTab()

    expect(second).toBe(first)
    expect(previews()).toEqual([first])
    expect(panesOf(workbenchLayout.value)).toHaveLength(2)
    expect(themePreviewTabId()).toBe(first)
    // Pressing the button brings the tab forward and the focus to its pane.
    expect(workbenchLayout.value.activePane).toBe(panesOf(workbenchLayout.value)[1]?.id)
  })

  it('opens again after it was closed', () => {
    openSettingsTab()
    const first = openThemePreviewTab()
    requestCloseTab(first)
    expect(themePreviewTabId()).toBeUndefined()
    const again = openThemePreviewTab()
    expect(previews()).toEqual([again])
  })

  it('has a tab entry that says what it is', () => {
    openSettingsTab()
    const preview = openThemePreviewTab()
    expect(tabInfo(preview)).toEqual({
      id: preview,
      kind: 'themePreview',
      title: 'Theme preview',
      dirty: false,
    })
  })
})

describe('the pane it opens in (ISC-512)', () => {
  it('goes into the pane beside Settings when there is one, and makes no new pane', () => {
    const doc = openNewTab('a.md')
    splitActivePane('row')
    const settings = openSettingsTab()
    // Settings opened in the active (right, empty) pane; the document is in the left one.
    expect(paneIndexOf(settings)).toBe(1)

    const preview = openThemePreviewTab()
    expect(panesOf(workbenchLayout.value)).toHaveLength(2)
    // The neighbour of the last pane is the one before it.
    expect(paneIndexOf(preview)).toBe(0)
    expect(paneIndexOf(doc)).toBe(0)
    expect(paneIndexOf(settings)).toBe(1)
  })

  it('goes into the pane after the Settings pane when Settings is not last', () => {
    const settings = openSettingsTab()
    splitActivePane('row')
    splitActivePane('row')
    expect(panesOf(workbenchLayout.value)).toHaveLength(3)
    expect(paneIndexOf(settings)).toBe(0)

    const preview = openThemePreviewTab()
    expect(panesOf(workbenchLayout.value)).toHaveLength(3)
    expect(paneIndexOf(preview)).toBe(1)
  })

  it('goes into the pane after the Settings pane when Settings is in the middle of three', () => {
    openNewTab('a.md')
    splitActivePane('row')
    const settings = openSettingsTab()
    splitActivePane('row')
    expect(panesOf(workbenchLayout.value)).toHaveLength(3)
    expect(paneIndexOf(settings)).toBe(1)

    const preview = openThemePreviewTab()
    expect(panesOf(workbenchLayout.value)).toHaveLength(3)
    // After it, not before it.
    expect(paneIndexOf(preview)).toBe(2)
  })

  it('does not depend on which pane is focused', () => {
    const settings = openSettingsTab()
    splitActivePane('row')
    splitActivePane('row')
    const panes = panesOf(workbenchLayout.value)
    // The focus is on the last pane, which is not Settings'.
    focusPane(panes[2]?.id ?? '')
    const preview = openThemePreviewTab()
    expect(paneIndexOf(preview)).toBe(1)
    expect(paneIndexOf(settings)).toBe(0)
    // Now from the Settings pane, and the preview already open: it is shown, not moved.
    focusPane(panes[0]?.id ?? '')
    expect(openThemePreviewTab()).toBe(preview)
    expect(paneIndexOf(preview)).toBe(1)
  })

  it('keeps the Settings tab where it was', () => {
    const settings = openSettingsTab('keyboard')
    openThemePreviewTab()
    expect(settingsTabId()).toBe(settings)
    expect(paneIndexOf(settings)).toBe(0)
  })

  it('makes a pane beside the active one when Settings is not open', () => {
    const doc = openNewTab('a.md')
    const preview = openThemePreviewTab()
    expect(panesOf(workbenchLayout.value)).toHaveLength(2)
    expect(paneIndexOf(doc)).toBe(0)
    expect(paneIndexOf(preview)).toBe(1)
  })
})

describe('splitting the pane of the preview (ISC-513)', () => {
  it('leaves one preview and opens the new pane empty, right and down', () => {
    openSettingsTab()
    const preview = openThemePreviewTab()
    splitActivePane('row')
    splitActivePane('column')
    expect(previews()).toEqual([preview])
    const panes = panesOf(workbenchLayout.value)
    expect(panes).toHaveLength(4)
    expect(panes.at(-1)?.tabs).toEqual([])
  })

  it('does not copy it when a split names it either', () => {
    openSettingsTab()
    const preview = openThemePreviewTab()
    const record = tabRecord(preview)
    if (record === undefined) throw new Error('no record')
    splitActivePane('row', record)
    expect(previews()).toEqual([preview])
    expect(panesOf(workbenchLayout.value).at(-1)?.tabs).toEqual([])
  })

  it('runs the Split Right command with the preview active and copies nothing', async () => {
    registerDefaultCommands()
    try {
      openSettingsTab()
      const preview = openThemePreviewTab()
      await runCommand(COMMAND_IDS.splitRight)
      expect(previews()).toEqual([preview])
      const panes = panesOf(workbenchLayout.value)
      expect(panes.at(-1)?.tabs).toEqual([])
    } finally {
      clearCommands()
    }
  })
})

describe('the title bar and the tab (ISC-514)', () => {
  it('names the preview in the title bar while it is the active tab', () => {
    openNewTab('a.md')
    openSettingsTab()
    const preview = openThemePreviewTab()
    expect(findPane(workbenchLayout.value, workbenchLayout.value.activePane)?.activeTab).toBe(
      preview,
    )
    expect(activeFileLabel.value).toBe('Theme preview')
    expect(activeFileLabel.value).not.toBe('No file open')
  })

  it('names Settings again when that tab is the one shown', () => {
    const settings = openSettingsTab()
    openThemePreviewTab()
    selectTab(settings)
    expect(activeFileLabel.value).toBe('Settings')
  })
})

describe('the tab context menu on the preview (ISC-516)', () => {
  it('offers no file action: no path, nothing to reveal or rename, only closing', () => {
    openNewTab('a.md')
    openSettingsTab()
    const preview = openThemePreviewTab()
    expect(tabPath(preview)).toBeNull()
    const state = tabMenuState(preview)
    expect(state.hasPath).toBe(false)
    expect(state.untitled).toBe(false)
    expect(state.canRevealInSidebar).toBe(false)
    expect(state.canRename).toBe(false)
    expect(state.renameWhyNot).toBeNull()
  })
})

describe('closing it and the commands that need a document (ISC-516)', () => {
  it('closes with no question and no call to the host', () => {
    openSettingsTab()
    const preview = openThemePreviewTab()
    requestCloseTab(preview)
    expect(previews()).toEqual([])
    expect(panesOf(workbenchLayout.value)).toHaveLength(1)
    expect(hostCalls).toEqual([])
  })

  it('closes with Ctrl+W, the close command', async () => {
    registerDefaultCommands()
    try {
      openSettingsTab()
      openThemePreviewTab()
      await runCommand(COMMAND_IDS.closeTab)
      expect(previews()).toEqual([])
    } finally {
      clearCommands()
    }
  })

  it('lets Save, Find and the other document commands do nothing, and throw nothing', async () => {
    registerDefaultCommands()
    try {
      openSettingsTab()
      const preview = openThemePreviewTab()
      const before = workbenchLayout.value
      for (const id of [
        COMMAND_IDS.save,
        COMMAND_IDS.saveAs,
        COMMAND_IDS.find,
        COMMAND_IDS.toggleRawSource,
      ]) {
        await expect(runCommand(id)).resolves.toBeDefined()
      }
      expect(previews()).toEqual([preview])
      expect(workbenchLayout.value.root).toEqual(before.root)
      expect(hostCalls).toEqual([])
    } finally {
      clearCommands()
    }
  })
})
