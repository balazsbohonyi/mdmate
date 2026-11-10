import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { docMeta } from '@/documents/meta'
import {
  buildSnapshot,
  flushSession,
  journalStats,
  resetSession,
  restoreSession,
  startJournal,
} from '@/documents/session'
import {
  allDocuments,
  documentOfTab,
  followerOfTab,
  openPath,
  problem,
  requestCloseTab,
  resetDocuments,
  resolvePendingClose,
  saveDocument,
} from '@/documents/store'
import { newUntitledTab, resetUntitled } from '@/documents/untitled'
import { endingsOf } from '@/editor/lineEndings'
import { CRLF, LF } from '@/lib/endings'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { joinRaw } from '@/platform/mockFiles'
import { allTabs } from '@/workbench/splitTree'
import {
  moveTabTo,
  resetWorkbench,
  resizeSplit,
  selectTab,
  splitActivePane,
  tabRecord,
  workbenchLayout,
} from '@/workbench/store'

const A = 'C:/notes/a.md'
const B = 'C:/notes/b.md'
const C = 'C:/notes/c.md'
const MIXED = 'C:/notes/mixed.md'

const FILES: Record<string, string> = {
  [A]: '# A\n\nfirst\n',
  [B]: 'one\r\ntwo\r\nthree\r\n',
  [C]: 'see\nsea\n',
  [MIXED]: 'lf\ncrlf\r\ncr\rlast\n',
}

let host: MockHost
let picked: string | null = null

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function typeInto(tab: string, from: number, insert: string): void {
  const follower = followerOfTab(tab)
  if (follower === undefined) throw new Error(`no document in ${tab}`)
  follower.dispatch({ changes: { from, insert } })
}

function textOf(tab: string): string {
  return documentOfTab(tab)?.master.doc.toString() ?? '<no document>'
}

function metaOf(tab: string) {
  return docMeta(documentOfTab(tab)?.id ?? -1)
}

function rawFiles(from: MockHost): Record<string, string> {
  return Object.fromEntries(from.files.paths().map((path) => [path, from.files.read(path) ?? '']))
}

/** A new run of the app: fresh host and page state, same files, and the session the old run left. */
function newRun(old: MockHost): MockHost {
  const next = createMockHost({ files: rawFiles(old), pickSave: () => picked })
  next.session = old.session
  resetSession()
  resetDocuments()
  resetUntitled()
  resetWorkbench()
  setHost(next)
  host = next
  return next
}

beforeEach(() => {
  picked = null
  host = createMockHost({ files: FILES, pickSave: () => picked })
  setHost(host)
  resetWorkbench()
  resetDocuments()
  resetUntitled()
  resetSession()
})

afterEach(() => {
  vi.useRealTimers()
  resetSession()
  resetWorkbench()
  resetDocuments()
  setHost(undefined)
})

describe('a session written and restored', () => {
  it('puts back the same layout: panes, splits, sizes, tabs and the active ones', async () => {
    const a = await openPath(A)
    const b = await openPath(B)
    await openPath(C)
    splitActivePane('row')
    splitActivePane('column')
    const root = workbenchLayout.value.root
    if (root.kind === 'split') resizeSplit(root.id, [0.3, 0.7])
    moveTabTo(a, workbenchLayout.value.activePane)
    selectTab(b)
    const before = workbenchLayout.value
    expect(allTabs(before).length).toBeGreaterThanOrEqual(5)

    await flushSession()
    newRun(host)
    const report = await restoreSession()

    expect(workbenchLayout.value).toEqual(before)
    expect(report).toMatchObject({ tabs: allTabs(before).length, notices: [] })
    for (const id of allTabs(before)) expect(documentOfTab(id)).toBeDefined()
  })

  it('opens a tab after a restore with an id that no restored tab has', async () => {
    await openPath(A)
    await openPath(B)
    await flushSession()
    newRun(host)
    await restoreSession()
    const restored = new Set(allTabs(workbenchLayout.value))
    const fresh = await openPath(C)
    expect(restored.has(fresh)).toBe(false)
  })

  it('puts back where each caret was, including in a tab that was never shown', async () => {
    const a = await openPath(A)
    const b = await openPath(B)
    followerOfTab(a)?.dispatch({ selection: { anchor: 2, head: 6 } })
    followerOfTab(b)?.dispatch({ selection: { anchor: 4 } })
    selectTab(a)
    await flushSession()

    newRun(host)
    await restoreSession()

    expect(documentOfTab(a)?.caretOf(a)).toEqual({ anchor: 2, head: 6 })
    expect(documentOfTab(b)?.caretOf(b)).toEqual({ anchor: 4, head: 4 })
    // And when the follower is made, it starts there.
    expect(followerOfTab(b)?.state.selection.main.head).toBe(4)
  })

  it('clamps a caret that is past the end of a file that got shorter', async () => {
    const a = await openPath(A)
    followerOfTab(a)?.dispatch({ selection: { anchor: 9 } })
    await flushSession()
    host.files.write(A, 'x\n')
    newRun(host)
    await restoreSession()
    expect(documentOfTab(a)?.caretOf(a).head).toBe(2)
  })

  it('has no buffers when nothing is edited', async () => {
    await openPath(A)
    await openPath(B)
    expect(JSON.parse(buildSnapshot())).toMatchObject({ buffers: [] })
  })

  it('does nothing on a first start', async () => {
    expect(await restoreSession()).toBeNull()
    expect(allTabs(workbenchLayout.value)).toEqual([])
  })
})

