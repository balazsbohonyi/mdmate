// @vitest-environment jsdom
/**
 * Open documents when a rename rewrites links (P6-T6): ISC-123 (a document with unsaved edits gets
 * edits it can undo and stays unsaved) and ISC-175 (a clean one shows the new link). The mock host
 * reads plain inline links only; Rust has the full scanner and its own tests.
 */
import { Transaction } from '@codemirror/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { documentOfTab, followerOfTab, openPath, problem, resetDocuments } from '@/documents/store'
import { moveWithLinks, rewriteState } from '@/features/links/rewrite'
import { commitNaming, renameRow } from '@/features/tree/ops'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import { resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function flush(): Promise<void> {
  for (let round = 0; round < 4; round++) await settle()
}

const FILES: Record<string, string> = {
  '/work/old.md': '# old\n',
  '/work/page.md': 'see [the old one](old.md) and [other](other.md)\n',
  '/work/other.md': 'other\n',
}

let host: MockHost
let clock = 1_000_000

async function start(): Promise<void> {
  host = createMockHost({ files: FILES, roots: ['/work'] })
  setHost(host)
  await restoreWorkspace([])
  await flush()
}

beforeEach(() => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  resetSettings()
  problem.value = null
  rewriteState.value = null
})

afterEach(() => {
  setHost(undefined)
  resetTree()
  resetSettings()
})

/** Types at `from` in the tab, as a user would: one history step on its own. */
function type(tab: string, from: number, insert: string): void {
  clock += 10_000
  followerOfTab(tab)?.dispatch({
    changes: { from, insert },
    selection: { anchor: from + insert.length },
    userEvent: 'input.type',
    annotations: Transaction.time.of(clock),
  })
}

const textOf = (tab: string): string => followerOfTab(tab)?.state.doc.toString() ?? ''

describe('a document with unsaved edits (ISC-123)', () => {
  it('gets edits it can undo, stays unsaved, and its file is not touched', async () => {
    await start()
    settings.links.onRename = 'update'
    const tab = await openPath('/work/page.md')
    const doc = documentOfTab(tab)
    if (doc === undefined) throw new Error('not open')
    type(tab, 0, 'typed ')
    expect(doc.dirty).toBe(true)

    const moved = await moveWithLinks('/work/old.md', { kind: 'rename', name: 'new.md' })
    await flush()

    expect(moved?.path).toBe('/work/new.md')
    expect(textOf(tab)).toBe('typed see [the old one](new.md) and [other](other.md)\n')
    expect(doc.dirty).toBe(true)
    // Unsaved means the file on disk is what it was.
    expect(host.files.read('/work/page.md')).toBe(FILES['/work/page.md'])

    // One undo takes the link back and keeps the typing.
    expect(doc.undo(followerOfTab(tab)!)).toBe(true)
    expect(textOf(tab)).toBe('typed see [the old one](old.md) and [other](other.md)\n')
    expect(doc.dirty).toBe(true)
    expect(doc.undo(followerOfTab(tab)!)).toBe(true)
    expect(textOf(tab)).toBe(FILES['/work/page.md'])
    expect(doc.dirty).toBe(false)
  })

  it('is edited from its own text, even where it differs from the disk by more than the link', async () => {
    await start()
    settings.links.onRename = 'update'
    const tab = await openPath('/work/page.md')
    type(tab, 0, 'é😀 ')
    await moveWithLinks('/work/old.md', { kind: 'rename', name: 'new.md' })
    await flush()
    expect(textOf(tab)).toBe('é😀 see [the old one](new.md) and [other](other.md)\n')
  })

  it('is left alone, and listed, when it is edited after the page sent its text', async () => {
    await start()
    settings.links.onRename = 'update'
    const tab = await openPath('/work/page.md')
    const doc = documentOfTab(tab)
    if (doc === undefined) throw new Error('not open')
    type(tab, 0, 'first ')
    const original = host.rewriteMove.bind(host)
    // The user types between the page sending its text and the answer coming back.
    host.rewriteMove = (token, buffers) => {
      type(tab, 0, 'late ')
      return original(token, buffers)
    }
    await moveWithLinks('/work/old.md', { kind: 'rename', name: 'new.md' })
    await flush()
    expect(textOf(tab)).toBe('late first see [the old one](old.md) and [other](other.md)\n')
    const state = rewriteState.value
    expect(state?.phase).toBe('report')
    expect(state?.phase === 'report' ? state.failed.map((item) => item.path) : []).toEqual([
      '/work/page.md',
    ])
  })

  it('still gets its edits when it stops being edited while the links are being looked for', async () => {
    await start()
    settings.links.onRename = 'update'
    const tab = await openPath('/work/page.md')
    const doc = documentOfTab(tab)
    if (doc === undefined) throw new Error('not open')
    type(tab, 0, 'typed ')
    // Edited when the scan started, so the plan counted its link from the text and left its file out.
    const original = host.rewritePlan.bind(host)
    host.rewritePlan = async (...args) => {
      const planned = await original(...args)
      // Undone before the move: the document is clean again, but its file was never planned.
      expect(doc.undo(followerOfTab(tab)!)).toBe(true)
      expect(doc.dirty).toBe(false)
      return planned
    }
    await moveWithLinks('/work/old.md', { kind: 'rename', name: 'new.md' })
    await flush()
    expect(textOf(tab)).toBe('see [the old one](new.md) and [other](other.md)\n')
  })

  it('is not overwritten when it is edited between the scan and the move', async () => {
    await start()
    settings.links.onRename = 'update'
    const tab = await openPath('/work/page.md')
    const doc = documentOfTab(tab)
    if (doc === undefined) throw new Error('not open')
    // Clean when the scan ran: the plan counts its link from the file.
    const original = host.rewritePlan.bind(host)
    host.rewritePlan = async (...args) => {
      const planned = await original(...args)
      type(tab, 0, 'typed meanwhile ')
      return planned
    }
    await moveWithLinks('/work/old.md', { kind: 'rename', name: 'new.md' })
    await flush()
    expect(textOf(tab)).toBe('typed meanwhile see [the old one](new.md) and [other](other.md)\n')
    expect(doc.dirty).toBe(true)
    expect(host.files.read('/work/page.md')).toBe(FILES['/work/page.md'])
  })
})

