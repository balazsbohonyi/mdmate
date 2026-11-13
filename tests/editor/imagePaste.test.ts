// @vitest-environment jsdom
/**
 * Pasting a picture (P9-T1): what a paste carries, the link that goes in (ISC-155, ISC-160), the
 * one edit it makes, and what a document with no file does (ISC-327, before P9-T5).
 */
import { undo } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { documentOfTab, followerOfTab, openPath, problem, resetDocuments } from '@/documents/store'
import { newUntitledTab, resetUntitled } from '@/documents/untitled'
import { createState, createView } from '@/editor/create'
import {
  imageMarkdown,
  imageSink,
  imageStamp,
  linkTarget,
  pastedImageFiles,
  type ImageSink,
} from '@/editor/imagePaste'
import { resolveImageAddress } from '@/editor/livePreview/blocks'
import { resetTree } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

function file(bytes: Uint8Array<ArrayBuffer>, name = 'image.png', type = 'image/png'): File {
  return new File([bytes], name, { type })
}

/** What a paste event's `clipboardData` offers, as WebView2 gave it in the real-window check. */
function clipboard(files: File[], text = '', html = ''): DataTransfer {
  return {
    files,
    getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : ''),
  } as unknown as DataTransfer
}

/** Sends a paste to the view the way the browser does, and says whether a handler took it over. */
function paste(view: EditorView, data: DataTransfer): boolean {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: data })
  view.contentDOM.dispatchEvent(event)
  return event.defaultPrevented
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

describe('what a paste carries (ISC-154)', () => {
  it('is the image files, whatever their names', () => {
    const shot = file(PNG, 'image.png')
    const photo = file(PNG, 'photo.jpg', 'image/jpeg')
    expect(pastedImageFiles(clipboard([shot]))).toEqual([shot])
    expect(pastedImageFiles(clipboard([shot, photo]))).toEqual([shot, photo])
    const gif = file(PNG, 'a.gif', 'image/gif')
    const webp = file(PNG, 'a.webp', 'image/webp')
    expect(pastedImageFiles(clipboard([gif, webp]))).toEqual([gif, webp])
  })

  it('leaves out a file that is not a picture, and takes nothing from a paste of only those', () => {
    const note = file(new Uint8Array(), 'note.md', 'text/markdown')
    const svg = file(new Uint8Array(), 'a.svg', 'image/svg+xml')
    expect(pastedImageFiles(clipboard([note]))).toEqual([])
    expect(pastedImageFiles(clipboard([svg]))).toEqual([])
    expect(pastedImageFiles(clipboard([note, file(PNG)]))).toHaveLength(1)
  })

  it('is nothing when text came with it: a copied spreadsheet range is text, not a picture', () => {
    expect(pastedImageFiles(clipboard([file(PNG)], 'a\tb'))).toEqual([])
    expect(pastedImageFiles(clipboard([file(PNG)], '', '<table></table>'))).toEqual([])
    expect(pastedImageFiles(null)).toEqual([])
    expect(pastedImageFiles(clipboard([]))).toEqual([])
  })
})

