/**
 * What a file opens as (P6-T3): ISC-106 (a text file opens as plain source), ISC-107 (an image
 * opens in an image tab) and the image tab's life: one tab per image per pane, a name that
 * follows a rename, and a host told when the last tab closes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { docMeta } from '@/documents/meta'
import {
  documentOfTab,
  openImage,
  openPath,
  requestCloseTab,
  resetDocuments,
} from '@/documents/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import {
  imageTabs,
  resetWorkbench,
  setImagePath,
  splitActivePane,
  tabInfo,
  tabRecord,
  tabTitle,
  workbenchLayout,
} from '@/workbench/store'
import { findPane } from '@/workbench/splitTree'

let host: MockHost

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  host = createMockHost({
    files: {
      '/w/a.md': '# A\n',
      '/w/b.txt': 'plain *words*\n',
      '/w/c.rs': 'fn main() {}\n',
      '/w/pic.png': 'png bytes',
      '/w/vec.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    },
    images: { '/w/pic.png': { url: 'data:image/png;base64,AA==', bytes: 4321 } },
  })
  setHost(host)
  resetWorkbench()
  resetDocuments()
})

afterEach(() => {
  resetWorkbench()
  resetDocuments()
  setHost(undefined)
  vi.restoreAllMocks()
})

describe('a text file (ISC-106)', () => {
  it('opens as plain source in a text tab, with no Markdown parser', async () => {
    const tab = await openPath('/w/b.txt')
    expect(tabRecord(tab)?.kind).toBe('text')
    const doc = documentOfTab(tab)
    expect(doc?.kind).toBe('text')
    expect(doc?.plainSource).toBe(true)
    expect(docMeta(doc?.id ?? -1)?.kind).toBe('text')
    expect(tabInfo(tab)).toMatchObject({ kind: 'text', title: 'b.txt' })
  })

  it('opens any other extension the same way', async () => {
    const tab = await openPath('/w/c.rs')
    expect(tabRecord(tab)?.kind).toBe('text')
    expect(documentOfTab(tab)?.master.doc.toString()).toBe('fn main() {}\n')
  })

  it('leaves Markdown in the live editor', async () => {
    const tab = await openPath('/w/a.md')
    expect(tabRecord(tab)?.kind).toBe('markdown')
    expect(documentOfTab(tab)?.plainSource).toBe(false)
  })

  it('does not open a second tab for a file that is open', async () => {
    const first = await openPath('/w/b.txt')
    expect(await openPath('/w/b.txt')).toBe(first)
  })
})

describe('an image (ISC-107)', () => {
  it('opens in an image tab with its path and its size on disk, and holds no document', async () => {
    const tab = await openPath('/w/pic.png')
    expect(tabRecord(tab)).toEqual({ kind: 'image', path: '/w/pic.png', size: 4321 })
    expect(documentOfTab(tab)).toBeUndefined()
    expect(host.openDocuments().size).toBe(0)
    expect(tabInfo(tab)).toMatchObject({ kind: 'image', title: 'pic.png', dirty: false })
  })

  it('takes an SVG the same way, and never as text', async () => {
    const tab = await openPath('/w/vec.svg')
    expect(tabRecord(tab)?.kind).toBe('image')
    expect(host.openDocuments().size).toBe(0)
  })

  it('focuses the tab it already has instead of opening a second', async () => {
    const first = await openPath('/w/pic.png')
    await openPath('/w/a.md')
    expect(await openPath('/w/pic.png')).toBe(first)
    expect(imageTabs()).toHaveLength(1)
  })

  it('opens one tab per pane when a pane is named', async () => {
    const first = await openImage('/w/pic.png')
    const firstPane = workbenchLayout.value.activePane
    splitActivePane('row')
    const here = workbenchLayout.value.activePane
    expect(here).not.toBe(firstPane)
    const second = await openImage('/w/pic.png', here)
    expect(second).not.toBe(first)
    expect(findPane(workbenchLayout.value, here)?.tabs).toContain(second)
    expect(findPane(workbenchLayout.value, firstPane)?.tabs).toEqual([first])
    expect(await openImage('/w/pic.png', here)).toBe(second)
  })

  it('refuses what Rust refuses, and opens no tab', async () => {
    await expect(openImage('/w/missing.png')).rejects.toThrow()
    await expect(openImage('/w/b.txt')).rejects.toThrow(/not an image/)
    expect(imageTabs()).toHaveLength(0)
  })

  it('takes the name of its file, which follows a rename', async () => {
    const tab = await openPath('/w/pic.png')
    setImagePath(tab, '/w/renamed.png')
    expect(tabTitle(tab)).toBe('renamed.png')
    expect(tabRecord(tab)).toMatchObject({ path: '/w/renamed.png', size: 4321 })
  })

  it('tells the host when the last tab that shows it closes, and not before', async () => {
    const tell = vi.spyOn(host, 'imageClosed')
    const first = await openImage('/w/pic.png')
    splitActivePane('row')
    const second = await openImage('/w/pic.png', workbenchLayout.value.activePane)
    requestCloseTab(first)
    await settle()
    expect(tell).not.toHaveBeenCalled()
    requestCloseTab(second)
    await settle()
    expect(tell).toHaveBeenCalledExactlyOnceWith('/w/pic.png')
  })

  it('does not ask for a document close when an image tab closes', async () => {
    const close = vi.spyOn(host, 'closeDocument')
    const tab = await openPath('/w/pic.png')
    requestCloseTab(tab)
    await settle()
    expect(close).not.toHaveBeenCalled()
  })
})
