import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { docMeta } from '@/documents/meta'
import {
  canSaveActive,
  documentOfTab,
  followerOfTab,
  openPath,
  resetDocuments,
  saveActiveDocumentAs,
  saveDocument,
  saveDocumentAs,
} from '@/documents/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { clearCommands, isCommandEnabled, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetWorkbench, selectTab, tabTitle } from '@/workbench/store'

const A = 'C:/notes/a.md'
const B = 'C:/notes/b.md'
const LATIN1 = 'C:/notes/latin1.md'
const FAR = 'D:/other/heading-differs.md'

let host: MockHost
let picked: string | null
let removeCommands: () => void

function type(tab: string, text: string): void {
  const follower = followerOfTab(tab)
  if (follower === undefined) throw new Error('no document')
  follower.dispatch({ changes: { from: follower.state.doc.length, insert: text } })
}

beforeEach(() => {
  picked = null
  host = createMockHost({
    files: {
      [A]: '# A\n\nfirst\n',
      [B]: 'bee\n',
      [LATIN1]: 'caf\u00e9\n',
      [FAR]: '# A different title\n',
    },
    pickSave: () => picked,
  })
  host.files.markUnsupported(LATIN1)
  setHost(host)
  resetWorkbench()
  resetDocuments()
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

describe('Save As', () => {
  it('writes to the chosen path and the tab follows the new file', async () => {
    const tab = await openPath(A)
    type(tab, 'edited\n')
    picked = 'C:/notes/copy.md'
    expect(await saveDocumentAs(documentOfTab(tab)!.id)).toBe(true)

    const doc = documentOfTab(tab)!
    expect(host.files.read(picked)).toBe('# A\n\nfirst\nedited\n')
    expect(doc.path).toBe(picked)
    expect(tabTitle(tab)).toBe('copy.md')
    expect(docMeta(doc.id)).toMatchObject({ path: picked, name: 'copy.md', dirty: false })
    // The next plain save goes to the new file, and Rust agrees the document is there.
    type(tab, 'again\n')
    expect(await saveDocument(doc.id)).toBe(true)
    expect(host.files.read(picked)).toBe('# A\n\nfirst\nedited\nagain\n')
    expect(host.openDocuments().get(doc.id)).toBe(picked)
  })

  it('never changes the original file, edited or not', async () => {
    const tab = await openPath(A)
    type(tab, 'edited\n')
    picked = 'C:/notes/copy.md'
    await saveDocumentAs(documentOfTab(tab)!.id)
    expect(host.files.read(A)).toBe('# A\n\nfirst\n')
    type(tab, 'and more\n')
    await saveDocument(documentOfTab(tab)!.id)
    expect(host.files.read(A)).toBe('# A\n\nfirst\n')
  })

  it('keeps the undo history', async () => {
    const tab = await openPath(A)
    const follower = followerOfTab(tab)!
    type(tab, 'edited\n')
    picked = 'C:/notes/copy.md'
    await saveDocumentAs(documentOfTab(tab)!.id)
    const doc = documentOfTab(tab)!
    // The save is not an edit, so the text is not "edited" any more, and undo takes the typing back.
    expect(doc.dirty).toBe(false)
    expect(doc.undo(follower)).toBe(true)
    expect(doc.master.doc.toString()).toBe('# A\n\nfirst\n')
    expect(doc.dirty).toBe(true) // differs from what the new file holds
  })

  it('does nothing when the dialog is cancelled', async () => {
    const tab = await openPath(A)
    type(tab, 'edited\n')
    const doc = documentOfTab(tab)!
    expect(await saveDocumentAs(doc.id)).toBe(false)
    expect(doc.path).toBe(A)
    expect(docMeta(doc.id)).toMatchObject({ dirty: true, saveError: null })
    expect(host.files.paths()).toHaveLength(4)
  })

  it('suggests the document’s own name and folder, not a name from its heading or the last folder used', async () => {
    const far = await openPath(FAR)
    await openPath(A) // the last file opened is in another folder
    selectTab(far)
    await saveDocumentAs(documentOfTab(far)!.id)
    expect(host.saveDialogs[0]).toEqual({ name: 'heading-differs.md', folder: 'D:/other' })
  })

  it('refuses a file that another tab has open, and leaves both as they were', async () => {
    const tab = await openPath(A)
    await openPath(B)
    type(tab, 'edited\n')
    picked = B
    const doc = documentOfTab(tab)!
    expect(await saveDocumentAs(doc.id)).toBe(false)
    expect(docMeta(doc.id)?.saveError).toMatch(/open in another tab/)
    expect(host.files.read(B)).toBe('bee\n')
    expect(doc.path).toBe(A)
    expect(docMeta(doc.id)?.dirty).toBe(true)
  })

  it('to the document’s own file is a plain save, with its guard against a change made behind its back', async () => {
    const tab = await openPath(A)
    type(tab, 'mine\n')
    const doc = documentOfTab(tab)!
    picked = A
    expect(await saveDocumentAs(doc.id)).toBe(true)
    expect(host.files.read(A)).toBe('# A\n\nfirst\nmine\n')

    type(tab, 'more\n')
    host.withoutEvents(() => host.files.write(A, 'someone else\n'))
    expect(await saveDocumentAs(doc.id)).toBe(false)
    expect(docMeta(doc.id)?.conflict).toBe('save')
    expect(host.files.read(A)).toBe('someone else\n')
  })

  it('clears a conflict raised on the old file, since the document leaves it', async () => {
    const tab = await openPath(A)
    type(tab, 'mine\n')
    const doc = documentOfTab(tab)!
    host.withoutEvents(() => host.files.write(A, 'someone else\n'))
    expect(await saveDocument(doc.id)).toBe(false)
    expect(docMeta(doc.id)?.conflict).toBe('save')
    picked = 'C:/notes/escaped.md'
    expect(await saveDocumentAs(doc.id)).toBe(true)
    expect(docMeta(doc.id)).toMatchObject({ conflict: null, saveError: null, dirty: false })
    expect(host.files.read(picked)).toBe('# A\n\nfirst\nmine\n')
    expect(host.files.read(A)).toBe('someone else\n')
  })

  it('is offered for any open document and not for an empty window', async () => {
    expect(isCommandEnabled(COMMAND_IDS.saveAs)).toBe(false)
    await openPath(A)
    expect(isCommandEnabled(COMMAND_IDS.saveAs)).toBe(true)
    picked = 'C:/notes/via-command.md'
    await runCommand(COMMAND_IDS.saveAs)
    expect(host.files.read(picked)).toBe('# A\n\nfirst\n')
    picked = 'C:/notes/via-helper.md'
    await saveActiveDocumentAs()
    expect(host.files.read(picked)).toBe('# A\n\nfirst\n')
  })
})

describe('Save As on a read-only document', () => {
  it('writes UTF-8 and the tab becomes editable and saveable', async () => {
    const tab = await openPath(LATIN1)
    const doc = documentOfTab(tab)!
    expect(doc.readOnly).toBe('unsupported-encoding')
    expect(canSaveActive()).toBe(false)
    expect(isCommandEnabled(COMMAND_IDS.save)).toBe(false)
    expect(isCommandEnabled(COMMAND_IDS.saveAs)).toBe(true)

    picked = 'C:/notes/utf8.md'
    expect(await saveDocumentAs(doc.id)).toBe(true)
    expect(host.files.read(picked)).toBe('caf\u00e9\n')
    expect(host.files.read(LATIN1)).toBe('caf\u00e9\n')
    expect(doc.readOnly).toBeNull()
    expect(docMeta(doc.id)?.readOnly).toBeNull()
    // Typing is allowed now, and the edit saves into the new file.
    expect(followerOfTab(tab)!.state.readOnly).toBe(false)
    type(tab, 'more\n')
    expect(await saveDocument(doc.id)).toBe(true)
    expect(host.files.read(picked)).toBe('caf\u00e9\nmore\n')
  })

  it('never replaces its own original', async () => {
    const tab = await openPath(LATIN1)
    const doc = documentOfTab(tab)!
    picked = LATIN1
    expect(await saveDocumentAs(doc.id)).toBe(false)
    expect(docMeta(doc.id)?.saveError).toMatch(/original is left as it is/)
    expect(doc.readOnly).toBe('unsupported-encoding')
    expect(host.files.read(LATIN1)).toBe('caf\u00e9\n')
  })
})
