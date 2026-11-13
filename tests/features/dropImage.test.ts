// @vitest-environment jsdom
/**
 * Dropping a picture onto document text (P9-T2): the link lands at the drop point (ISC-156), a file
 * inside the document's workspace folder is linked where it lies and one outside is copied into
 * `assets` (ISC-328), and a picture dropped anywhere else still opens an image tab (ISC-201). Rust's
 * half is `pnpm test:rust drop_image`; here a native drop is simulated by the mock host, which
 * records the paths as Rust's drop record does and decides in-place or copy by the same rule.
 */
import { undo } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { documentOfTab, followerOfTab, openPath, problem, resetDocuments } from '@/documents/store'
import { newUntitledTab, resetUntitled } from '@/documents/untitled'
import { createState, createView } from '@/editor/create'
import { imageSink, insertDropped, type ImageSink } from '@/editor/imagePaste'
import { resolveImageAddress } from '@/editor/livePreview/blocks'
import { installFileDrop } from '@/features/drop'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { imageTabs, resetWorkbench, workbenchLayout } from '@/workbench/store'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) await settle()
}

beforeAll(() => {
  // jsdom has no layout; CodeMirror only needs these to exist.
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const views: EditorView[] = []
function mount(state: EditorState): EditorView {
  const view = createView(document.body.appendChild(document.createElement('div')), state)
  views.push(view)
  return view
}
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

describe('the links a drop inserts, in a view (ISC-156)', () => {
  function sink(overrides: Partial<ImageSink> = {}): ImageSink & { notes: string[] } {
    const notes: string[] = []
    return {
      refusal: () => null,
      save: () => Promise.reject(new Error('not a paste')),
      drop: (path) => Promise.resolve(`pics/${path.split('/').pop() ?? ''}`),
      notify: (message) => notes.push(message),
      notes,
      ...overrides,
    }
  }

  function viewOf(doc: string, caret: number, taking: ImageSink): EditorView {
    return mount(
      createState(doc, [imageSink.of(taking)]).update({
        selection: EditorSelection.single(caret),
      }).state,
    )
  }

  it('goes in at the drop point, not at the caret, and leaves the caret after it', async () => {
    const view = viewOf('one two three', 0, sink())
    expect(await insertDropped(view, ['/in/a.png'], 4)).toBe(true)
    expect(view.state.doc.toString()).toBe('one ![](pics/a.png)two three')
    expect(view.state.selection.main.head).toBe('one ![](pics/a.png)'.length)
  })

  it('writes one link per picture, one under another, as a single undo step', async () => {
    const view = viewOf('x', 0, sink())
    await insertDropped(view, ['/in/a.png', '/in/b.png'], 1)
    expect(view.state.doc.toString()).toBe('x![](pics/a.png)\n![](pics/b.png)')
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('x')
  })

  it('writes the link a name with spaces and parentheses needs to read back', async () => {
    const view = viewOf('', 0, sink({ drop: () => Promise.resolve('my pics/a (1).png') }))
    await insertDropped(view, ['/in/a.png'], 0)
    expect(view.state.doc.toString()).toBe('![](<my pics/a (1).png>)')
    expect(resolveImageAddress('<my pics/a (1).png>', '/doc', null)).toEqual({
      kind: 'local',
      path: '/doc/my pics/a (1).png',
    })
  })

  it('says why and inserts nothing for a picture that failed, and keeps the others', async () => {
    const taking = sink({
      drop: (path) =>
        path.endsWith('bad.png')
          ? // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Tauri rejects with a plain { kind, message } object, not an Error
            Promise.reject({ kind: 'invalid', message: 'not an image' })
          : Promise.resolve('ok.png'),
    })
    const view = viewOf('x', 0, taking)
    await insertDropped(view, ['/in/bad.png', '/in/good.png'], 1)
    expect(taking.notes).toEqual(['Could not add the image: not an image'])
    expect(view.state.doc.toString()).toBe('x![](ok.png)')
  })

  it('says so and inserts nothing when the document refuses, and the drop is still handled', async () => {
    const taking = sink({ refusal: () => 'no folder' })
    const view = viewOf('x', 0, taking)
    expect(await insertDropped(view, ['/in/a.png'], 1)).toBe(true)
    expect(taking.notes).toEqual(['no folder'])
    expect(view.state.doc.toString()).toBe('x')
  })

  it('is not taken by a view with no sink or one that cannot be edited', async () => {
    const plain = mount(createState('x'))
    expect(await insertDropped(plain, ['/in/a.png'], 0)).toBe(false)
    const readOnly = mount(createState('x', [imageSink.of(sink()), EditorState.readOnly.of(true)]))
    expect(await insertDropped(readOnly, ['/in/a.png'], 0)).toBe(false)
    expect(readOnly.state.doc.toString()).toBe('x')
  })

  it('holds the point to the text when it has got shorter while the file was handled', async () => {
    const view = viewOf('abcdef', 0, sink())
    const pending = insertDropped(view, ['/in/a.png'], 6)
    view.dispatch({ changes: { from: 2, to: 6 } })
    await pending
    expect(view.state.doc.toString()).toBe('ab![](pics/a.png)')
  })
})

describe('a picture dropped onto a document from Explorer (ISC-156, ISC-328, ISC-201)', () => {
  let host: MockHost
  const FILES: Record<string, string> = {
    'C:/ws/notes/a.md': 'hello\n',
    'C:/ws/notes/b.md': 'bee\n',
    'C:/ws/notes/pic.png': 'PNG',
    'C:/ws/notes/sub/deep pic (1).png': 'PNG',
    'C:/ws/img/p.png': 'PNG',
    'C:/out/q.png': 'PNG',
    'C:/out/r.jpg': 'JPG',
    // Pictures of their own: the same bytes would be one file whatever the name.
    'C:/out/my cat #1.png': 'CAT',
    'C:/other/q.png': 'OTHER',
  }
  let hit: Element | null = null

  beforeEach(async () => {
    host = createMockHost({ files: FILES, roots: ['C:/ws'] })
    setHost(host)
    resetWorkbench()
    resetDocuments()
    resetUntitled()
    resetTree()
    problem.value = null
    await restoreWorkspace([])
    await installFileDrop()
    document.elementFromPoint = () => hit
  })

  afterEach(() => {
    Reflect.deleteProperty(document, 'elementFromPoint')
    hit = null
    resetTree()
    resetWorkbench()
    resetDocuments()
    setHost(undefined)
    vi.restoreAllMocks()
  })

  function viewOfTab(tab: string, at: number): EditorView {
    const follower = followerOfTab(tab)
    if (follower === undefined) throw new Error('no follower')
    const view = mount(follower.state)
    follower.show(view)
    // jsdom has no layout, so the point is turned into a position by hand; what is under test is
    // that the drop's own page point is what gets asked.
    view.posAtCoords = vi.fn(() => at)
    return view
  }

  async function dropOnText(view: EditorView, paths: string[]): Promise<void> {
    hit = view.contentDOM
    host.simulateDrop(paths, { x: 120, y: 80 })
    await flush()
  }

  it('links a file inside the workspace where it lies, relative to the document, and copies nothing', async () => {
    const tab = await openPath('C:/ws/notes/a.md')
    const view = viewOfTab(tab, 2)
    const asked = vi.spyOn(view, 'posAtCoords')
    await dropOnText(view, ['C:/ws/img/p.png'])
    expect(documentOfTab(tab)?.master.doc.toString()).toBe('he![](../img/p.png)llo\n')
    expect(host.copiedImages).toEqual([])
    expect(asked).toHaveBeenCalledWith({ x: 120, y: 80 })
    expect(imageTabs()).toHaveLength(0)
    // The link resolves, by the allowlist, to the file that was dropped.
    expect(resolveImageAddress('../img/p.png', 'C:/ws/notes', 'C:/ws')).toEqual({
      kind: 'local',
      path: 'C:/ws/img/p.png',
    })
  })

  it('links a file in the document folder, or below it, with the name written so it reads back', async () => {
    const tab = await openPath('C:/ws/notes/a.md')
    const view = viewOfTab(tab, 0)
    await dropOnText(view, ['C:/ws/notes/pic.png'])
    await dropOnText(view, ['C:/ws/notes/sub/deep pic (1).png'])
    expect(documentOfTab(tab)?.master.doc.toString()).toBe(
      '![](<sub/deep pic (1).png>)![](pic.png)hello\n',
    )
    expect(host.copiedImages).toEqual([])
  })

  it('copies a file from outside the workspace into assets and links the copy', async () => {
    const tab = await openPath('C:/ws/notes/a.md')
    const view = viewOfTab(tab, 5)
    vi.useFakeTimers({ now: new Date(2026, 10, 13, 15, 30, 0), toFake: ['Date'] })
    try {
      await dropOnText(view, ['C:/out/q.png'])
    } finally {
      vi.useRealTimers()
    }
    expect(documentOfTab(tab)?.master.doc.toString()).toBe('hello![](assets/q.png)\n')
    expect(host.copiedImages).toEqual(['C:/ws/notes/assets/q.png'])
    expect(host.files.has('C:/out/q.png')).toBe(true)
    expect(imageTabs()).toHaveLength(0)
  })

  it('links each of several pictures dropped together, mixing in place and copy', async () => {
    const tab = await openPath('C:/ws/notes/a.md')
    const view = viewOfTab(tab, 0)
    await dropOnText(view, ['C:/ws/notes/pic.png', 'C:/out/r.jpg'])
    expect(documentOfTab(tab)?.master.doc.toString()).toBe('![](pic.png)\n![](assets/r.jpg)hello\n')
    expect(host.copiedImages).toHaveLength(1)
  })

  it('dropping the same picture again links the copy that is there instead of copying it twice', async () => {
    const tab = await openPath('C:/ws/notes/a.md')
    const view = viewOfTab(tab, 5)
    await dropOnText(view, ['C:/out/q.png'])
    await dropOnText(view, ['C:/out/q.png'])
    await dropOnText(view, ['C:/out/q.png'])
    expect(documentOfTab(tab)?.master.doc.toString()).toBe(
      'hello![](assets/q.png)![](assets/q.png)![](assets/q.png)\n',
    )
    expect(host.copiedImages).toEqual(['C:/ws/notes/assets/q.png'])
  })

  it('keeps the file name of a copy, cleaned for a link, and numbers a different picture of that name', async () => {
    const tab = await openPath('C:/ws/notes/a.md')
    const view = viewOfTab(tab, 0)
    await dropOnText(view, ['C:/out/my cat #1.png'])
    expect(view.state.doc.toString()).toBe('![](<assets/my cat -1.png>)hello\n')
    await dropOnText(view, ['C:/other/q.png'])
    await dropOnText(view, ['C:/out/q.png'])
    expect(host.copiedImages).toEqual([
      'C:/ws/notes/assets/my cat -1.png',
      'C:/ws/notes/assets/q.png',
      'C:/ws/notes/assets/q-2.png',
    ])
  })

  it('opens the Markdown file of a drop that has one, and links the picture that came with it', async () => {
    const tab = await openPath('C:/ws/notes/a.md')
    const view = viewOfTab(tab, 0)
    await dropOnText(view, ['C:/ws/notes/b.md', 'C:/ws/notes/pic.png'])
    expect(documentOfTab(tab)?.master.doc.toString()).toBe('![](pic.png)hello\n')
    const pane = workbenchLayout.value.root
    const titles = pane.kind === 'pane' ? pane.tabs.length : 0
    expect(titles).toBe(2)
    expect(imageTabs()).toHaveLength(0)
  })

  it('copies into the draft folder in a document with no file, whatever the picture is, and opens no tab (ISC-328)', async () => {
    await newUntitledTab()
    const tab =
      workbenchLayout.value.root.kind === 'pane' ? workbenchLayout.value.root.activeTab : null
    if (tab === null) throw new Error('no tab')
    const view = viewOfTab(tab, 0)
    await dropOnText(view, ['C:/ws/notes/pic.png'])
    expect(problem.value).toBeNull()
    expect(host.copiedImages).toHaveLength(1)
    expect(host.copiedImages[0]).toBe('/mock-data/drafts/1/assets/pic.png')
    expect(view.state.doc.toString()).toBe('![](assets/pic.png)')
    expect(imageTabs()).toHaveLength(0)
  })

  it('still opens an image tab when it lands off the text (ISC-201)', async () => {
    const tab = await openPath('C:/ws/notes/a.md')
    viewOfTab(tab, 0)
    hit = document.body
    host.simulateDrop(['C:/out/q.png'], { x: 5, y: 5 })
    await flush()
    expect(imageTabs()).toHaveLength(1)
    expect(documentOfTab(tab)?.master.doc.toString()).toBe('hello\n')
  })

  it('opens an image tab for a view with no point in its text, such as the margin', async () => {
    const tab = await openPath('C:/ws/notes/a.md')
    const view = viewOfTab(tab, 0)
    view.posAtCoords = vi.fn(() => null) as unknown as typeof view.posAtCoords
    await dropOnText(view, ['C:/out/q.png'])
    expect(imageTabs()).toHaveLength(1)
    expect(documentOfTab(tab)?.master.doc.toString()).toBe('hello\n')
  })

  it('refuses a path no native drop delivered and links nothing', async () => {
    const tab = await openPath('C:/ws/notes/a.md')
    const view = viewOfTab(tab, 0)
    // Only the mock's record decides: asking for a path outside the drop is refused.
    await expect(host.dropImage(1, 'C:/out/q.png', '20261113-153000')).rejects.toMatchObject({
      kind: 'not-allowed',
    })
    expect(view.state.doc.toString()).toBe('hello\n')
    expect(undo(view)).toBe(false)
  })
})
