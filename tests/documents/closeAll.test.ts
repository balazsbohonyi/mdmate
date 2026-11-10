import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeAllTabs,
  closeTabs,
  documentOfTab,
  followerOfTab,
  openPath,
  pendingClose,
  resetDocuments,
  resolvePendingClose,
} from '@/documents/store'
import { newUntitledTab, resetUntitled } from '@/documents/untitled'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { clearCommands, isCommandEnabled, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { allTabs } from '@/workbench/splitTree'
import { closeTabById, resetWorkbench, splitActivePane, workbenchLayout } from '@/workbench/store'

const A = 'C:/notes/a.md'
const B = 'C:/notes/b.md'
const C = 'C:/notes/c.md'

let host: MockHost
let removeCommands: () => void
let picked: string | null = null

function type(tab: string, text: string): void {
  const follower = followerOfTab(tab)
  if (follower === undefined) throw new Error('no document')
  follower.dispatch({ changes: { from: 0, insert: text } })
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const tabs = (): readonly string[] => allTabs(workbenchLayout.value)

beforeEach(() => {
  picked = null
  host = createMockHost({
    files: { [A]: 'a\n', [B]: 'b\n', [C]: 'c\n', 'C:/notes/pic.png': 'png' },
    pickSave: () => picked,
  })
  setHost(host)
  resetWorkbench()
  resetDocuments()
  resetUntitled()
  clearCommands()
  removeCommands = registerDefaultCommands()
})

afterEach(() => {
  removeCommands()
  clearCommands()
  resetWorkbench()
  resetDocuments()
  setHost(undefined)
})

describe('Close All', () => {
  it('asks once for each of two dirty documents, then leaves no tabs', async () => {
    const a = await openPath(A)
    const b = await openPath(B)
    await openPath(C)
    type(a, 'A!')
    type(b, 'B!')

    const done = closeAllTabs()
    await settle()
    expect(pendingClose.value?.tabId).toBe(a)
    expect(tabs()).toHaveLength(3) // nothing has closed yet: a is waiting
    await resolvePendingClose('discard')
    await settle()
    expect(pendingClose.value?.tabId).toBe(b)
    await resolvePendingClose('save')
    expect(await done).toBe(true)

    expect(tabs()).toEqual([])
    expect(pendingClose.value).toBeNull()
    expect(host.files.read(A)).toBe('a\n') // discarded
    expect(host.files.read(B)).toBe('B!b\n') // saved
    expect(host.openDocuments().size).toBe(0)
  })

  it('stops at Cancel and leaves that tab and the ones after it open', async () => {
    const a = await openPath(A)
    const b = await openPath(B)
    const c = await openPath(C)
    type(a, 'A!')
    type(b, 'B!')
    type(c, 'C!')
    const done = closeAllTabs()
    await settle()
    await resolvePendingClose('discard') // a goes
    await settle()
    expect(pendingClose.value?.tabId).toBe(b)
    await resolvePendingClose('cancel')
    expect(await done).toBe(false)

    expect(tabs()).toEqual([b, c])
    expect(pendingClose.value).toBeNull()
    expect(documentOfTab(b)?.master.doc.toString()).toBe('B!b\n')
  })

  it('asks once for a document shown in two tabs', async () => {
    const a = await openPath(A)
    splitActivePane('row')
    await openPath(A) // a second tab of the same document, in the new pane
    expect(tabs()).toHaveLength(2)
    type(a, 'A!')
    const done = closeAllTabs()
    await settle()
    expect(pendingClose.value).not.toBeNull()
    await resolvePendingClose('discard')
    expect(await done).toBe(true)
    expect(tabs()).toEqual([])
  })

  it('closes clean documents and images without asking', async () => {
    await openPath(A)
    await openPath('C:/notes/pic.png')
    await openPath(B)
    expect(await closeAllTabs()).toBe(true)
    expect(tabs()).toEqual([])
    expect(pendingClose.value).toBeNull()
  })

  it('keeps asking about an untitled tab when its save dialog is cancelled', async () => {
    await newUntitledTab()
    const [tab] = tabs()
    type(tab!, 'draft')
    const done = closeAllTabs()
    await settle()
    await resolvePendingClose('save') // the dialog is cancelled: nothing saved, nothing closed
    expect(pendingClose.value?.tabId).toBe(tab)
    expect(tabs()).toEqual([tab])
    picked = 'C:/notes/draft.md'
    await resolvePendingClose('save')
    expect(await done).toBe(true)
    expect(host.files.read(picked)).toBe('draft')
    expect(tabs()).toEqual([])
  })

  it('works as a command and is off while no tab is open', async () => {
    expect(isCommandEnabled(COMMAND_IDS.closeAll)).toBe(false)
    await openPath(A)
    await openPath(B)
    expect(isCommandEnabled(COMMAND_IDS.closeAll)).toBe(true)
    await runCommand(COMMAND_IDS.closeAll)
    expect(tabs()).toEqual([])
    expect(isCommandEnabled(COMMAND_IDS.closeAll)).toBe(false)
  })

  it('does not strand the waiting caller when the user closes the asked tab another way', async () => {
    const a = await openPath(A)
    const b = await openPath(B)
    type(a, 'A!')
    type(b, 'B!')
    const done = closeAllTabs()
    await settle()
    expect(pendingClose.value?.tabId).toBe(a)
    // Another close request replaces the question; the first Close All gives up instead of hanging.
    const { requestCloseTab } = await import('@/documents/store')
    requestCloseTab(b)
    expect(await done).toBe(false)
    expect(pendingClose.value?.tabId).toBe(b)
  })
})

describe('a question whose tab goes away another way', () => {
  it('lets Close All go on to the next tab instead of waiting for ever', async () => {
    const a = await openPath(A)
    const b = await openPath(B)
    type(a, 'A!')
    const done = closeAllTabs()
    await settle()
    expect(pendingClose.value?.tabId).toBe(a)
    closeTabById(a) // closed by something that does not answer the question
    expect(await done).toBe(true)
    expect(tabs()).toEqual([])
    expect(pendingClose.value).toBeNull()
    expect(documentOfTab(b)).toBeUndefined()
  })
})

describe('closing a list of tabs', () => {
  it('closes only those, in order, and asks for the dirty ones (what Close Others needs)', async () => {
    const a = await openPath(A)
    const b = await openPath(B)
    const c = await openPath(C)
    type(b, 'B!')
    const done = closeTabs([b, c])
    await settle()
    expect(pendingClose.value?.tabId).toBe(b)
    await resolvePendingClose('discard')
    expect(await done).toBe(true)
    expect(tabs()).toEqual([a])
  })
})