describe('the file name stamp', () => {
  it('is the local time as YYYYMMDD-HHMMSS, zero padded', () => {
    expect(imageStamp(new Date(2026, 10, 13, 15, 30, 0))).toBe('20261113-153000')
    expect(imageStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405')
  })
})

describe('the link for a saved picture (ISC-155, ISC-160)', () => {
  it('is plain Markdown image syntax with a relative path', () => {
    expect(imageMarkdown('assets/image-20261113-153000.png')).toBe(
      '![](assets/image-20261113-153000.png)',
    )
    expect(imageMarkdown('assets\\a.png')).toBe('![](assets/a.png)')
  })

  it('wraps an address that has a space or a parenthesis, and escapes a percent sign', () => {
    expect(imageMarkdown('my pics/a b.png')).toBe('![](<my pics/a b.png>)')
    expect(imageMarkdown('a (1).png')).toBe('![](<a (1).png>)')
    expect(imageMarkdown('100%.png')).toBe('![](100%25.png)')
    expect(linkTarget('a<b>.png')).toBe('a%3Cb%3E.png')
  })

  it('reads back as the same file through the real parser and the image allowlist', () => {
    // A seeded walk over names with every character that is hard to write in a link.
    const alphabet = [
      'a',
      'Z',
      '0',
      ' ',
      '(',
      ')',
      '[',
      ']',
      '%',
      '#',
      '&',
      "'",
      '"',
      'é',
      '日',
      '_',
      '-',
      '+',
      '.',
    ]
    let seed = 12345
    const next = (limit: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % limit
    }
    for (let round = 0; round < 300; round++) {
      const part = (): string => {
        let name = 'x'
        for (let i = next(8); i > 0; i--) name += alphabet[next(alphabet.length)]
        return name
      }
      const path = `${part()}/${part()}.png`
      const doc = imageMarkdown(path)
      const urls: string[] = []
      ensureSyntaxTree(createState(doc), doc.length, 5000)?.iterate({
        enter(node) {
          if (node.name === 'URL') urls.push(doc.slice(node.from, node.to))
        },
      })
      expect(urls, path).toHaveLength(1)
      expect(resolveImageAddress(urls[0] ?? '', '/doc', null), path).toEqual({
        kind: 'local',
        path: `/doc/${path}`,
      })
    }
  })
})

describe('a paste of a picture in a view (ISC-155)', () => {
  function sinkSaving(): ImageSink & { saved: Uint8Array[]; notes: string[]; links: string[] } {
    const saved: Uint8Array[] = []
    const notes: string[] = []
    const links: string[] = []
    return {
      saved,
      notes,
      links,
      refusal: () => null,
      drop: () => Promise.reject(new Error('not a drop')),
      save: (bytes) => {
        saved.push(new Uint8Array(bytes))
        const link = `assets/image-20261113-15300${String(saved.length)}.png`
        links.push(link)
        return Promise.resolve(link)
      },
      notify: (message) => notes.push(message),
    }
  }

  function viewOf(doc: string, from: number, to: number, sink: ImageSink): EditorView {
    const state = createState(doc, [imageSink.of(sink)]).update({
      selection: EditorSelection.single(from, to),
    }).state
    return mount(state)
  }

  it('saves the bytes and inserts the link at the caret, as the only edit', async () => {
    const sink = sinkSaving()
    const view = viewOf('before\nafter', 6, 6, sink)
    expect(paste(view, clipboard([file(PNG)]))).toBe(true)
    await vi.waitFor(() => expect(view.state.doc.toString()).toContain('![]('))
    expect(view.state.doc.toString()).toBe('before![](assets/image-20261113-153001.png)\nafter')
    expect([...(sink.saved[0] ?? [])]).toEqual([...PNG])
    expect(view.state.selection.main.head).toBe(
      'before![](assets/image-20261113-153001.png)'.length,
    )
  })

  it('replaces the selection, as any paste does', async () => {
    const sink = sinkSaving()
    const view = viewOf('one two three', 4, 7, sink)
    paste(view, clipboard([file(PNG)]))
    await vi.waitFor(() => expect(view.state.doc.toString()).toContain('![]('))
    expect(view.state.doc.toString()).toBe('one ![](assets/image-20261113-153001.png) three')
  })

  it('writes standard syntax only, never an <img> tag (ISC-160)', async () => {
    const sink = sinkSaving()
    const view = viewOf('', 0, 0, sink)
    paste(view, clipboard([file(PNG)]))
    await vi.waitFor(() => expect(view.state.doc.length).toBeGreaterThan(0))
    expect(view.state.doc.toString()).toMatch(/^!\[\]\(assets\/image-\d{8}-\d{6}\.png\)$/)
    expect(view.state.doc.toString()).not.toContain('<img')
  })

  it('inserts one link per picture, one under another, in a single undo step', async () => {
    const sink = sinkSaving()
    const view = viewOf('x', 1, 1, sink)
    paste(view, clipboard([file(PNG), file(PNG, 'b.png')]))
    await vi.waitFor(() => expect(view.state.doc.toString()).toContain('\n'))
    expect(view.state.doc.toString()).toBe(
      'x![](assets/image-20261113-153001.png)\n![](assets/image-20261113-153002.png)',
    )
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('x')
    // The files stay: nothing here asks the host to take one back.
    expect(sink.saved).toHaveLength(2)
  })

  it('leaves a paste that has text, or no picture, to the paste that was always there', async () => {
    const sink = sinkSaving()
    const view = viewOf('x', 1, 1, sink)
    // The text goes in as it always did; the picture next to it is only its preview.
    paste(view, clipboard([file(PNG)], 'some text'))
    expect(view.state.doc.toString()).toBe('xsome text')
    paste(view, clipboard([file(new Uint8Array(), 'n.md', 'text/markdown')]))
    paste(view, clipboard([]))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sink.saved).toHaveLength(0)
    expect(sink.notes).toEqual([])
    expect(view.state.doc.toString()).toBe('xsome text')
  })

  it('does nothing to a read-only document, and a state with no sink pastes as always', async () => {
    const sink = sinkSaving()
    const readOnly = mount(createState('x', [imageSink.of(sink), EditorState.readOnly.of(true)]))
    paste(readOnly, clipboard([file(PNG)]))
    const plain = mount(createState('x'))
    paste(plain, clipboard([file(PNG)]))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sink.saved).toHaveLength(0)
    expect(sink.notes).toEqual([])
    expect(readOnly.state.doc.toString()).toBe('x')
    expect(plain.state.doc.toString()).toBe('x')
  })

  it('says why and writes nothing when the document refuses (ISC-327)', async () => {
    const sink = { ...sinkSaving(), refusal: () => 'no folder' }
    const view = viewOf('x', 1, 1, sink)
    expect(paste(view, clipboard([file(PNG)]))).toBe(true)
    await vi.waitFor(() => expect(sink.notes).toEqual(['no folder']))
    expect(view.state.doc.toString()).toBe('x')
    expect(sink.saved).toHaveLength(0)
  })

  it('says what went wrong and inserts nothing when saving fails', async () => {
    const sink = sinkSaving()
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Tauri rejects with a plain { kind, message } object, not an Error
    sink.save = () => Promise.reject({ kind: 'io', message: 'the disk is full' })
    const view = viewOf('x', 1, 1, sink)
    paste(view, clipboard([file(PNG)]))
    await vi.waitFor(() =>
      expect(sink.notes).toEqual(['Could not save the image: the disk is full']),
    )
    expect(view.state.doc.toString()).toBe('x')
  })

  it('does not put a link into another tab when the view moved on while saving', async () => {
    const sink = sinkSaving()
    const view = viewOf('x', 1, 1, sink)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = sink.save.bind(sink)
    sink.save = async (bytes) => {
      await gate
      return slow(bytes)
    }
    paste(view, clipboard([file(PNG)]))
    view.setState(createState('another tab', [imageSink.of(sinkSaving())]))
    release()
    await vi.waitFor(() => expect(sink.notes).toHaveLength(1))
    expect(sink.notes[0]).toContain('assets/image-20261113-153001.png')
    expect(view.state.doc.toString()).toBe('another tab')
  })
})

