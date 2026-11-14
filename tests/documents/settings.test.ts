/**
 * ISC-330 and ISC-368: where a pasted image goes follows `images.pasteFolder` in settings.json, the
 * next paste after a saved change lands in the new folder with no restart, and a value that is
 * absolute or leaves the document's folder is refused and the last good folder stays. The Rust side
 * (the folder made part by part, the draft Save As, the shared cases) is `pnpm test:rust
 * paste_folder`, `images` and `draft_images`; the mock host stands in for it here with the same
 * rules, so what is checked is what the page asks for and what it does with the answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeAllTabs,
  documentOfTab,
  followerOfTab,
  openPath,
  resetDocuments,
  saveDocument,
} from '@/documents/store'
import { newUntitledTab, resetUntitled } from '@/documents/untitled'
import {
  applySettingsText,
  resetSettingsState,
  settingsFileState,
  settledRuntime,
} from '@/features/settings/store'
import { resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, DRAFT_ROOT, type MockHost } from '@/platform/mock'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const STAMP = '20261113-153000'
const NAME = `image-${STAMP}.png`

let host: MockHost
let picked: string | null

async function useFolder(folder: string): Promise<void> {
  applySettingsText(JSON.stringify({ images: { pasteFolder: folder } }))
  await settledRuntime()
}

async function paste(id: number, stamp = STAMP, last = 0): Promise<{ name: string; link: string }> {
  // Each picture has bytes of its own: the same bytes would be one file.
  const bytes = PNG.slice()
  bytes[bytes.length - 1] = last
  return host.savePastedImage(id, bytes.buffer, stamp)
}

function activeTab(): string {
  const root = workbenchLayout.value.root
  const tab = root.kind === 'pane' ? root.activeTab : null
  if (tab === null) throw new Error('no active tab')
  return tab
}

beforeEach(() => {
  picked = null
  host = createMockHost({ files: { 'C:/notes/a.md': '# A\n' }, pickSave: () => picked })
  setHost(host)
  resetSettings()
  resetSettingsState()
  resetWorkbench()
  resetDocuments()
  resetUntitled()
})

afterEach(async () => {
  await closeAllTabs()
  resetWorkbench()
  resetDocuments()
  setHost(undefined)
})

describe('the paste folder setting (ISC-330)', () => {
  it('puts a paste beside the document in assets until the setting says otherwise', async () => {
    const tab = await openPath('C:/notes/a.md')
    const id = documentOfTab(tab)?.id ?? -1
    const saved = await paste(id)
    expect(saved.link).toBe(`assets/${NAME}`)
    expect(host.files.has(`C:/notes/assets/${NAME}`)).toBe(true)
  })

  it('sends the next paste to the new folder after the file changes, with no restart', async () => {
    const tab = await openPath('C:/notes/a.md')
    const id = documentOfTab(tab)?.id ?? -1
    await useFolder('media/pasted')
    const saved = await paste(id)
    expect(saved.link).toBe(`media/pasted/${NAME}`)
    expect(host.files.has(`C:/notes/media/pasted/${NAME}`)).toBe(true)
    expect(host.files.has(`C:/notes/assets/${NAME}`)).toBe(false)

    // A second change applies to the paste after it, and taking the key out goes back to assets.
    await useFolder('pics')
    expect((await paste(id, '20261113-153001', 1)).link).toBe('pics/image-20261113-153001.png')
    applySettingsText('{}')
    await settledRuntime()
    expect((await paste(id, '20261113-153002', 2)).link).toBe('assets/image-20261113-153002.png')
  })

  it('keeps an untitled document draft in its own assets folder whatever the setting says', async () => {
    await useFolder('media/pasted')
    await newUntitledTab()
    const id = documentOfTab(activeTab())?.id ?? -1
    const saved = await paste(id)
    expect(saved.link).toBe(`assets/${NAME}`)
    expect(host.files.has(`${DRAFT_ROOT}/1/assets/${NAME}`)).toBe(true)
  })

  it('moves a draft image to the setting at Save As and rewrites the links in both texts', async () => {
    await useFolder('media/pasted')
    await newUntitledTab()
    const tab = activeTab()
    const id = documentOfTab(tab)?.id ?? -1
    await paste(id)
    const follower = followerOfTab(tab)
    if (follower === undefined) throw new Error('no editor')
    follower.dispatch({
      changes: { from: 0, insert: `![a](assets/${NAME}) and ![b](./assets/${NAME})\n` },
    })
    picked = 'C:/notes/new.md'
    expect(await saveDocument(id)).toBe(true)

    const expected = `![a](media/pasted/${NAME}) and ![b](./media/pasted/${NAME})\n`
    expect(host.files.read('C:/notes/new.md')).toBe(expected)
    expect(host.files.has(`C:/notes/media/pasted/${NAME}`)).toBe(true)
    expect(host.files.has('C:/notes/assets')).toBe(false)
    // The page's own text follows what was written, so the tab is not left looking edited.
    expect(followerOfTab(tab)?.state.doc.toString()).toBe(expected)
    expect(docDirty(id)).toBe(false)
  })
})

function docDirty(id: number): boolean {
  return documentOfTabId(id)?.dirty ?? false
}

function documentOfTabId(id: number): { dirty: boolean } | undefined {
  const root = workbenchLayout.value.root
  const tab = root.kind === 'pane' ? root.activeTab : null
  const doc = tab === null ? undefined : documentOfTab(tab)
  return doc?.id === id ? { dirty: doc.dirty } : undefined
}

describe('a paste folder that leaves the document or names a path is refused (ISC-368)', () => {
  it('flags the key, keeps the last good folder for the next paste, and tells Rust nothing new', async () => {
    const tab = await openPath('C:/notes/a.md')
    const id = documentOfTab(tab)?.id ?? -1
    await useFolder('media')
    const calls = host.runtime.calls.length
    for (const bad of ['C:/x', '../x', '/x', 'a/../../x', 'a b']) {
      applySettingsText(JSON.stringify({ images: { pasteFolder: bad } }))
      await settledRuntime()
      expect(settings.images.pasteFolder, bad).toBe('media')
      expect(settingsFileState.problems['images.pasteFolder'], bad).toBeDefined()
    }
    expect(host.runtime.calls.length, 'nothing was sent for a refused value').toBe(calls)
    const saved = await paste(id)
    expect(saved.link).toBe(`media/${NAME}`)
    expect(host.files.has(`C:/notes/media/${NAME}`)).toBe(true)
  })

  it('is refused by the host too, as a page that disagrees with Rust gets an error and changes nothing', async () => {
    await useFolder('media')
    for (const bad of ['../x', 'C:/x', '']) {
      await expect(
        host.settingsApply({ ...host.runtime.values, pasteFolder: bad }),
        bad,
      ).rejects.toMatchObject({ kind: 'invalid' })
    }
    expect(host.runtime.values.pasteFolder).toBe('media')
  })
})
