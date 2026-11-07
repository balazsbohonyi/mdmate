import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { docMeta } from '@/documents/meta'
import {
  documentOfTab,
  followerOfTab,
  openPath,
  resetDocuments,
  resolveConflict,
  saveDocument,
  watchDisk,
} from '@/documents/store'
import { endingsOf } from '@/editor/lineEndings'
import { CRLF, LF, uniformEndings } from '@/lib/endings'
import { createMockHost, type MockHost } from '@/platform/mock'
import { setHost } from '@/platform'
import { resetWorkbench } from '@/workbench/store'

const PATH = 'C:/notes/a.md'

let host: MockHost

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function textOf(tab: string): string {
  return documentOfTab(tab)?.master.doc.toString() ?? '<no document>'
}

function typeInto(tab: string, from: number, insert: string): void {
  const follower = followerOfTab(tab)
  if (follower === undefined) throw new Error(`no document in ${tab}`)
  follower.dispatch({ changes: { from, insert } })
}

function metaOf(tab: string) {
  return docMeta(documentOfTab(tab)?.id ?? -1)
}

/** Holds back every `reloadDocument` call until `release` runs, to make reads overlap with typing. */
function holdReloads(): { release: () => void; calls: () => number } {
  const original = host.reloadDocument.bind(host)
  let open!: () => void
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  let calls = 0
  host.reloadDocument = async (id) => {
    calls++
    const opened = await original(id) // read the file now, hand it over later
    await gate
    return opened
  }
  return { release: open, calls: () => calls }
}

beforeEach(async () => {
  host = createMockHost({ files: { [PATH]: 'one\r\ntwo\r\nthree\r\n' } })
  setHost(host)
  resetWorkbench()
  resetDocuments()
  await watchDisk()
})

afterEach(() => {
  resetWorkbench()
  resetDocuments()
  setHost(undefined)
})

describe('a file changed on disk while its tab has no edits', () => {
  it('reloads the tab with the new content', async () => {
    const tab = await openPath(PATH)
    host.files.write(PATH, 'one\r\nTWO\r\nthree\r\nfour\r\n')
    await settle()

    expect(textOf(tab)).toBe('one\nTWO\nthree\nfour\n')
    expect(followerOfTab(tab)?.state.doc.toString()).toBe('one\nTWO\nthree\nfour\n')
    expect(metaOf(tab)).toMatchObject({ dirty: false, conflict: null })
  })

  it('keeps the caret where it was when the change is elsewhere', async () => {
    const tab = await openPath(PATH)
    followerOfTab(tab)?.dispatch({ selection: { anchor: 12 } }) // after "three"
    host.files.write(PATH, 'zero\r\none\r\ntwo\r\nthree\r\n') // a line added at the top
    await settle()

    expect(textOf(tab)).toBe('zero\none\ntwo\nthree\n')
    expect(followerOfTab(tab)?.state.selection.main.head).toBe(17)
    expect(documentOfTab(tab)?.master.selection.main.head).toBe(17)
  })

  it('starts the undo history over, because its steps describe text that is gone', async () => {
    const tab = await openPath(PATH)
    typeInto(tab, 0, 'x')
    await saveDocument(documentOfTab(tab)?.id ?? -1)
    host.files.write(PATH, 'brand new\r\n')
    await settle()

    expect(documentOfTab(tab)?.undo(followerOfTab(tab)!)).toBe(false)
    expect(textOf(tab)).toBe('brand new\n')
  })

  it('takes the new file’s line endings, and saves with them', async () => {
    const tab = await openPath(PATH) // CRLF
    host.files.write(PATH, 'a\nb\n') // now LF
    await settle()
    expect(endingsOf(documentOfTab(tab)!.master).dominant).toBe(LF)

    typeInto(tab, 0, 'z')
    await saveDocument(documentOfTab(tab)?.id ?? -1)
    expect(host.files.read(PATH)).toBe('za\nb\n')
  })

  it('does nothing for a file that disappears, and the tab keeps its text', async () => {
    const tab = await openPath(PATH)
    host.files.delete(PATH)
    await settle()

    expect(textOf(tab)).toBe('one\ntwo\nthree\n')
    expect(metaOf(tab)).toMatchObject({ dirty: false, conflict: null })
    // Saving an edit puts the file back.
    typeInto(tab, 0, 'x')
    expect(await saveDocument(documentOfTab(tab)?.id ?? -1)).toBe(true)
    expect(host.files.read(PATH)).toBe('xone\r\ntwo\r\nthree\r\n')
  })

  it('applies the latest content when a second change arrives during the read of the first', async () => {
    const tab = await openPath(PATH)
    const held = holdReloads()
    host.files.write(PATH, 'first\r\n')
    await settle()
    host.files.write(PATH, 'second\r\n')
    await settle()
    held.release()
    await settle()
    await settle()

    expect(textOf(tab)).toBe('second\n')
    expect(host.openDocuments().size).toBe(1)
  })

  it('treats typing during the read as an edit worth asking about', async () => {
    const tab = await openPath(PATH)
    const held = holdReloads()
    host.files.write(PATH, 'theirs\r\n')
    await settle()
    typeInto(tab, 0, 'mine ')
    held.release()
    await settle()

    expect(textOf(tab)).toBe('mine one\ntwo\nthree\n')
    expect(metaOf(tab)?.conflict).toBe('disk')
  })

  it('does not raise a conflict for a caret move during the read', async () => {
    const tab = await openPath(PATH)
    const held = holdReloads()
    host.files.write(PATH, 'theirs\r\n')
    await settle()
    followerOfTab(tab)?.dispatch({ selection: { anchor: 3 } })
    held.release()
    await settle()

    expect(textOf(tab)).toBe('theirs\n')
    expect(metaOf(tab)?.conflict).toBeNull()
  })

  it('follows the file turning read-only, in every tab’s editor', async () => {
    const tab = await openPath(PATH)
    expect(followerOfTab(tab)?.state.readOnly).toBe(false)
    host.files.markUnsupported(PATH)
    host.files.write(PATH, 'caf\u00e9')
    await settle()

    expect(documentOfTab(tab)?.readOnly).toBe('unsupported-encoding')
    expect(followerOfTab(tab)?.state.readOnly).toBe(true)
    expect(metaOf(tab)?.readOnly).toBe('unsupported-encoding')
  })
})