describe('a clean open document (ISC-175)', () => {
  it('shows the new link in its tab, with nothing left unsaved', async () => {
    await start()
    settings.links.onRename = 'update'
    const tab = await openPath('/work/page.md')
    const doc = documentOfTab(tab)
    if (doc === undefined) throw new Error('not open')
    expect(textOf(tab)).toContain('(old.md)')

    await moveWithLinks('/work/old.md', { kind: 'rename', name: 'new.md' })
    await flush()

    expect(textOf(tab)).toBe('see [the old one](new.md) and [other](other.md)\n')
    expect(doc.dirty).toBe(false)
    expect(host.files.read('/work/page.md')).toBe(
      'see [the old one](new.md) and [other](other.md)\n',
    )
  })

  it('reloads even when the watcher reports nothing', async () => {
    await start()
    settings.links.onRename = 'update'
    const tab = await openPath('/work/page.md')
    const original = host.rewriteMove.bind(host)
    host.rewriteMove = (token, buffers) => {
      let answer: ReturnType<typeof original> | undefined
      host.withoutEvents(() => {
        answer = original(token, buffers)
      })
      return answer ?? original(token, buffers)
    }
    await moveWithLinks('/work/old.md', { kind: 'rename', name: 'new.md' })
    await flush()
    expect(textOf(tab)).toBe('see [the old one](new.md) and [other](other.md)\n')
    expect(documentOfTab(tab)?.dirty).toBe(false)
  })

  it('also follows a document that moves with its folder', async () => {
    await start()
    settings.links.onRename = 'update'
    host.files.write('/work/sub/inner.md', 'up: [p](../page.md)\n')
    const tab = await openPath('/work/sub/inner.md')
    await renameRow('/work/sub')
    await commitNaming('deeper')
    await flush()
    // The folder moved with the file in it: the link still reaches the same place.
    expect(textOf(tab)).toBe('up: [p](../page.md)\n')
    expect(documentOfTab(tab)?.path).toBe('/work/deeper/inner.md')
    expect(host.files.read('/work/deeper/inner.md')).toBe('up: [p](../page.md)\n')
  })
})