describe('image and text tabs (P6-T3)', () => {
  it('come back in their panes: an image with a fresh size, a text file as plain source', async () => {
    host.files.write('C:/notes/pic.png', 'png')
    host.files.write('C:/notes/todo.txt', 'buy milk\n')
    const a = await openPath(A)
    const pic = await openPath('C:/notes/pic.png')
    const todo = await openPath('C:/notes/todo.txt')
    splitActivePane('row')
    const before = workbenchLayout.value
    await flushSession()
    newRun(host)
    // The file grew while the app was closed: the restored tab reports what is on disk now.
    host.files.write('C:/notes/pic.png', 'a longer png than before')
    const report = await restoreSession()

    expect(workbenchLayout.value).toEqual(before)
    expect(report).toMatchObject({ tabs: 4, notices: [] }) // the split pane shows the text file too
    expect(tabRecord(a)?.kind).toBe('markdown')
    expect(tabRecord(todo)?.kind).toBe('text')
    expect(documentOfTab(todo)?.plainSource).toBe(true)
    expect(tabRecord(pic)).toEqual({ kind: 'image', path: 'C:/notes/pic.png', size: 24 })
  })

  it('leave a notice, and no tab, for an image that is gone', async () => {
    host.files.write('C:/notes/pic.png', 'png')
    await openPath(A)
    await openPath('C:/notes/pic.png')
    await flushSession()
    const next = newRun(host)
    next.files.remove('C:/notes/pic.png')
    const report = await restoreSession()
    expect(report?.tabs).toBe(1)
    expect(report?.notices).toEqual(['pic.png could not be opened.'])
  })

  it('read a session an earlier run wrote, with no kind on any tab', async () => {
    await openPath(A)
    await flushSession()
    const written = JSON.parse(host.session ?? '{}') as { tabs: Record<string, unknown>[] }
    for (const tab of written.tabs) expect(tab.kind).toBeUndefined()
    newRun(host)
    const report = await restoreSession()
    expect(report).toMatchObject({ tabs: 1, notices: [] })
  })
})

