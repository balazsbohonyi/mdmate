import { beforeEach, describe, expect, it } from 'vitest'
import { findPane, panesOf } from '@/workbench/splitTree'
import {
  closeTabById,
  dropTabOnEdge,
  moveTabTo,
  openSettingsTab,
  resetWorkbench,
  resizeSplit,
  selectTab,
  setSettingsCategory,
  settingsCategoryOf,
  settingsTabId,
  splitActivePane,
  tabRecord,
  tabTitle,
  workbenchLayout,
} from '@/workbench/store'
import { namedDoc, openNewTab } from '../helpers/tabs'

function tabsOf(paneIndex: number): string[] {
  return [...(panesOf(workbenchLayout.value)[paneIndex]?.tabs ?? [])]
}

beforeEach(resetWorkbench)

describe('the workbench store', () => {
  it('starts with one empty pane', () => {
    expect(panesOf(workbenchLayout.value)).toHaveLength(1)
    expect(tabsOf(0)).toEqual([])
  })

  it('opens tabs in the active pane and reads their titles from the document', () => {
    const a = openNewTab('a.md')
    const b = openNewTab('b.md')
    expect(tabsOf(0)).toEqual([a, b])
    expect(tabTitle(a)).toBe('a.md')
    expect(findPane(workbenchLayout.value, 'p1')?.activeTab).toBe(b)
  })

  it('stops answering for a closed tab', () => {
    const a = openNewTab('a.md')
    const b = openNewTab('b.md')
    closeTabById(a)
    expect(tabTitle(a)).toBe(a)
    expect(tabTitle(b)).toBe('b.md')
  })

  it('splits the active pane with a copy of its active tab, or a named tab', () => {
    openNewTab('a.md')
    splitActivePane('row')
    const [, right] = panesOf(workbenchLayout.value)
    expect(right?.tabs.map(tabTitle)).toEqual(['a.md'])
    splitActivePane('column', namedDoc('other.md'))
    const panes = panesOf(workbenchLayout.value)
    expect(panes.at(-1)?.tabs.map(tabTitle)).toEqual(['other.md'])
    expect(panes).toHaveLength(3)
  })

  it('splits an empty pane into an empty neighbour', () => {
    splitActivePane('row')
    expect(panesOf(workbenchLayout.value).map((pane) => pane.tabs.length)).toEqual([0, 0])
  })

  it('moves a tab between panes and to an edge, and closing the last tab drops the pane', () => {
    const a = openNewTab('a.md')
    openNewTab('b.md')
    splitActivePane('row', namedDoc('c.md'))
    moveTabTo(a, panesOf(workbenchLayout.value)[1]?.id ?? '')
    expect(tabsOf(1).includes(a)).toBe(true)
    dropTabOnEdge(a, panesOf(workbenchLayout.value)[0]?.id ?? '', 'bottom')
    expect(panesOf(workbenchLayout.value)).toHaveLength(3)
    const [, lower] = panesOf(workbenchLayout.value)
    expect(lower?.tabs).toEqual([a])
    closeTabById(a)
    expect(panesOf(workbenchLayout.value)).toHaveLength(2)
  })

  it('selects a tab and its pane', () => {
    const a = openNewTab('a.md')
    openNewTab('b.md')
    splitActivePane('row', namedDoc('c.md'))
    selectTab(a)
    expect(workbenchLayout.value.activePane).toBe('p1')
    expect(findPane(workbenchLayout.value, 'p1')?.activeTab).toBe(a)
  })

  it('keeps the model valid after a resize', () => {
    openNewTab('a.md')
    splitActivePane('row')
    const root = workbenchLayout.value.root
    if (root.kind !== 'split') throw new Error('expected a split')
    resizeSplit(root.id, [30, 70])
    const resized = workbenchLayout.value.root
    expect(resized.kind === 'split' ? resized.sizes : []).toEqual([30, 70])
  })
})

