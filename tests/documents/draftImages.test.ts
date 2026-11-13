/**
 * ISC-327, ISC-331 and ISC-332 at the page's end: where an untitled document keeps its images, what
 * its first Save As does with them, and when its draft folder goes. The Rust side (the folders, the
 * copying, the sweep) is `pnpm test:rust draft_images`; here the mock host stands in for it with the
 * same behaviour, so what is checked is what the page asks for and does with the answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { docMeta } from '@/documents/meta'
import {
  closeAllTabs,
  closeTabs,
  documentOfTab,
  followerOfTab,
  requestCloseTab,
  resetDocuments,
  resolvePendingClose,
  saveDocument,
} from '@/documents/store'
import { newUntitledTab, resetUntitled } from '@/documents/untitled'
import { resetTree } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, DRAFT_ROOT, type MockHost } from '@/platform/mock'
import { allTabs } from '@/workbench/splitTree'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const FIRST = 'image-20261113-153000.png'
const SECOND = 'image-20261113-153001.png'
const UNUSED = 'image-20261113-153002.png'

let host: MockHost
let picked: string | null

function activeTab(): string {
  const root = workbenchLayout.value.root
  const tab = root.kind === 'pane' ? root.activeTab : null
  if (tab === null) throw new Error('no active tab')
  return tab
}

function type(tab: string, text: string): void {
  const follower = followerOfTab(tab)
  if (follower === undefined) throw new Error('no document')
  follower.dispatch({ changes: { from: follower.state.doc.length, insert: text } })
}

/** Puts a picture in the draft folder of the untitled document `id`, as a paste does. */
async function paste(id: number, stamp: string): Promise<string> {
  return (await host.savePastedImage(id, PNG.buffer.slice(0), stamp)).name
}

beforeEach(() => {
  picked = null
  host = createMockHost({ files: { 'C:/notes/a.md': '# A\n' }, pickSave: () => picked })
  setHost(host)
  resetWorkbench()
  resetDocuments()
  resetUntitled()
  resetTree()
})

afterEach(() => {
  resetTree()
  resetWorkbench()
  resetDocuments()
  setHost(undefined)
})

describe('where an untitled document keeps its images (ISC-327)', () => {
  it('gives each untitled document a draft folder of its own, keyed by its number', async () => {
    await newUntitledTab()
    const one = documentOfTab(activeTab())
    await newUntitledTab()
    const two = documentOfTab(activeTab())
    if (one === undefined || two === undefined) throw new Error('no documents')
    await paste(one.id, '20261113-153000')
    await paste(two.id, '20261113-153000')
    expect(host.files.has(`${DRAFT_ROOT}/1/assets/${FIRST}`)).toBe(true)
    expect(host.files.has(`${DRAFT_ROOT}/2/assets/${FIRST}`)).toBe(true)
  })

  it('refuses a number another open untitled document has', async () => {
    await host.newUntitled(4)
    await expect(host.newUntitled(4)).rejects.toMatchObject({ kind: 'invalid' })
  })
})

describe('the first Save As of an untitled document with images (ISC-331)', () => {
  async function untitledWithImages(): Promise<{ tab: string; id: number }> {
    await newUntitledTab()
    const tab = activeTab()
    const doc = documentOfTab(tab)
    if (doc === undefined) throw new Error('no document')
    await paste(doc.id, '20261113-153000')
    await paste(doc.id, '20261113-153001')
    await paste(doc.id, '20261113-153002')
    type(tab, `![a](assets/${FIRST})\n<img src="assets/${SECOND}" width="80">\n`)
    return { tab, id: doc.id }
  }

  it('copies the images the text uses beside the file, renames a taken name, and updates both texts', async () => {
    const { tab, id } = await untitledWithImages()
    host.files.write(`C:/notes/assets/${FIRST}`, 'the owner picture')
    picked = 'C:/notes/new.md'
    expect(await saveDocument(id)).toBe(true)

    const renamed = 'image-20261113-153000-2.png'
    expect(host.files.read(`C:/notes/assets/${FIRST}`)).toBe('the owner picture')
    expect(host.files.has(`C:/notes/assets/${renamed}`)).toBe(true)
    expect(host.files.has(`C:/notes/assets/${SECOND}`)).toBe(true)
    // What was not linked stays with the draft, which is removed.
    expect(host.files.has(`C:/notes/assets/${UNUSED}`)).toBe(false)
    expect(host.files.isFolder(`${DRAFT_ROOT}/1`)).toBe(false)

    const written = `![a](assets/${renamed})\n<img src="assets/${SECOND}" width="80">\n`
    expect(host.files.read('C:/notes/new.md')).toBe(written)
    // The document holds the same text, so it is not edited-looking, and an image of the renamed
    // link still resolves to a file that exists.
    const doc = documentOfTab(tab)
    expect(doc?.master.doc.toString()).toBe(written)
    expect(docMeta(id)).toMatchObject({ dirty: false })
    expect(doc?.untitled).toBe(false)
  })

  it('leaves the draft in place when the dialog is cancelled', async () => {
    const { id } = await untitledWithImages()
    picked = null
    expect(await saveDocument(id)).toBe(false)
    expect(host.files.has(`${DRAFT_ROOT}/1/assets/${FIRST}`)).toBe(true)
  })

  it('refuses a file inside the draft folder, which would go with it', async () => {
    const { id } = await untitledWithImages()
    picked = `${DRAFT_ROOT}/1/new.md`
    expect(await saveDocument(id)).toBe(false)
    expect(docMeta(id)?.saveError).toMatch(/folder of your own/)
    expect(host.files.has(`${DRAFT_ROOT}/1/assets/${FIRST}`)).toBe(true)
  })
})

