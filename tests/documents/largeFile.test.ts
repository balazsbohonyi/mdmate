import { language } from '@codemirror/language'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Document } from '@/documents/document'
import { LARGE_FILE_BYTES, LARGE_FILE_NOTICE, isLargeFile } from '@/documents/largeFile'
import { docMeta } from '@/documents/meta'
import { flushSession, resetSession, restoreSession } from '@/documents/session'
import {
  documentOfTab,
  followerOfTab,
  openPath,
  resetDocuments,
  saveDocument,
} from '@/documents/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { allTabs } from '@/workbench/splitTree'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'

const MIB = 1024 * 1024

/** ASCII Markdown of exactly `bytes` bytes, lines ended with `ending`. */
function markdownOfSize(bytes: number, ending = '\n'): string {
  const line = `# A heading with some words in it, and a [link](https://example.com)${ending}`
  const whole = Math.floor(bytes / line.length)
  const text = line.repeat(whole) + 'x'.repeat(bytes - whole * line.length)
  if (text.length !== bytes) throw new Error('the fixture has the wrong size')
  return text
}

let host: MockHost

function useFiles(files: Record<string, string>): void {
  host = createMockHost({ files })
  setHost(host)
}

/** True when the tab's editor state has the Markdown parser. */
function hasParser(tab: string): boolean {
  const follower = followerOfTab(tab)
  if (follower === undefined) throw new Error(`no editor for ${tab}`)
  return follower.state.facet(language) !== null
}

beforeEach(() => {
  resetWorkbench()
  resetDocuments()
  resetSession()
})

afterEach(() => {
  resetSession()
  resetWorkbench()
  resetDocuments()
  setHost(undefined)
})

describe('the size cutoff', () => {
  it('is 3 MiB, and a file of exactly that size is not above it', () => {
    expect(LARGE_FILE_BYTES).toBe(3 * MIB)
    expect(isLargeFile(3 * MIB)).toBe(false)
    expect(isLargeFile(3 * MIB + 1)).toBe(true)
    expect(isLargeFile(0)).toBe(false)
  })

  it('opens a 1 MB file with the Markdown parser and no notice', async () => {
    useFiles({ '/f/one.md': markdownOfSize(MIB) })
    const tab = await openPath('/f/one.md')
    expect(hasParser(tab)).toBe(true)
    expect(docMeta(documentOfTab(tab)?.id ?? -1)?.plainSource).toBe(false)
  })

  it('opens a file of exactly 3 MiB with the parser', async () => {
    useFiles({ '/f/edge.md': markdownOfSize(3 * MIB) })
    const tab = await openPath('/f/edge.md')
    expect(hasParser(tab)).toBe(true)
    expect(docMeta(documentOfTab(tab)?.id ?? -1)?.plainSource).toBe(false)
  })

  it('opens a file one byte above 3 MiB as plain source with a notice', async () => {
    useFiles({ '/f/over.md': markdownOfSize(3 * MIB + 1) })
    const tab = await openPath('/f/over.md')
    expect(hasParser(tab)).toBe(false)
    expect(docMeta(documentOfTab(tab)?.id ?? -1)?.plainSource).toBe(true)
    expect(LARGE_FILE_NOTICE).toContain('3 MB')
  })

  it('opens a 5 MB file as plain source with every character of it', async () => {
    const raw = markdownOfSize(5 * MIB)
    useFiles({ '/f/five.md': raw })
    const tab = await openPath('/f/five.md')
    expect(hasParser(tab)).toBe(false)
    expect(documentOfTab(tab)?.master.doc.toString()).toBe(raw)
  })

  it('counts the bytes on disk, not the characters: multi-byte text is larger than it looks', async () => {
    // 1.1 million three-byte characters are 3.3 MB on disk but only 1.1 million characters.
    useFiles({ '/f/wide.md': '€'.repeat(1_100_000) })
    const tab = await openPath('/f/wide.md')
    expect(hasParser(tab)).toBe(false)
  })

  it('still edits and saves a large file byte for byte, line endings included', async () => {
    const raw = markdownOfSize(4 * MIB, '\r\n')
    useFiles({ '/f/big.md': raw })
    const tab = await openPath('/f/big.md')
    followerOfTab(tab)?.dispatch({ changes: { from: 0, insert: 'TYPED ' } })
    expect(docMeta(documentOfTab(tab)?.id ?? -1)?.dirty).toBe(true)
    expect(await saveDocument(documentOfTab(tab)?.id ?? -1)).toBe(true)
    expect(host.files.read('/f/big.md')).toBe('TYPED ' + raw)
  })

  it('keeps a large file plain when its unsaved edits are restored after a restart', async () => {
    const raw = markdownOfSize(4 * MIB)
    useFiles({ '/f/big.md': raw })
    const tab = await openPath('/f/big.md')
    followerOfTab(tab)?.dispatch({ changes: { from: 0, insert: 'KEPT ' } })
    await flushSession()

    const next = createMockHost({ files: { '/f/big.md': raw } })
    next.session = host.session
    resetSession()
    resetDocuments()
    resetWorkbench()
    setHost(next)
    await restoreSession()

    const [restored] = allTabs(workbenchLayout.value)
    if (restored === undefined) throw new Error('nothing was restored')
    expect(hasParser(restored)).toBe(false)
    expect(documentOfTab(restored)?.master.doc.toString().startsWith('KEPT # A heading')).toBe(true)
    expect(docMeta(documentOfTab(restored)?.id ?? -1)).toMatchObject({
      plainSource: true,
      dirty: true,
    })
  })
})

describe('an explicit choice beats the size', () => {
  it('lets a small file be opened as plain source', async () => {
    useFiles({ '/f/small.md': '# small\n' })
    const opened = await host.openFile('/f/small.md')
    const doc = new Document(opened, () => undefined, { parser: false })
    expect(doc.plainSource).toBe(true)
    expect(doc.followerFor('t').state.facet(language)).toBeNull()
  })

  it('lets a large file be opened with the parser', async () => {
    useFiles({ '/f/large.md': markdownOfSize(4 * MIB) })
    const opened = await host.openFile('/f/large.md')
    const doc = new Document(opened, () => undefined, { parser: true })
    expect(doc.plainSource).toBe(false)
    expect(doc.followerFor('t').state.facet(language)).not.toBeNull()
  })
})