describe('unsaved edits', () => {
  it('come back as edits, with the text and every line ending intact', async () => {
    const mixed = await openPath(MIXED)
    const b = await openPath(B)
    typeInto(mixed, 3, 'MIDDLE ')
    typeInto(b, 0, 'NEW ')
    const expected = {
      mixed: joinRaw(textOf(mixed), endingsOf(documentOfTab(mixed)!.master)),
      b: joinRaw(textOf(b), endingsOf(documentOfTab(b)!.master)),
    }
    await flushSession()

    newRun(host)
    await restoreSession()

    expect(metaOf(mixed)).toMatchObject({ dirty: true, conflict: null })
    expect(metaOf(b)).toMatchObject({ dirty: true, conflict: null })
    expect(host.files.read(MIXED)).toBe(FILES[MIXED]) // nothing was saved
    // Saving puts exactly the typed text, with each break's own ending, on disk.
    expect(await saveDocument(documentOfTab(mixed)?.id ?? -1)).toBe(true)
    expect(await saveDocument(documentOfTab(b)?.id ?? -1)).toBe(true)
    expect(host.files.read(MIXED)).toBe(expected.mixed)
    expect(host.files.read(B)).toBe(expected.b)
    expect(expected.b).toBe('NEW one\r\ntwo\r\nthree\r\n')
    expect(expected.mixed).toBe('lf\nMIDDLE crlf\r\ncr\rlast\n')
  })

  it('can be undone to nothing by the user typing them away, which makes the tab clean', async () => {
    const a = await openPath(A)
    typeInto(a, 0, 'x')
    await flushSession()
    newRun(host)
    await restoreSession()
    expect(metaOf(a)?.dirty).toBe(true)
    followerOfTab(a)?.dispatch({ changes: { from: 0, to: 1 } })
    expect(metaOf(a)?.dirty).toBe(false)
  })

  it('are not marked edited when they equal what is on disk', async () => {
    const a = await openPath(A)
    typeInto(a, 0, 'x')
    await flushSession()
    host.files.write(A, 'x# A\n\nfirst\n') // someone saved the same text meanwhile
    newRun(host)
    await restoreSession()
    expect(metaOf(a)).toMatchObject({ dirty: false, conflict: null })
  })

  it('ask the user which version to keep when the file changed since they were typed', async () => {
    const a = await openPath(A)
    typeInto(a, 0, 'mine ')
    await flushSession()
    host.files.write(A, 'theirs\n')
    newRun(host)
    await restoreSession()

    expect(textOf(a)).toBe('mine # A\n\nfirst\n')
    expect(metaOf(a)).toMatchObject({ dirty: true, conflict: 'disk' })
  })

  it('go to a file of their own when the file is gone, and the tab is dropped', async () => {
    const a = await openPath(A)
    const b = await openPath(B)
    typeInto(b, 0, 'unsaved ')
    await flushSession()
    host.files.delete(B)

    newRun(host)
    const report = await restoreSession()

    expect(host.recovered).toEqual([{ name: 'b.md', text: 'unsaved one\r\ntwo\r\nthree\r\n' }])
    expect(report?.notices).toHaveLength(2) // the tab, and the text that was kept
    expect(report?.notices.join(' ')).toContain('b.md')
    expect(allTabs(workbenchLayout.value)).toEqual([a])
    // The snapshot is rewritten without it, so the next start does not recover it again.
    expect(JSON.parse(host.session ?? '{}')).toMatchObject({ buffers: [] })
  })

  it('go to a file of their own when their line endings are damaged', async () => {
    const b = await openPath(B)
    typeInto(b, 0, 'unsaved ')
    await flushSession()
    const damaged = JSON.parse(host.session ?? '{}') as { buffers: { endings: unknown }[] }
    damaged.buffers[0]!.endings = { dominant: 1, at: [99], codes: [0] } // a break that is not there
    host.session = JSON.stringify(damaged)

    newRun(host)
    await restoreSession()

    expect(host.recovered.map((r) => r.name)).toEqual(['b.md'])
    expect(host.recovered[0]?.text).toContain('unsaved one')
    expect(metaOf(b)?.dirty ?? false).toBe(false)
  })

  it('are only restored once per document, whatever the file says', async () => {
    const a = await openPath(A)
    typeInto(a, 0, '1')
    await flushSession()
    const doubled = JSON.parse(host.session ?? '{}') as { buffers: unknown[] }
    doubled.buffers.push(doubled.buffers[0])
    host.session = JSON.stringify(doubled)

    newRun(host)
    await restoreSession()

    expect(textOf(a)).toBe('1# A\n\nfirst\n')
    expect(host.recovered).toHaveLength(1)
  })
})