describe('when a draft folder goes (ISC-332)', () => {
  it('stays while the close is undecided, and goes with Discard', async () => {
    await newUntitledTab()
    const tab = activeTab()
    const id = documentOfTab(tab)?.id ?? 0
    await paste(id, '20261113-153000')
    type(tab, `![](assets/${FIRST})`)
    requestCloseTab(tab)
    // Asked, not answered: the tab and its images are still there.
    expect(allTabs(workbenchLayout.value)).toEqual([tab])
    expect(host.files.has(`${DRAFT_ROOT}/1/assets/${FIRST}`)).toBe(true)
    await resolvePendingClose('discard')
    expect(allTabs(workbenchLayout.value)).toEqual([])
    await vi.waitFor(() => expect(host.files.isFolder(`${DRAFT_ROOT}/1`)).toBe(false))
  })

  it('goes at once for a tab with no changes, and not for the other tab', async () => {
    await newUntitledTab()
    const first = activeTab()
    await newUntitledTab()
    const second = activeTab()
    await paste(documentOfTab(first)?.id ?? 0, '20261113-153000')
    await paste(documentOfTab(second)?.id ?? 0, '20261113-153000')
    // An image alone does not make the document "edited": its text is what the baseline is.
    requestCloseTab(first)
    await vi.waitFor(() => expect(host.files.isFolder(`${DRAFT_ROOT}/1`)).toBe(false))
    expect(host.files.isFolder(`${DRAFT_ROOT}/2`)).toBe(true)
  })

  it('stays when the user cancels the question', async () => {
    await newUntitledTab()
    const tab = activeTab()
    const id = documentOfTab(tab)?.id ?? 0
    await paste(id, '20261113-153000')
    type(tab, `![](assets/${FIRST})`)
    requestCloseTab(tab)
    await resolvePendingClose('cancel')
    expect(allTabs(workbenchLayout.value)).toEqual([tab])
    expect(host.files.has(`${DRAFT_ROOT}/1/assets/${FIRST}`)).toBe(true)
  })

  it('goes through Close Others for the tabs it closes, and stays for the one it keeps', async () => {
    await newUntitledTab()
    const first = activeTab()
    await newUntitledTab()
    const kept = activeTab()
    await newUntitledTab()
    const third = activeTab()
    for (const tab of [first, kept, third])
      await paste(documentOfTab(tab)?.id ?? 0, '20261113-153000')
    expect(await closeTabs([first, third])).toBe(true)
    await vi.waitFor(() => {
      expect(host.files.isFolder(`${DRAFT_ROOT}/1`)).toBe(false)
      expect(host.files.isFolder(`${DRAFT_ROOT}/3`)).toBe(false)
    })
    expect(host.files.isFolder(`${DRAFT_ROOT}/2`)).toBe(true)
    expect(allTabs(workbenchLayout.value)).toEqual([kept])
  })

  it('goes through Close All too, for every tab it closes', async () => {
    await newUntitledTab()
    await newUntitledTab()
    const ids = allTabs(workbenchLayout.value).map((tab) => documentOfTab(tab)?.id ?? 0)
    for (const id of ids) await paste(id, '20261113-153000')
    expect(await closeAllTabs()).toBe(true)
    await vi.waitFor(() => {
      expect(host.files.isFolder(`${DRAFT_ROOT}/1`)).toBe(false)
      expect(host.files.isFolder(`${DRAFT_ROOT}/2`)).toBe(false)
    })
  })
})