describe('a file changed on disk while its tab has edits', () => {
  it('raises a conflict and leaves the edits alone', async () => {
    const tab = await openPath(PATH)
    typeInto(tab, 0, 'mine ')
    host.files.write(PATH, 'theirs\r\n')
    await settle()

    expect(metaOf(tab)).toMatchObject({ dirty: true, conflict: 'disk' })
    expect(textOf(tab)).toBe('mine one\ntwo\nthree\n')
    expect(host.files.read(PATH)).toBe('theirs\r\n')
  })

  it('does not tell the host it has seen the new file, so the host still refuses a save over it', async () => {
    const tab = await openPath(PATH)
    const id = documentOfTab(tab)?.id ?? -1
    const reload = vi.spyOn(host, 'reloadDocument')
    typeInto(tab, 0, 'mine ')
    host.files.write(PATH, 'theirs\r\n')
    await settle()

    expect(reload).not.toHaveBeenCalled()
    await expect(host.saveFile(id, 'mine\n', uniformEndings(CRLF))).rejects.toMatchObject({
      kind: 'disk-changed',
    })
    expect(host.files.read(PATH)).toBe('theirs\r\n')
  })

  it('refuses to save over it until the user chooses', async () => {
    const tab = await openPath(PATH)
    typeInto(tab, 0, 'mine ')
    host.files.write(PATH, 'theirs\r\n')
    await settle()

    expect(await saveDocument(documentOfTab(tab)?.id ?? -1)).toBe(false)
    expect(host.files.read(PATH)).toBe('theirs\r\n')
    expect(metaOf(tab)?.conflict).toBe('disk')
  })

  it('load theirs shows the disk’s content and drops the edits', async () => {
    const tab = await openPath(PATH)
    typeInto(tab, 0, 'mine ')
    host.files.write(PATH, 'theirs\r\n')
    await settle()
    await resolveConflict(documentOfTab(tab)?.id ?? -1, 'theirs')

    expect(textOf(tab)).toBe('theirs\n')
    expect(followerOfTab(tab)?.state.doc.toString()).toBe('theirs\n')
    expect(metaOf(tab)).toMatchObject({ dirty: false, conflict: null, saveError: null })
    expect(documentOfTab(tab)?.undo(followerOfTab(tab)!)).toBe(false)
  })

  it('keep mine keeps the edits, stays edited, and the next save replaces the file', async () => {
    const tab = await openPath(PATH)
    typeInto(tab, 0, 'mine ')
    host.files.write(PATH, 'theirs\r\n')
    await settle()
    const id = documentOfTab(tab)?.id ?? -1
    await resolveConflict(id, 'mine')

    expect(textOf(tab)).toBe('mine one\ntwo\nthree\n')
    expect(metaOf(tab)).toMatchObject({ dirty: true, conflict: null })
    expect(host.files.read(PATH)).toBe('theirs\r\n') // nothing written yet

    expect(await saveDocument(id)).toBe(true)
    expect(host.files.read(PATH)).toBe('mine one\ntwo\nthree\n'.replaceAll('\n', '\r\n'))
    await settle()
    expect(metaOf(tab)).toMatchObject({ dirty: false, conflict: null })
  })

  it('keep mine is not dirty when the edits turn out to equal the disk’s content', async () => {
    const tab = await openPath(PATH)
    typeInto(tab, 0, 'x')
    host.files.write(PATH, 'xone\r\ntwo\r\nthree\r\n')
    await settle()
    await resolveConflict(documentOfTab(tab)?.id ?? -1, 'mine')

    expect(metaOf(tab)).toMatchObject({ dirty: false, conflict: null })
  })

  it('a later change after keeping mine is a new conflict', async () => {
    const tab = await openPath(PATH)
    typeInto(tab, 0, 'mine ')
    host.files.write(PATH, 'theirs\r\n')
    await settle()
    await resolveConflict(documentOfTab(tab)?.id ?? -1, 'mine')
    host.files.write(PATH, 'theirs again\r\n')
    await settle()

    expect(metaOf(tab)?.conflict).toBe('disk')
  })
})

