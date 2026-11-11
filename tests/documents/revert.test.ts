import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { docMeta } from '@/documents/meta'
import {
  canRevertActive,
  documentOfTab,
  followerOfTab,
  openPath,
  pendingRevert,
  problem,
  refreshMissing,
  requestRevert,
  resetDocuments,
  resolvePendingRevert,
  watchDisk,
} from '@/documents/store'
import { newUntitledTab, resetUntitled } from '@/documents/untitled'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { clearCommands, isCommandEnabled, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetWorkbench, selectTab } from '@/workbench/store'

const A = 'C:/notes/a.md'

let host: MockHost
let removeCommands: () => void

function type(tab: string, text: string): void {
  const follower = followerOfTab(tab)
  if (follower === undefined) throw new Error('no document')
  follower.dispatch({ changes: { from: follower.state.doc.length, insert: text } })
}

const textOf = (tab: string): string => documentOfTab(tab)?.master.doc.toString() ?? '<none>'

beforeEach(() => {
  host = createMockHost({ files: { [A]: 'on disk\n' } })
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

describe('Revert File', () => {
  it('asks first, and Cancel leaves the edits where they were', async () => {
    const tab = await openPath(A)
    type(tab, 'my edit\n')
    await runCommand(COMMAND_IDS.revert)
    expect(pendingRevert.value?.tabId).toBe(tab)
    expect(textOf(tab)).toBe('on disk\nmy edit\n')

    await resolvePendingRevert('cancel')
    expect(pendingRevert.value).toBeNull()
    expect(textOf(tab)).toBe('on disk\nmy edit\n')
    expect(docMeta(documentOfTab(tab)!.id)?.dirty).toBe(true)
  })

  it('on Revert, the text equals the file and the document is clean', async () => {
    const tab = await openPath(A)
    type(tab, 'my edit\n')
    await requestRevert()
    expect(textOf(tab)).toBe('on disk\nmy edit\n') // nothing happens before the answer
    await resolvePendingRevert('revert')
    expect(textOf(tab)).toBe('on disk\n')
    expect(documentOfTab(tab)!.dirty).toBe(false)
    expect(host.files.read(A)).toBe('on disk\n')
    // The history of the thrown-away edits is gone with them.
    expect(documentOfTab(tab)!.undo(followerOfTab(tab)!)).toBe(false)
  })

  it('brings in what another program wrote, not what the document last read', async () => {
    const tab = await openPath(A)
    type(tab, 'my edit\n')
    host.withoutEvents(() => host.files.write(A, 'changed elsewhere\n'))
    await requestRevert()
    await resolvePendingRevert('revert')
    expect(textOf(tab)).toBe('changed elsewhere\n')
    expect(docMeta(documentOfTab(tab)!.id)).toMatchObject({ dirty: false, conflict: null })
  })

  it('clears a conflict and a save error', async () => {
    const tab = await openPath(A)
    type(tab, 'my edit\n')
    host.withoutEvents(() => host.files.write(A, 'theirs\n'))
    const doc = documentOfTab(tab)!
    // A save finds the change and raises the conflict.
    const { saveDocument } = await import('@/documents/store')
    await saveDocument(doc.id)
    expect(docMeta(doc.id)?.conflict).toBe('save')
    await requestRevert()
    await resolvePendingRevert('revert')
    expect(docMeta(doc.id)).toMatchObject({ conflict: null, saveError: null, dirty: false })
    expect(textOf(tab)).toBe('theirs\n')
  })

  it('works on a document with no edits too: it reloads the file', async () => {
    const tab = await openPath(A)
    host.withoutEvents(() => host.files.write(A, 'new content\n'))
    await requestRevert()
    await resolvePendingRevert('revert')
    expect(textOf(tab)).toBe('new content\n')
  })

  it('is off for an untitled tab', async () => {
    await newUntitledTab()
    expect(canRevertActive()).toBe(false)
    expect(isCommandEnabled(COMMAND_IDS.revert)).toBe(false)
    await requestRevert()
    expect(pendingRevert.value).toBeNull()
  })

  it('is off for a file that is gone from disk, and says why when asked anyway', async () => {
    const tab = await openPath(A)
    const doc = documentOfTab(tab)!
    expect(canRevertActive()).toBe(true)
    host.withoutEvents(() => host.files.delete(A))
    // Nobody has looked yet, so the command still looks available; looking changes that.
    await refreshMissing(doc.id)
    expect(docMeta(doc.id)?.missing).toBe(true)
    expect(canRevertActive()).toBe(false)
    expect(isCommandEnabled(COMMAND_IDS.revert)).toBe(false)
  })

  it('looks again at the moment of the request, so a stale "present" does not ask for nothing', async () => {
    const tab = await openPath(A)
    type(tab, 'my edit\n')
    expect(docMeta(documentOfTab(tab)!.id)?.missing).toBe(false)
    host.withoutEvents(() => host.files.delete(A))
    await requestRevert()
    expect(pendingRevert.value).toBeNull()
    expect(problem.value).toMatch(/no longer on disk/)
    expect(textOf(tab)).toBe('on disk\nmy edit\n')
  })

  it('looks by itself when another tab comes to the front, once the disk watcher is running', async () => {
    const tab = await openPath(A)
    host.files.write('C:/notes/b.md', 'b\n')
    const other = await openPath('C:/notes/b.md')
    await watchDisk()
    const doc = documentOfTab(tab)!
    host.withoutEvents(() => host.files.delete(A))
    selectTab(other)
    selectTab(tab)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(docMeta(doc.id)?.missing).toBe(true)
    expect(canRevertActive()).toBe(false)
  })

  it('is on again once the file is back', async () => {
    const tab = await openPath(A)
    const doc = documentOfTab(tab)!
    host.withoutEvents(() => host.files.delete(A))
    await refreshMissing(doc.id)
    host.withoutEvents(() => host.files.write(A, 'back\n'))
    await refreshMissing(doc.id)
    expect(canRevertActive()).toBe(true)
  })

  it('shows a failure instead of silently keeping the edits when the file vanishes mid-way', async () => {
    const tab = await openPath(A)
    type(tab, 'my edit\n')
    await requestRevert()
    host.withoutEvents(() => host.files.delete(A))
    await resolvePendingRevert('revert')
    expect(problem.value).toMatch(/Could not revert/)
    expect(textOf(tab)).toBe('on disk\nmy edit\n')
    expect(docMeta(documentOfTab(tab)!.id)?.missing).toBe(true)
  })
})