describe('the Settings tab', () => {
  const settingsTabs = (): string[] =>
    panesOf(workbenchLayout.value).flatMap((pane) =>
      pane.tabs.filter((id) => tabRecord(id)?.kind === 'settings'),
    )

  it('opens one tab, named Settings, on the first group (ISC-343)', () => {
    const tab = openSettingsTab()
    expect(settingsTabs()).toEqual([tab])
    expect(tabTitle(tab)).toBe('Settings')
    expect(tabRecord(tab)).toEqual({ kind: 'settings', category: 'appearance' })
    expect(findPane(workbenchLayout.value, 'p1')?.activeTab).toBe(tab)
  })

  it('shows that tab again on a second run, and opens no second (ISC-343)', () => {
    const first = openSettingsTab()
    const a = openNewTab('a.md')
    expect(findPane(workbenchLayout.value, 'p1')?.activeTab).toBe(a)
    const second = openSettingsTab()
    expect(second).toBe(first)
    expect(settingsTabs()).toEqual([first])
    expect(findPane(workbenchLayout.value, 'p1')?.activeTab).toBe(first)
  })

  it('focuses the tab in its own pane when it is run from another pane (ISC-343)', () => {
    openNewTab('a.md')
    const settings = openSettingsTab()
    splitActivePane('row')
    const panes = panesOf(workbenchLayout.value)
    const [left, right] = panes
    expect(left?.tabs).toContain(settings)
    // The new pane is the active one and holds a copy of what was shown, which is not the Settings tab.
    expect(workbenchLayout.value.activePane).toBe(right?.id)
    expect(right?.tabs.map((id) => tabRecord(id)?.kind)).toEqual([])
    openSettingsTab()
    expect(settingsTabs()).toEqual([settings])
    expect(workbenchLayout.value.activePane).toBe(left?.id)
  })

  it('opens a new one after the tab was closed', () => {
    const first = openSettingsTab('keyboard')
    closeTabById(first)
    expect(settingsTabId()).toBeUndefined()
    const again = openSettingsTab()
    expect(settingsTabs()).toEqual([again])
    expect(settingsCategoryOf(again)).toBe('appearance')
  })

  it('shows the group it is asked for, and keeps the one a click chose', () => {
    const tab = openSettingsTab('editor')
    expect(settingsCategoryOf(tab)).toBe('editor')
    setSettingsCategory(tab, 'advanced')
    expect(openSettingsTab()).toBe(tab)
    expect(settingsCategoryOf(tab)).toBe('advanced')
    openSettingsTab('files')
    expect(settingsCategoryOf(tab)).toBe('files')
    expect(settingsTabs()).toEqual([tab])
  })

  it('is not copied by a split, right or down: the new pane is empty (ISC-345)', () => {
    const tab = openSettingsTab('editor')
    splitActivePane('row')
    splitActivePane('column')
    const panes = panesOf(workbenchLayout.value)
    expect(panes).toHaveLength(3)
    expect(settingsTabs()).toEqual([tab])
    expect(panes.map((pane) => pane.tabs.length)).toEqual([1, 0, 0])
    expect(tabRecord(tab)).toEqual({ kind: 'settings', category: 'editor' })
  })

  it('is not copied by a split that names it either', () => {
    openNewTab('a.md')
    splitActivePane('row', { kind: 'settings', category: 'files' })
    expect(settingsTabs()).toEqual([])
  })

  it('moves to another pane like any tab, and is still the only one', () => {
    openNewTab('a.md')
    const tab = openSettingsTab()
    splitActivePane('row')
    const [, right] = panesOf(workbenchLayout.value)
    if (right === undefined) throw new Error('no second pane')
    moveTabTo(tab, right.id)
    expect(settingsTabs()).toEqual([tab])
    expect(findPane(workbenchLayout.value, right.id)?.tabs).toContain(tab)
  })
})
