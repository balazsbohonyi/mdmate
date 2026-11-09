// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  historySnapshot,
  resetHistory,
} from '@/documents/history'
import { followLinkFrom } from '@/documents/links'
import { documentOfTab, followerOfTab, openPath, problem, resetDocuments } from '@/documents/store'
import { APP_KEYS, editorKeymap } from '@/editor/create'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { clearCommands } from '@/workbench/commands'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { findPane } from '@/workbench/splitTree'
import { closeTabById, resetWorkbench, workbenchLayout } from '@/workbench/store'

const files = {
  'C:/notes/a.md': '# A\n\nIntro with [b](b.md) and [down](#later).\n\n## Later\n\nend\n',
  'C:/notes/b.md': '# B\n\nfirst\n\n## Part\n\nmore\n',
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function activeTab(): string {
  const tab = findPane(workbenchLayout.value, workbenchLayout.value.activePane)?.activeTab
  if (tab === null || tab === undefined) throw new Error('no active tab')
  return tab
}
const activeName = () => documentOfTab(activeTab())?.name
const caret = () => followerOfTab(activeTab())?.state.selection.main.head

function putCaret(tabId: string, pos: number): void {
  followerOfTab(tabId)?.dispatch({ selection: { anchor: pos } })
}

beforeEach(() => {
  setHost(createMockHost({ files }))
  resetWorkbench()
  resetDocuments()
  resetHistory()
  problem.value = null
})
afterEach(() => {
  setHost(undefined)
})

describe('location history', () => {
  it('Alt+Left returns to where the caret was before a link jump to another tab (ISC-80)', async () => {
    const a = await openPath('C:/notes/a.md')
    const linkPos = files['C:/notes/a.md'].indexOf('[b]') + 1
    putCaret(a, linkPos)
    await followLinkFrom(a, 'b.md')
    expect(activeName()).toBe('b.md')
    expect(await goBack()).toBe(true)
    expect(activeTab()).toBe(a)
    expect(caret()).toBe(linkPos)
  })

  it('Alt+Right moves forward again (ISC-81)', async () => {
    const a = await openPath('C:/notes/a.md')
    await followLinkFrom(a, 'b.md#part')
    const b = activeTab()
    const part = files['C:/notes/b.md'].indexOf('## Part')
    await goBack()
    expect(activeTab()).toBe(a)
    expect(canGoForward()).toBe(true)
    expect(await goForward()).toBe(true)
    expect(activeTab()).toBe(b)
    expect(caret()).toBe(part)
    expect(canGoForward()).toBe(false)
  })

  it('walks anchor jumps inside one document too', async () => {
    const a = await openPath('C:/notes/a.md')
    putCaret(a, 3)
    await followLinkFrom(a, '#later')
    expect(caret()).toBe(files['C:/notes/a.md'].indexOf('## Later'))
    await goBack()
    expect(caret()).toBe(3)
    await goForward()
    expect(caret()).toBe(files['C:/notes/a.md'].indexOf('## Later'))
  })

  it('remembers where the caret moved after a jump when going back and forward', async () => {
    const a = await openPath('C:/notes/a.md')
    await followLinkFrom(a, 'b.md')
    const b = activeTab()
    putCaret(b, 8)
    await goBack()
    await goForward()
    expect(caret()).toBe(8)
  })

  it('drops what lies ahead when a new jump is made after going back', async () => {
    const a = await openPath('C:/notes/a.md')
    await followLinkFrom(a, 'b.md')
    await goBack()
    await followLinkFrom(a, '#later')
    expect(canGoForward()).toBe(false)
    expect(historySnapshot().entries.map((e) => e.path)).toEqual(['C:/notes/a.md', 'C:/notes/a.md'])
  })

  it('reopens a file whose tab was closed', async () => {
    const a = await openPath('C:/notes/a.md')
    await followLinkFrom(a, 'b.md')
    const b = activeTab()
    await goBack()
    closeTabById(b)
    expect(await goForward()).toBe(true)
    expect(activeName()).toBe('b.md')
  })

  it('does nothing with no history, and records nothing for a failed jump', async () => {
    const a = await openPath('C:/notes/a.md')
    expect(canGoBack()).toBe(false)
    expect(await goBack()).toBe(false)
    await followLinkFrom(a, 'gone.md')
    await followLinkFrom(a, '#no-such-heading')
    expect(canGoBack()).toBe(false)
    expect(activeTab()).toBe(a)
  })
})

describe('the Alt+Left and Alt+Right keys', () => {
  let uninstall: () => void
  let removeCommands: () => void
  beforeEach(() => {
    removeCommands = registerDefaultCommands()
    uninstall = installKeybindings(window, 'other')
  })
  afterEach(() => {
    uninstall()
    removeCommands()
    clearCommands()
  })

  const press = (key: 'ArrowLeft' | 'ArrowRight') => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, code: key, altKey: true, cancelable: true }),
    )
  }

  it('go back and forward through the command registry', async () => {
    const a = await openPath('C:/notes/a.md')
    await followLinkFrom(a, 'b.md')
    press('ArrowLeft')
    await settle()
    await settle()
    expect(activeTab()).toBe(a)
    press('ArrowRight')
    await settle()
    await settle()
    expect(activeName()).toBe('b.md')
  })

  it('are not taken by the editor first', () => {
    for (const key of ['Alt-ArrowLeft', 'Alt-ArrowRight']) {
      expect(APP_KEYS.has(key)).toBe(true)
      expect(editorKeymap.some((binding) => binding.key === key)).toBe(false)
    }
    // Only those keys are taken out of CodeMirror's defaults.
    expect(editorKeymap.some((binding) => binding.key === 'Mod-ArrowLeft')).toBe(true)
  })

  it('reach the history when pressed inside a real view of a tab', async () => {
    const a = await openPath('C:/notes/a.md')
    await followLinkFrom(a, 'b.md')
    const b = activeTab()
    const follower = followerOfTab(b)
    if (follower === undefined) throw new Error('no follower')
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({ state: follower.state, parent })
    follower.show(view)
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        code: 'ArrowLeft',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await settle()
    await settle()
    expect(activeTab()).toBe(a)
    follower.park()
    view.destroy()
  })
})