describe('a session that cannot be read', () => {
  it('is kept in a file of its own and the app starts empty', async () => {
    host.session = '{"this is": not json'
    const report = await restoreSession()
    expect(report?.tabs).toBe(0)
    expect(host.recovered).toEqual([{ name: 'session', text: '{"this is": not json' }])
  })

  it('keeps the tabs when only the layout is damaged', async () => {
    await openPath(A)
    await openPath(B)
    await flushSession()
    const broken = JSON.parse(host.session ?? '{}') as { layout: string }
    broken.layout = '{"root": 5}'
    host.session = JSON.stringify(broken)

    newRun(host)
    const report = await restoreSession()

    expect(report?.tabs).toBe(2)
    expect(allTabs(workbenchLayout.value)).toHaveLength(2)
    expect(report?.notices.join(' ')).toContain('layout')
  })

  it('skips a tab whose file cannot be opened and keeps the rest of the layout', async () => {
    const a = await openPath(A)
    await openPath(B)
    splitActivePane('row')
    await flushSession()
    host.files.delete(B)

    newRun(host)
    const report = await restoreSession()

    expect(report?.notices.join(' ')).toContain('b.md')
    expect(allTabs(workbenchLayout.value).every((id) => documentOfTab(id) !== undefined)).toBe(true)
    expect(allTabs(workbenchLayout.value)).toContain(a)
  })

  it('does not trust a caret that is not a number', async () => {
    const a = await openPath(A)
    await flushSession()
    const snapshot = JSON.parse(host.session ?? '{}') as { tabs: { caret: unknown }[] }
    snapshot.tabs[0]!.caret = { anchor: 'x', head: null }
    host.session = JSON.stringify(snapshot)
    newRun(host)
    await restoreSession()
    expect(documentOfTab(a)?.caretOf(a)).toEqual({ anchor: 0, head: 0 })
  })
})

describe('the journal', () => {
  it('writes a changed session once per interval, however much happens in it', async () => {
    vi.useFakeTimers()
    await startJournal({ intervalMs: 1000 })
    const a = await openPath(A)
    await vi.advanceTimersByTimeAsync(999)
    expect(journalStats.writes).toBe(0)

    for (let i = 0; i < 20; i++) typeInto(a, 0, 'k')
    await vi.advanceTimersByTimeAsync(2)
    expect(journalStats.writes).toBe(1)
    expect(JSON.parse(host.session ?? '{}')).toMatchObject({ buffers: [{ path: A }] })

    // Typing that goes on keeps getting written, once per interval and not once per key.
    for (let second = 0; second < 3; second++) {
      for (let i = 0; i < 20; i++) typeInto(a, 0, 'k')
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(journalStats.writes).toBe(4)
  })

  it('writes nothing while nothing changes', async () => {
    vi.useFakeTimers()
    await startJournal({ intervalMs: 1000 })
    await openPath(A)
    await vi.advanceTimersByTimeAsync(1100)
    const writes = journalStats.writes
    await vi.advanceTimersByTimeAsync(10_000)
    expect(journalStats.writes).toBe(writes)
  })

  it('does not write the same snapshot twice', async () => {
    const a = await openPath(A)
    typeInto(a, 0, 'x')
    await flushSession()
    await flushSession()
    expect(journalStats.writes).toBe(1)
    expect(journalStats.skipped).toBe(1)
  })

  it('runs one write at a time, so the newest snapshot is the one left on disk', async () => {
    const a = await openPath(A)
    const written: string[] = []
    let running = 0
    let mostAtOnce = 0
    host.writeSession = async (json) => {
      running++
      mostAtOnce = Math.max(mostAtOnce, running)
      // The first write is slow and later ones fast: unordered writes would land newest first.
      await new Promise((resolve) => setTimeout(resolve, written.length === 0 ? 30 : 1))
      written.push(json)
      host.session = json
      running--
    }

    typeInto(a, 0, '1')
    const first = flushSession()
    typeInto(a, 0, '2')
    const second = flushSession()
    typeInto(a, 0, '3')
    const third = flushSession()
    await Promise.all([first, second, third])

    expect(mostAtOnce).toBe(1)
    const last = JSON.parse(host.session ?? '{}') as { buffers: { text: string }[] }
    expect(last.buffers[0]?.text).toBe('321# A\n\nfirst\n')
    expect(written.length).toBeLessThanOrEqual(2) // the in-between states are folded into one write
  })

  it('survives a write that fails, and tries again', async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await startJournal({ intervalMs: 1000 })
    const a = await openPath(A)
    const original = host.writeSession.bind(host)
    let fail = true
    host.writeSession = async (json) => {
      if (fail) throw new Error('disk full')
      await original(json)
    }
    typeInto(a, 0, 'x')
    await vi.advanceTimersByTimeAsync(1100)
    expect(journalStats).toMatchObject({ errors: 1, lastError: 'disk full', writes: 0 })

    fail = false
    await vi.advanceTimersByTimeAsync(1100)
    expect(journalStats).toMatchObject({ writes: 1, lastError: null })
    consoleError.mockRestore()
  })
})

