import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { docMeta } from '@/documents/meta'
import {
  activeDocument,
  documentOfTab,
  followerOfTab,
  openFromDialog,
  openPath,
  pendingClose,
  problem,
  requestCloseTab,
  resetDocuments,
  resolvePendingClose,
  saveDocument,
} from '@/documents/store'
import { endingsOf } from '@/editor/lineEndings'
import { createMockHost, type MockHost } from '@/platform/mock'
import { setHost } from '@/platform'
import { clearCommands, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { findPane, panesOf } from '@/workbench/splitTree'
import {
  resetWorkbench,
  selectTab,
  splitActivePane,
  tabInfo,
  workbenchLayout,
} from '@/workbench/store'

let host: MockHost
let removeCommands: () => void
let removeKeybindings: () => void
let target: EventTarget
let picks: string[][]

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Types into a tab's view of a document, as a user would. */
function edit(tabId: string, changes: { from: number; to?: number; insert?: string }): void {
  const follower = followerOfTab(tabId)
  if (follower === undefined) throw new Error(`no document in ${tabId}`)
  follower.dispatch({ changes })
}

beforeEach(() => {
  picks = []
  host = createMockHost({
    files: {
      'C:/notes/a.md': '# A\n\nfirst\n',
      'C:/notes/b.md': '# B\n',
      'C:/notes/windows.md': 'one\r\ntwo\r\nthree\r\n',
      'C:/notes/mixed.md': 'lf\ncrlf\r\ncr\rlast',
      'C:/notes/latin.md': 'caf\u00e9',
    },
    pick: () => picks.shift() ?? [],
  })
  host.files.markUnsupported('C:/notes/latin.md')
  setHost(host)
  resetWorkbench()
  resetDocuments()
  removeCommands = registerDefaultCommands()
  target = new EventTarget()
  removeKeybindings = installKeybindings(target, 'other')
})

afterEach(() => {
  removeKeybindings()
  removeCommands()
  clearCommands()
  resetWorkbench()
  resetDocuments()
  setHost(undefined)
})

describe('opening a file', () => {
  it('puts its content in a tab named after the file', async () => {
    const tab = await openPath('C:/notes/a.md')
    expect(documentOfTab(tab)?.master.doc.toString()).toBe('# A\n\nfirst\n')
    expect(tabInfo(tab)).toMatchObject({ title: 'a.md', dirty: false, kind: 'markdown' })
    expect(workbenchLayout.value.activePane).toBe(panesOf(workbenchLayout.value)[0]?.id)
    expect(findPane(workbenchLayout.value, workbenchLayout.value.activePane)?.activeTab).toBe(tab)
  })

  it('opens a loose file with no folder open at all', async () => {
    // No workspace exists in this host: the file stands alone, as when launched from Explorer.
    expect(host.files.paths()).toContain('C:/notes/a.md')
    const tab = await openPath('C:/notes/b.md')
    expect(documentOfTab(tab)?.master.doc.toString()).toBe('# B\n')
    expect(docMeta(documentOfTab(tab)?.id ?? -1)?.path).toBe('C:/notes/b.md')
  })

  it('opens what the dialog returns, each in its own tab', async () => {
    picks.push(['C:/notes/a.md', 'C:/notes/b.md'])
    await openFromDialog()
    const panes = panesOf(workbenchLayout.value)
    expect(panes[0]?.tabs.map((id) => tabInfo(id).title)).toEqual(['a.md', 'b.md'])
    expect(problem.value).toBeNull()
  })

  it('opens nothing when the dialog is cancelled', async () => {
    await openFromDialog()
    expect(panesOf(workbenchLayout.value)[0]?.tabs).toEqual([])
  })

  it('says which file would not open and goes on with the others', async () => {
    picks.push(['C:/notes/missing.md', 'C:/notes/b.md'])
    await openFromDialog()
    expect(problem.value).toMatch(/missing\.md/)
    expect(panesOf(workbenchLayout.value)[0]?.tabs.map((id) => tabInfo(id).title)).toEqual(['b.md'])
  })

  it('opens a file Rust cannot save as read-only, with its text shown', async () => {
    const tab = await openPath('C:/notes/latin.md')
    const doc = documentOfTab(tab)
    expect(doc?.readOnly).toBe('unsupported-encoding')
    expect(docMeta(doc?.id ?? -1)?.readOnly).toBe('unsupported-encoding')
    expect(await saveDocument(doc?.id ?? -1)).toBe(false)
  })
})

describe('opening a file that is already open', () => {
  it('focuses its tab instead of opening a second one', async () => {
    const a = await openPath('C:/notes/a.md')
    await openPath('C:/notes/b.md')
    expect(activeDocument()?.name).toBe('b.md')
    const again = await openPath('C:/notes/a.md')
    expect(again).toBe(a)
    expect(panesOf(workbenchLayout.value)[0]?.tabs).toHaveLength(2)
    expect(activeDocument()?.name).toBe('a.md')
  })

  it('treats another spelling of the path as the same file', async () => {
    const a = await openPath('C:/notes/a.md')
    expect(await openPath('c:/NOTES/A.md')).toBe(a)
    expect(panesOf(workbenchLayout.value)[0]?.tabs).toHaveLength(1)
  })

  it('focuses the tab in another pane, moving the focus there', async () => {
    const a = await openPath('C:/notes/a.md')
    splitActivePane('row')
    const [left, right] = panesOf(workbenchLayout.value)
    await openPath('C:/notes/b.md') // goes into the active (right) pane
    expect(workbenchLayout.value.activePane).toBe(right?.id)
    selectTab(a)
    await openPath('C:/notes/b.md')
    expect(workbenchLayout.value.activePane).toBe(right?.id)
    expect(left?.tabs).toContain(a)
  })
})

describe('saving', () => {
  it('marks a document dirty when it is edited and clean when it is saved', async () => {
    const tab = await openPath('C:/notes/a.md')
    expect(tabInfo(tab).dirty).toBe(false)
    edit(tab, { from: 0, insert: 'X' })
    expect(tabInfo(tab).dirty).toBe(true)
    expect(await saveDocument(documentOfTab(tab)?.id ?? -1)).toBe(true)
    expect(tabInfo(tab).dirty).toBe(false)
    expect(host.files.read('C:/notes/a.md')).toBe('X# A\n\nfirst\n')
  })

  it('writes on Ctrl+S, and takes the key from the page whether or not it writes', async () => {
    const tab = await openPath('C:/notes/a.md')
    const press = () => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), {
        key: 's',
        code: 'KeyS',
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
      })
      target.dispatchEvent(event)
      return event
    }
    const saveFile = vi.spyOn(host, 'saveFile')

    expect(press().defaultPrevented).toBe(true) // nothing to save, but the browser gets no Save As
    await settle()
    expect(saveFile).not.toHaveBeenCalled()

    edit(tab, { from: 4, insert: 'hello ' })
    expect(press().defaultPrevented).toBe(true)
    await settle()
    expect(saveFile).toHaveBeenCalledOnce()
    expect(host.files.read('C:/notes/a.md')).toBe('# A\nhello \nfirst\n')
  })

  it('saves the document in the focused tab', async () => {
    await openPath('C:/notes/a.md')
    const b = await openPath('C:/notes/b.md')
    edit(b, { from: 0, insert: '! ' })
    expect(await runCommand(COMMAND_IDS.save)).toBe(true)
    expect(host.files.read('C:/notes/b.md')).toBe('! # B\n')
    expect(host.files.read('C:/notes/a.md')).toBe('# A\n\nfirst\n')
  })

  it('keeps the line endings the file had', async () => {
    const win = await openPath('C:/notes/windows.md')
    edit(win, { from: 3, insert: ' and a half' })
    await runCommand(COMMAND_IDS.save)
    expect(host.files.read('C:/notes/windows.md')).toBe('one and a half\r\ntwo\r\nthree\r\n')

    const mixed = await openPath('C:/notes/mixed.md')
    const mixedDoc = documentOfTab(mixed)
    if (mixedDoc === undefined) throw new Error('no document')
    expect(endingsOf(mixedDoc.master)).toEqual({ dominant: 0, at: [1, 2], codes: [1, 2] })
    edit(mixed, { from: 0, insert: '>' })
    await runCommand(COMMAND_IDS.save)
    expect(host.files.read('C:/notes/mixed.md')).toBe('>lf\ncrlf\r\ncr\rlast')
  })

  it('keeps later line breaks with their own endings when lines are added or removed before them', async () => {
    const added = await openPath('C:/notes/mixed.md')
    // A new line inside "lf": the breaks after it keep CRLF and CR, and the new break takes
    // the ending of the line it was typed on.
    edit(added, { from: 2, insert: '\nnew' })
    await runCommand(COMMAND_IDS.save)
    expect(host.files.read('C:/notes/mixed.md')).toBe('lf\nnew\ncrlf\r\ncr\rlast')

    host.files.write('C:/notes/m2.md', 'a\nb\r\nc\rd')
    const removed = await openPath('C:/notes/m2.md')
    // Deleting the first line takes its break with it; the ones after it move up with theirs.
    edit(removed, { from: 0, to: 2 })
    await runCommand(COMMAND_IDS.save)
    expect(host.files.read('C:/notes/m2.md')).toBe('b\r\nc\rd')
  })

  it('is not dirty when an edit is undone back to what is on disk', async () => {
    const tab = await openPath('C:/notes/a.md')
    edit(tab, { from: 0, insert: 'X' })
    expect(tabInfo(tab).dirty).toBe(true)
    edit(tab, { from: 0, to: 1 })
    expect(tabInfo(tab).dirty).toBe(false)
  })

  it('keeps edits made while a save was running as unsaved', async () => {
    const tab = await openPath('C:/notes/a.md')
    edit(tab, { from: 0, insert: 'one ' })
    // Hold the host's write open, so the next edit lands while the save is in flight.
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const write = host.saveFile.bind(host)
    vi.spyOn(host, 'saveFile').mockImplementationOnce(async (...args) => {
      await gate
      return write(...args)
    })
    const saving = saveDocument(documentOfTab(tab)?.id ?? -1)
    await settle()
    edit(tab, { from: 0, insert: 'two ' })
    release()
    expect(await saving).toBe(true)
    expect(host.files.read('C:/notes/a.md')).toBe('one # A\n\nfirst\n')
    expect(tabInfo(tab).dirty).toBe(true)
  })

  it('reports a failed save on the document and stays dirty', async () => {
    const tab = await openPath('C:/notes/a.md')
    edit(tab, { from: 0, insert: 'X' })
    vi.spyOn(host, 'saveFile').mockRejectedValueOnce({ kind: 'io', message: 'disk full' })
    expect(await saveDocument(documentOfTab(tab)?.id ?? -1)).toBe(false)
    expect(docMeta(documentOfTab(tab)?.id ?? -1)?.saveError).toBe('disk full')
    expect(tabInfo(tab).dirty).toBe(true)
    expect(await saveDocument(documentOfTab(tab)?.id ?? -1)).toBe(true)
    expect(docMeta(documentOfTab(tab)?.id ?? -1)?.saveError).toBeNull()
  })

  it('says a read-only file is read-only, and never shows an OS error code (ISC-244)', async () => {
    const tab = await openPath('C:/notes/a.md')
    edit(tab, { from: 0, insert: 'X' })
    const words = 'the file is read-only on disk. Use Save As to keep your changes in a new file'
    vi.spyOn(host, 'saveFile').mockRejectedValueOnce({ kind: 'file-read-only', message: words })
    expect(await saveDocument(documentOfTab(tab)?.id ?? -1)).toBe(false)
    expect(docMeta(documentOfTab(tab)?.id ?? -1)?.saveError).toBe(words)
    vi.spyOn(host, 'saveFile').mockRejectedValueOnce(new Error('Access is denied. (os error 5)'))
    expect(await saveDocument(documentOfTab(tab)?.id ?? -1)).toBe(false)
    expect(docMeta(documentOfTab(tab)?.id ?? -1)?.saveError).toBe('Access is denied.')
  })
})

