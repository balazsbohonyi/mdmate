// @vitest-environment jsdom
/**
 * Pictures are read from disk again (owner UAT): opening a document, opening an image tab and the
 * window getting the focus back each move the number a local picture's address carries, so the
 * webview cannot answer from the copy it keeps in memory. How the address is built and how the
 * pictures on screen are swapped is in tests/editor/images.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openPath, resetDocuments, watchDisk } from '@/documents/store'
import { freshImageSrc, resetImageEpoch } from '@/editor/livePreview/blocks'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'

const LOCAL = 'asset://localhost/%2Fnotes%2Fa.png'

beforeEach(async () => {
  setHost(createMockHost({ files: { 'C:/notes/a.md': 'text\n', 'C:/notes/b.md': 'more\n' } }))
  resetWorkbench()
  resetDocuments()
  resetImageEpoch()
  await watchDisk()
})

afterEach(() => {
  resetWorkbench()
  resetDocuments()
  resetImageEpoch()
  setHost(undefined)
})

describe('when the pictures of a local file are asked for again', () => {
  it('asks under the plain address before anything has opened', () => {
    expect(freshImageSrc(LOCAL)).toBe(LOCAL)
  })

  it('asks under a new address each time a document opens', async () => {
    await openPath('C:/notes/a.md')
    const first = freshImageSrc(LOCAL)
    expect(first).not.toBe(LOCAL)
    await openPath('C:/notes/b.md')
    expect(freshImageSrc(LOCAL)).not.toBe(first)
  })

  it('does not move the number for a document that is already open', async () => {
    await openPath('C:/notes/a.md')
    const before = freshImageSrc(LOCAL)
    await openPath('C:/notes/a.md')
    expect(freshImageSrc(LOCAL)).toBe(before)
  })

  it('asks under a new address when the window gets the focus back', async () => {
    await openPath('C:/notes/a.md')
    const before = freshImageSrc(LOCAL)
    window.dispatchEvent(new Event('focus'))
    expect(freshImageSrc(LOCAL)).not.toBe(before)
  })
})