describe('closing the app', () => {
  it('writes the newest state and then ends, with no question asked', async () => {
    vi.useFakeTimers()
    await startJournal({ intervalMs: 60_000 })
    const a = await openPath(A)
    typeInto(a, 0, 'typed a moment ago')
    // The interval has not passed: only the close puts this on disk.
    expect(host.session).toBeNull()

    expect(host.requestClose()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(host.quits).toBe(1)
    expect(JSON.parse(host.session ?? '{}')).toMatchObject({
      buffers: [{ path: A, text: 'typed a moment ago# A\n\nfirst\n' }],
    })
    expect(problem.value).toBeNull()
  })

  it('ends even when the write fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await startJournal({ intervalMs: 60_000 })
    const a = await openPath(A)
    typeInto(a, 0, 'x')
    host.writeSession = () => Promise.reject(new Error('disk full'))
    host.requestClose()
    await settle()
    await settle()
    expect(host.quits).toBe(1)
    consoleError.mockRestore()
  })

  it('waits for a write already under way, then writes the newest state', async () => {
    await startJournal({ intervalMs: 60_000 })
    const a = await openPath(A)
    typeInto(a, 0, '1')
    let release: () => void = () => undefined
    const original = host.writeSession.bind(host)
    let calls = 0
    host.writeSession = async (json) => {
      calls++
      if (calls === 1) await new Promise<void>((resolve) => (release = resolve))
      await original(json)
    }
    const slow = flushSession() // under way, holding an older state
    await settle()
    typeInto(a, 0, '2')
    host.requestClose()
    await settle()
    expect(host.quits).toBe(0) // still waiting for the slow write

    release()
    await slow
    await settle()
    expect(host.quits).toBe(1)
    const last = JSON.parse(host.session ?? '{}') as { buffers: { text: string }[] }
    expect(last.buffers[0]?.text).toBe('21# A\n\nfirst\n')
  })

  it('leaves a session that the next start restores', async () => {
    await startJournal({ intervalMs: 60_000 })
    const b = await openPath(B)
    typeInto(b, 0, 'before closing ')
    host.requestClose()
    await settle()
    await settle()

    newRun(host)
    await restoreSession()
    expect(textOf(b)).toBe('before closing one\ntwo\nthree\n')
    expect(endingsOf(documentOfTab(b)!.master).dominant).toBe(CRLF)
    expect(endingsOf(documentOfTab(b)!.master).dominant).not.toBe(LF)
  })
})