describe('closing a tab', () => {
  it('closes a clean tab at once and tells the host the document is gone', async () => {
    const tab = await openPath('C:/notes/a.md')
    expect(host.openDocuments().size).toBe(1)
    requestCloseTab(tab)
    await settle()
    expect(panesOf(workbenchLayout.value)[0]?.tabs).toEqual([])
    expect(host.openDocuments().size).toBe(0)
    expect(pendingClose.value).toBeNull()
  })

  it('asks before closing the last tab of a document with unsaved edits', async () => {
    const tab = await openPath('C:/notes/a.md')
    edit(tab, { from: 0, insert: 'X' })
    requestCloseTab(tab)
    expect(pendingClose.value?.tabId).toBe(tab)
    expect(panesOf(workbenchLayout.value)[0]?.tabs).toEqual([tab])

    await resolvePendingClose('cancel')
    expect(pendingClose.value).toBeNull()
    expect(panesOf(workbenchLayout.value)[0]?.tabs).toEqual([tab])
    expect(tabInfo(tab).dirty).toBe(true)
  })

  it('saves and closes, or discards and closes, on request', async () => {
    const a = await openPath('C:/notes/a.md')
    edit(a, { from: 0, insert: 'X' })
    requestCloseTab(a)
    await resolvePendingClose('save')
    expect(host.files.read('C:/notes/a.md')).toBe('X# A\n\nfirst\n')
    expect(panesOf(workbenchLayout.value)[0]?.tabs).toEqual([])

    const b = await openPath('C:/notes/b.md')
    edit(b, { from: 0, insert: 'Y' })
    requestCloseTab(b)
    await resolvePendingClose('discard')
    expect(host.files.read('C:/notes/b.md')).toBe('# B\n')
    expect(panesOf(workbenchLayout.value)[0]?.tabs).toEqual([])
  })

  it('stays open when the save in "save and close" fails', async () => {
    const tab = await openPath('C:/notes/a.md')
    edit(tab, { from: 0, insert: 'X' })
    vi.spyOn(host, 'saveFile').mockRejectedValueOnce({ kind: 'io', message: 'locked' })
    requestCloseTab(tab)
    await resolvePendingClose('save')
    expect(pendingClose.value?.tabId).toBe(tab)
    expect(panesOf(workbenchLayout.value)[0]?.tabs).toEqual([tab])
  })

  it('closes freely while another tab still shows the document', async () => {
    const tab = await openPath('C:/notes/a.md')
    splitActivePane('row')
    edit(tab, { from: 0, insert: 'X' })
    requestCloseTab(tab)
    expect(pendingClose.value).toBeNull()
    await settle()
    expect(host.openDocuments().size).toBe(1)
    expect(activeDocument()?.dirty).toBe(true)
  })
})