describe('a paste of a picture into a document (ISC-154, ISC-155, ISC-327)', () => {
  let host: MockHost

  beforeEach(() => {
    host = createMockHost({ files: { 'C:/notes/a.md': 'hello\n', 'C:/notes/b.md': 'bee\n' } })
    setHost(host)
    resetWorkbench()
    resetDocuments()
    resetUntitled()
    resetTree()
    problem.value = null
  })

  afterEach(() => {
    resetTree()
    resetWorkbench()
    resetDocuments()
    setHost(undefined)
  })

  function viewOfTab(tab: string): EditorView {
    const follower = followerOfTab(tab)
    if (follower === undefined) throw new Error('no follower')
    const view = mount(follower.state)
    follower.show(view)
    return view
  }

  it('saves next to the file, links it, and an undo takes back the text and not the file', async () => {
    const tab = await openPath('C:/notes/a.md')
    const view = viewOfTab(tab)
    expect(paste(view, clipboard([file(PNG)]))).toBe(true)
    await vi.waitFor(() => expect(host.pastedImages).toHaveLength(1))
    const saved = host.pastedImages[0]
    expect(saved?.path).toMatch(/^C:\/notes\/assets\/image-\d{8}-\d{6}\.png$/)
    expect([...(saved?.bytes ?? [])]).toEqual([...PNG])
    await vi.waitFor(() => expect(view.state.doc.toString()).toContain('![]('))
    const doc = documentOfTab(tab)
    expect(doc?.master.doc.toString()).toMatch(/^!\[\]\(assets\/image-\d{8}-\d{6}\.png\)hello\n$/)
    // The link resolves, by the allowlist, to the file that was saved.
    const link = /\(([^)]+)\)/.exec(doc?.master.doc.toString() ?? '')?.[1] ?? ''
    expect(resolveImageAddress(link, 'C:/notes', null)).toEqual({
      kind: 'local',
      path: saved?.path,
    })

    expect(followerOfTab(tab)?.undo()).toBe(true)
    expect(doc?.master.doc.toString()).toBe('hello\n')
    expect(host.files.has(saved?.path ?? '')).toBe(true)
  })

  it('never replaces a file that is already there: the second paste in a second gets -2', async () => {
    const tab = await openPath('C:/notes/a.md')
    const view = viewOfTab(tab)
    vi.useFakeTimers({ now: new Date(2026, 10, 13, 15, 30, 0), toFake: ['Date'] })
    try {
      paste(view, clipboard([file(PNG)]))
      await vi.waitFor(() => expect(host.pastedImages).toHaveLength(1))
      paste(view, clipboard([file(PNG)]))
      await vi.waitFor(() => expect(host.pastedImages).toHaveLength(2))
    } finally {
      vi.useRealTimers()
    }
    expect(host.pastedImages.map((image) => image.path)).toEqual([
      'C:/notes/assets/image-20261113-153000.png',
      'C:/notes/assets/image-20261113-153000-2.png',
    ])
  })

  it('refuses in a document with no file, with the notice, and writes nothing (ISC-327)', async () => {
    await newUntitledTab()
    const tab =
      workbenchLayout.value.root.kind === 'pane' ? workbenchLayout.value.root.activeTab : null
    if (tab === null) throw new Error('no tab')
    const view = viewOfTab(tab)
    expect(paste(view, clipboard([file(PNG)]))).toBe(true)
    await vi.waitFor(() =>
      expect(problem.value).toBe('Save the file first so the image has a folder'),
    )
    expect(host.pastedImages).toHaveLength(0)
    expect(view.state.doc.toString()).toBe('')
  })

  it('tells the user when the host refuses the bytes, and leaves the text alone', async () => {
    const tab = await openPath('C:/notes/a.md')
    const view = viewOfTab(tab)
    // Something that is not a picture, under an image type: the host looks at the bytes.
    paste(view, clipboard([file(new Uint8Array([1, 2, 3]), 'fake.png')]))
    await vi.waitFor(() => expect(problem.value).toContain('Could not save the image'))
    expect(host.pastedImages).toHaveLength(0)
    expect(view.state.doc.toString()).toBe('hello\n')
  })
})