describe('untitled tabs (P6-T8)', () => {
  async function untitledTab(text: string): Promise<string> {
    await newUntitledTab()
    const layout = workbenchLayout.value
    const tab = allTabs(layout).find(
      (id) => documentOfTab(id)?.untitled === true && textOf(id) === '',
    )
    if (tab === undefined) throw new Error('no fresh untitled tab')
    if (text !== '') typeInto(tab, 0, text)
    return tab
  }

  it('keeps the text of an unsaved untitled tab across a restart, still unsaved', async () => {
    const tab = await untitledTab('# Draft\n\nnot saved yet\n')
    await flushSession()
    const snapshot = JSON.parse(host.session ?? '{}') as {
      tabs: { path: string; kind?: string; untitled?: number }[]
      buffers: { path: string; untitled?: number; text: string }[]
    }
    expect(snapshot.tabs[0]).toMatchObject({ path: '', kind: 'untitled', untitled: 1 })
    expect(snapshot.buffers[0]).toMatchObject({
      path: '',
      untitled: 1,
      text: '# Draft\n\nnot saved yet\n',
    })

    newRun(host)
    const report = await restoreSession()
    expect(report).toMatchObject({ tabs: 1, buffers: 1, notices: [] })
    expect(allTabs(workbenchLayout.value)).toEqual([tab])
    expect(textOf(tab)).toBe('# Draft\n\nnot saved yet\n')
    expect(metaOf(tab)).toMatchObject({ name: 'Untitled-1', untitled: true, dirty: true, path: '' })
    // And it can still be saved: Rust has a document id for it again.
    picked = 'C:/notes/draft.md'
    expect(await saveDocument(documentOfTab(tab)!.id)).toBe(true)
    expect(host.files.read(picked)).toBe('# Draft\n\nnot saved yet\n')
  })

  it('brings back an empty untitled tab as an empty, clean one', async () => {
    const tab = await untitledTab('')
    await flushSession()
    newRun(host)
    await restoreSession()
    expect(textOf(tab)).toBe('')
    expect(metaOf(tab)).toMatchObject({ name: 'Untitled-1', dirty: false })
  })

  it('keeps each tab’s number, and the next new tab goes past the highest', async () => {
    await untitledTab('one')
    const second = await untitledTab('two')
    const third = await untitledTab('three')
    requestCloseTab(second)
    await resolvePendingClose('discard')
    await flushSession()

    newRun(host)
    await restoreSession()
    const names = allTabs(workbenchLayout.value).map((id) => metaOf(id)?.name)
    expect(names).toEqual(['Untitled-1', 'Untitled-3'])
    expect(textOf(third)).toBe('three')
    await newUntitledTab()
    const latest = allTabs(workbenchLayout.value).at(-1)!
    expect(metaOf(latest)?.name).toBe('Untitled-4')
  })

  it('puts the tab back next to the files it was between, in the same panes', async () => {
    const a = await openPath(A)
    splitActivePane('row')
    const u = await untitledTab('draft')
    selectTab(a)
    const before = workbenchLayout.value
    await flushSession()
    newRun(host)
    await restoreSession()
    expect(workbenchLayout.value).toEqual(before)
    expect(textOf(u)).toBe('draft')
  })

  it('writes no untitled entry once the tab has been saved: it is a file by then', async () => {
    const tab = await untitledTab('saved soon')
    picked = 'C:/notes/soon.md'
    await saveDocument(documentOfTab(tab)!.id)
    const snapshot = JSON.parse(buildSnapshot()) as {
      tabs: { path: string; kind?: string }[]
      buffers: unknown[]
    }
    expect(snapshot.tabs).toEqual([expect.objectContaining({ path: picked })])
    expect(snapshot.tabs[0]?.kind).toBeUndefined()
    expect(snapshot.buffers).toEqual([])
  })

  it('keeps its text in a file, and says so, when the tab cannot come back', async () => {
    await untitledTab('rescue me')
    await flushSession()
    // A snapshot whose layout lost the untitled tab but still holds its text.
    const written = JSON.parse(host.session ?? '{}') as { tabs: unknown[] }
    written.tabs = []
    newRun(host)
    host.session = JSON.stringify(written)
    const report = await restoreSession()
    expect(allTabs(workbenchLayout.value)).toEqual([])
    expect(host.recovered).toEqual([{ name: 'Untitled-1', text: 'rescue me' }])
    expect(report?.notices.join(' ')).toMatch(/Untitled-1 had no tab to come back to/)
    expect(allDocuments()).toEqual([]) // and no document is left behind without a tab
    expect(host.openDocuments().size).toBe(0)
  })

  it('ignores an entry whose number is not a whole number from 1', async () => {
    await untitledTab('text')
    await flushSession()
    const written = JSON.parse(host.session ?? '{}') as {
      tabs: { untitled: unknown }[]
      buffers: { untitled: unknown }[]
    }
    written.tabs[0]!.untitled = 0
    written.buffers = []
    newRun(host)
    host.session = JSON.stringify(written)
    await restoreSession()
    expect(allTabs(workbenchLayout.value)).toEqual([])
    expect(allDocuments()).toEqual([])
  })

  it('keeps the text in a file when its saved line endings are damaged', async () => {
    await untitledTab('keep this')
    await flushSession()
    const written = JSON.parse(host.session ?? '{}') as { buffers: { endings: unknown }[] }
    written.buffers[0]!.endings = { dominant: 9, at: [], codes: [] }
    newRun(host)
    host.session = JSON.stringify(written)
    const report = await restoreSession()
    expect(host.recovered).toEqual([{ name: 'Untitled-1', text: 'keep this' }])
    expect(report?.notices.join(' ')).toMatch(/line endings of Untitled-1 are damaged/)
    expect(allTabs(workbenchLayout.value)).toHaveLength(1) // the tab still comes back, empty
  })

  it('survives a forced restart: the journal alone wrote it, with no close request', async () => {
    await startJournal({ intervalMs: 5 })
    await untitledTab('typed just now')
    await new Promise<void>((resolve) => setTimeout(resolve, 60)) // the journal's own timer
    expect(journalStats.writes).toBeGreaterThan(0)
    newRun(host) // the process was killed: nothing but the written session is left
    await restoreSession()
    const [tab] = allTabs(workbenchLayout.value)
    expect(textOf(tab!)).toBe('typed just now')
  })
})