describe('a change the watcher never reported', () => {
  it('is found by the save, which asks instead of overwriting', async () => {
    const tab = await openPath(PATH)
    const id = documentOfTab(tab)?.id ?? -1
    typeInto(tab, 0, 'mine ')
    host.withoutEvents(() => {
      host.files.write(PATH, 'theirs\r\n')
    })
    await settle()
    expect(metaOf(tab)?.conflict).toBeNull() // no event, so nothing is known yet

    expect(await saveDocument(id)).toBe(false)
    expect(host.files.read(PATH)).toBe('theirs\r\n')
    expect(metaOf(tab)).toMatchObject({ conflict: 'save', saveError: null })
  })

  it('keep mine after a refused save goes on to save', async () => {
    const tab = await openPath(PATH)
    const id = documentOfTab(tab)?.id ?? -1
    typeInto(tab, 0, 'mine ')
    host.withoutEvents(() => {
      host.files.write(PATH, 'theirs\r\n')
    })
    await saveDocument(id)
    await resolveConflict(id, 'mine')

    expect(host.files.read(PATH)).toBe('mine one\r\ntwo\r\nthree\r\n')
    expect(metaOf(tab)).toMatchObject({ dirty: false, conflict: null, saveError: null })
  })

  it('load theirs after a refused save shows the file', async () => {
    const tab = await openPath(PATH)
    const id = documentOfTab(tab)?.id ?? -1
    typeInto(tab, 0, 'mine ')
    host.withoutEvents(() => {
      host.files.write(PATH, 'theirs\r\n')
    })
    await saveDocument(id)
    await resolveConflict(id, 'theirs')

    expect(textOf(tab)).toBe('theirs\n')
    expect(host.files.read(PATH)).toBe('theirs\r\n')
  })

  it('is found by opening the file again: a clean tab takes it', async () => {
    const tab = await openPath(PATH)
    host.withoutEvents(() => {
      host.files.write(PATH, 'theirs\r\n')
    })
    expect(await openPath(PATH)).toBe(tab)

    expect(textOf(tab)).toBe('theirs\n')
  })

  it('is found by opening the file again: an edited tab asks', async () => {
    const tab = await openPath(PATH)
    typeInto(tab, 0, 'mine ')
    host.withoutEvents(() => {
      host.files.write(PATH, 'theirs\r\n')
    })
    expect(await openPath(PATH)).toBe(tab)

    expect(textOf(tab)).toBe('mine one\ntwo\nthree\n')
    expect(metaOf(tab)?.conflict).toBe('disk')
  })
})

describe("mdmate's own save", () => {
  it('causes no reload, no conflict, and leaves the editor state alone', async () => {
    const tab = await openPath(PATH)
    const id = documentOfTab(tab)?.id ?? -1
    const reload = vi.spyOn(host, 'reloadDocument')
    typeInto(tab, 0, 'x')
    const master = documentOfTab(tab)?.master

    expect(await saveDocument(id)).toBe(true)
    await settle()
    await settle()

    expect(reload).not.toHaveBeenCalled()
    expect(documentOfTab(tab)?.master).toBe(master)
    expect(metaOf(tab)).toMatchObject({ dirty: false, conflict: null })
    // And it keeps working: edit, save, edit, save.
    typeInto(tab, 0, 'y')
    expect(await saveDocument(id)).toBe(true)
    await settle()
    expect(reload).not.toHaveBeenCalled()
    expect(host.files.read(PATH)).toBe('yxone\r\ntwo\r\nthree\r\n')
  })

  it('does not make a later outside change look like our own', async () => {
    const tab = await openPath(PATH)
    typeInto(tab, 0, 'x')
    await saveDocument(documentOfTab(tab)?.id ?? -1)
    host.files.write(PATH, 'theirs\r\n')
    await settle()

    expect(textOf(tab)).toBe('theirs\n')
  })
})
