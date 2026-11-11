import { describe, expect, it } from 'vitest'
import { Document } from '@/documents/document'
import { documentOfTab, openPath, resetDocuments } from '@/documents/store'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import { setHost } from '@/platform'
import { resetWorkbench } from '@/workbench/store'
import { imageContext } from '@/editor/livePreview/blocks'
import { uniformEndings } from '@/lib/endings'
import type { OpenedFile } from '@/platform'
import { createMockHost } from '@/platform/mock'

function open(
  path: string,
  assetUrl?: (path: string) => string,
  imageBoundary?: (path: string) => string | null,
): Document {
  const text = '![a](img/a.png)\n'
  const opened: OpenedFile = {
    id: 1,
    path,
    name: path.split(/[\\/]/).pop() ?? path,
    encoding: 'utf-8',
    bom: false,
    readOnly: null,
    size: text.length,
    hash: '0'.repeat(32),
    kind: 'markdown',
    text,
    endings: uniformEndings(),
  }
  return new Document(opened, () => undefined, {
    ...(assetUrl === undefined ? {} : { assetUrl }),
    ...(imageBoundary === undefined ? {} : { imageBoundary }),
  })
}

describe('the image context of a document (ISC-66)', () => {
  it('is the folder of the file and the host`s address for a path', () => {
    const doc = open('D:\\notes\\docs\\a.md', (path) => `asset:${path}`)
    const context = doc.followerFor('t').state.facet(imageContext)
    expect(context?.folder()).toBe('D:\\notes\\docs')
    expect(context?.url('D:\\notes\\docs\\img\\a.png')).toBe('asset:D:\\notes\\docs\\img\\a.png')
  })

  it('follows a path that changes', () => {
    const doc = open('/notes/a.md', (path) => path)
    const context = doc.followerFor('t').state.facet(imageContext)
    doc.path = '/other/place/a.md'
    expect(context?.folder()).toBe('/other/place')
  })

  it('has none without a host address, and none for a file at the very root', () => {
    expect(open('/notes/a.md').followerFor('t').state.facet(imageContext)).toBeNull()
    const root = open('/a.md', (path) => path)
      .followerFor('t')
      .state.facet(imageContext)
    expect(root?.folder()).toBeNull()
  })
})

describe('the mock host`s asset addresses', () => {
  const host = createMockHost({
    files: { '/notes/pic.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"/>' },
  })

  it('serves an svg it holds as a data address', () => {
    const url = host.assetUrl('/notes/pic.svg')
    expect(url.startsWith('data:image/svg+xml')).toBe(true)
    expect(decodeURIComponent(url)).toContain('<svg')
  })

  it('gives a missing file, or one that is not an svg, an address that cannot load', () => {
    expect(host.assetUrl('/notes/none.svg').startsWith('mock-asset-missing:')).toBe(true)
    expect(host.assetUrl('/notes/pic.png').startsWith('mock-asset-missing:')).toBe(true)
  })
})

describe('how far up an image may climb (ISC-232)', () => {
  it('is the workspace folder that holds the file, read when the images are scanned', () => {
    let root: string | null = '/work'
    const doc = open(
      '/work/notes/a.md',
      (path) => path,
      () => root,
    )
    const context = doc.followerFor('t').state.facet(imageContext)
    expect(context?.boundary()).toBe('/work')
    root = null
    expect(context?.boundary()).toBeNull()
  })

  it('is none when the host gives no way to ask, so a file in no folder cannot climb', () => {
    const doc = open('/work/notes/a.md', (path) => path)
    expect(doc.followerFor('t').state.facet(imageContext)?.boundary()).toBeNull()
  })

  it('comes from the open workspace folders for a real opened document', async () => {
    resetTree()
    resetDocuments()
    resetWorkbench()
    const host = createMockHost({
      files: { '/work/notes/b.md': '![pic](../img/p.png)\n', '/elsewhere/c.md': 'x\n' },
      roots: ['/work'],
    })
    setHost(host)
    await restoreWorkspace([])
    const inside = documentOfTab(await openPath('/work/notes/b.md'))
    const outside = documentOfTab(await openPath('/elsewhere/c.md'))
    expect(inside?.followerFor('t').state.facet(imageContext)?.boundary()).toBe('/work')
    expect(outside?.followerFor('t').state.facet(imageContext)?.boundary()).toBeNull()
    setHost(undefined)
    resetTree()
    resetDocuments()
  })
})
