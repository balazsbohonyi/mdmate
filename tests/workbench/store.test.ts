import { beforeEach, describe, expect, it } from 'vitest'
import { findPane, panesOf } from '@/workbench/splitTree'
import {
  closeTabById,
  dropTabOnEdge,
  moveTabTo,
  resetWorkbench,
  resizeSplit,
  selectTab,
  splitActivePane,
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
