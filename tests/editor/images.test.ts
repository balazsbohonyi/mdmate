// @vitest-environment jsdom
/**
 * ISC-66, ISC-67, ISC-180 and ISC-182: images. The address rules are checked as plain data (an
 * allowlist: a relative path inside the document's folder, or `https`, and nothing else), then the
 * widgets in a jsdom view. jsdom loads no images, so a test fires the load and error events itself;
 * the real loading, and the scroll behaviour, are checked in the real window.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import {
  blocksOf,
  imageContext,
  imageSizeOf,
  rememberImageSize,
  resetImageSizes,
  resolveImageAddress,
  scanBlocks,
  type ImageItem,
} from '@/editor/livePreview/blocks'
import { blockStateOf, drawn, mountPreview } from '../helpers/blocks'

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
  resetImageSizes()
})

const context = imageContext.of({
  folder: () => '/notes/docs',
  url: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
})

/** A view over `doc` with images enabled, the caret at the end (clear of any image). */
function mount(doc: string, caret = doc.length): EditorView {
  const view = mountPreview(doc, caret, context)
  views.push(view)
  return view
}

function images(doc: string, extensions = context): ImageItem[] {
  const state = blockStateOf(doc, doc.length, extensions)
  return scanBlocks(state, [{ from: 0, to: doc.length }]).filter(
    (item): item is ImageItem => item.kind === 'image',
  )
}

/** The fixed-size box of the first image on the page. */
function frameOf(view: EditorView): HTMLElement {
  const frame = view.contentDOM.querySelector<HTMLElement>('.cm-md-image-frame')
  if (frame === null) throw new Error('no image on the page')
  return frame
}

describe('which addresses can load (ISC-180)', () => {
  const folder = '/notes/docs'
  const local = (address: string): string | null => {
    const found = resolveImageAddress(address, folder)
    return found.kind === 'local' ? found.path : null
  }

  it('resolves a relative path against the document folder', () => {
    expect(local('a.png')).toBe('/notes/docs/a.png')
    expect(local('./a.png')).toBe('/notes/docs/a.png')
    expect(local('img/a.png')).toBe('/notes/docs/img/a.png')
    expect(local('img/../a.png')).toBe('/notes/docs/a.png')
    expect(local('img//a.png')).toBe('/notes/docs/img/a.png')
  })

  it('decodes percent escapes, drops a query or fragment, and reads angle brackets', () => {
    expect(local('my%20pic.png')).toBe('/notes/docs/my pic.png')
    expect(local('a.png?raw=1')).toBe('/notes/docs/a.png')
    expect(local('a.png#frag')).toBe('/notes/docs/a.png')
    expect(local('<with space.png>')).toBe('/notes/docs/with space.png')
    expect(local('100%25.png')).toBe('/notes/docs/100%.png')
    expect(local('50%.png')).toBe('/notes/docs/50%.png')
  })

  it('accepts backslashes as separators, as a Windows author writes them', () => {
    expect(local('img\\a.png')).toBe('/notes/docs/img/a.png')
  })

  it('uses the folder separator the document folder already has', () => {
    expect(resolveImageAddress('img/a.png', 'D:\\notes\\docs')).toEqual({
      kind: 'local',
      path: 'D:\\notes\\docs\\img\\a.png',
    })
    expect(resolveImageAddress('a.png', 'D:\\')).toEqual({ kind: 'local', path: 'D:\\a.png' })
  })

  it('takes an https address as it is', () => {
    expect(resolveImageAddress('https://example.com/a.png?x=1#y', null)).toEqual({
      kind: 'remote',
      url: 'https://example.com/a.png?x=1#y',
    })
    expect(resolveImageAddress('HTTPS://Example.com/a.png', null).kind).toBe('remote')
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['http', 'http://example.com/a.png'],
    ['file url', 'file:///C:/a.png'],
    ['file url with a host', 'file://host.invalid/share/a.png'],
    ['four slashes', 'file:////host.invalid/share/a.png'],
    ['data url', 'data:image/png;base64,AAAA'],
    ['script url', 'javascript:alert(1)'],
    ['unknown scheme', 'ms-msdt:/id/TestOnly'],
    ['unc with backslashes', '\\\\host.invalid\\share\\a.png'],
    ['unc with slashes', '//host.invalid/share/a.png'],
    ['unc in angle brackets', '<\\\\host.invalid\\share\\a b.png>'],
    ['absolute unix path', '/etc/passwd'],
    ['absolute windows path', 'C:\\Windows\\a.png'],
    ['absolute windows path with slashes', 'C:/Windows/a.png'],
    ['a drive letter alone', 'C:a.png'],
    ['a rooted backslash path', '\\Windows\\a.png'],
    ['one level up', '../a.png'],
    ['two levels up', 'img/../../a.png'],
    ['up with a backslash', '..\\a.png'],
    ['up, encoded', '%2e%2e/a.png'],
    ['up, slash encoded', '..%2Fa.png'],
    ['up, backslash encoded', '..%5Ca.png'],
    ['a unc path, encoded', '%5C%5Chost.invalid%5Cshare%5Ca.png'],
    ['a rooted path, encoded', '%2Fetc%2Fpasswd'],
    ['a stream name', 'a.png:stream'],
    ['a control character', 'a\u0000.png'],
    ['a newline', 'a\n.png'],
    ['a device name', 'nul'],
    ['a device name with an extension', 'img/NUL.png'],
    ['a device name, any case', 'Com1.png'],
    ['a trailing dot', 'a.png.'],
    ['the folder itself', '.'],
    ['nothing after the folder', 'img/..'],
    ['credentials in https', 'https://user:pw@example.com/a.png'],
    ['https that is not a url', 'https://'],
  ])('refuses %s', (_name, address) => {
    expect(resolveImageAddress(address, folder).kind).toBe('refused')
  })

  it('refuses a relative path when the document has no folder', () => {
    expect(resolveImageAddress('a.png', null).kind).toBe('refused')
  })

  it('never gives a path outside the folder, or a remote that is not https, for any input', () => {
    const pieces = [
      '.',
      '..',
      '/',
      '\\',
      '%2e',
      '%2f',
      '%5c',
      'a',
      ':',
      '?',
      '#',
      'C',
      'file',
      'https',
      '//',
      '<',
      '>',
      'nul',
    ]
    let seed = 12345
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    let resolved = 0
    for (let i = 0; i < 6000; i++) {
      let address = ''
      for (let n = Math.floor(next() * 7); n >= 0; n--) {
        address += pieces[Math.floor(next() * pieces.length)] ?? ''
      }
      const found = resolveImageAddress(address, folder)
      if (found.kind === 'local') {
        resolved++
        expect(found.path.startsWith(`${folder}/`), address).toBe(true)
        expect(found.path.split('/').includes('..'), address).toBe(false)
      } else if (found.kind === 'remote') {
        expect(new URL(found.url).protocol, address).toBe('https:')
      }
    }
    // The checks above are only worth something if they saw paths that resolved.
    expect(resolved).toBeGreaterThan(50)
  })

  it('lets only an https image of hostile.md load', () => {
    const hostile = readFileSync(join(import.meta.dirname, '../fixtures/hostile.md'), 'utf8')
    const found = images(hostile)
    expect(found.length).toBeGreaterThanOrEqual(6)
    const loadable = found.filter((item) => item.src !== null)
    expect(loadable.map((item) => item.image.kind)).toEqual(['remote'])
    expect(loadable.every((item) => item.src?.startsWith('https://') === true)).toBe(true)
  })
})

describe('the image widget (ISC-66, ISC-67)', () => {
  it('draws a relative image from the asset url of its resolved path', () => {
    const view = mount('text\n\n![a cat](img/cat.png)\n\nmore')
    const img = view.contentDOM.querySelector('.cm-md-image-frame img')
    expect(img?.getAttribute('src')).toBe('asset://localhost/%2Fnotes%2Fdocs%2Fimg%2Fcat.png')
    expect(img?.getAttribute('alt')).toBe('a cat')
  })

  it('draws an https image from its own address', () => {
    const view = mount('![x](https://example.com/p.png)\n\nmore')
    expect(view.contentDOM.querySelector('.cm-md-image-frame img')?.getAttribute('src')).toBe(
      'https://example.com/p.png',
    )
  })

  it('carries the title and sends no referrer', () => {
    const view = mount('![a](a.png "A title")\n\ntext\n')
    const img = view.contentDOM.querySelector<HTMLImageElement>('.cm-md-image-frame img')
    expect(img?.getAttribute('title')).toBe('A title')
    expect(img?.referrerPolicy).toBe('no-referrer')
  })

  it('draws an image alone on its line as a block, and one inside text inline', () => {
    const doc = 'one ![small](s.png) two\n\n![big](b.png)\n\nend'
    const [inline, block] = images(doc)
    expect(inline?.block).toBe(false)
    expect(block?.block).toBe(true)
    expect(doc.slice(inline?.from, inline?.to)).toBe('![small](s.png)')
    expect(doc.slice(block?.from, block?.to)).toBe('![big](b.png)')
    expect(drawn(blockStateOf(doc, doc.length, context))).toEqual([
      `image ${String(inline?.from)}-${String(inline?.to)}`,
      `image ${String(block?.from)}-${String(block?.to)}`,
    ])
  })

  it('draws a row of badges, and an image inside a link', () => {
    const view = mount(
      '[![build](b.svg)](https://ci.example.com) [![x](https://e.com/x.svg)](y)\n\nend',
    )
    expect(view.contentDOM.querySelectorAll('.cm-md-image-frame img')).toHaveLength(2)
  })

  it('leaves an image in a table, a code fence, a list or a quote as text', () => {
    expect(images('| a |\n|---|\n| ![x](y.png) |\n')).toHaveLength(0)
    expect(images('```\n![x](y.png)\n```\n')).toHaveLength(0)
    expect(images('- ![x](y.png)\n')).toHaveLength(0)
    expect(images('> ![x](y.png)\n')).toHaveLength(0)
    expect(images('`![x](y.png)`\n')).toHaveLength(0)
  })

  it('leaves an image with no address of its own as text', () => {
    expect(images('![x][ref]\n\n[ref]: y.png\n')).toHaveLength(0)
  })

  it('shows its source while the caret is on it, and draws it again after', () => {
    const doc = 'top\n\n![a](a.png)\n\nbottom'
    const view = mount(doc)
    expect(view.contentDOM.querySelector('.cm-md-image-frame img')).not.toBeNull()
    view.dispatch({ selection: { anchor: doc.indexOf('![a]') + 4 } })
    expect(view.contentDOM.querySelector('.cm-md-image-frame img')).toBeNull()
    expect(view.contentDOM.textContent).toContain('![a](a.png)')
    view.dispatch({ selection: { anchor: 1 } })
    expect(view.contentDOM.querySelector('.cm-md-image-frame img')).not.toBeNull()
  })

  it('shows the source of an inline image only while the caret touches it', () => {
    const doc = 'one ![s](s.png) two\n\nend'
    const view = mount(doc)
    expect(view.contentDOM.querySelectorAll('.cm-md-image-frame img')).toHaveLength(1)
    view.dispatch({ selection: { anchor: doc.indexOf('![s]') + 2 } })
    expect(view.contentDOM.querySelectorAll('.cm-md-image-frame img')).toHaveLength(0)
    expect(view.contentDOM.textContent).toContain('![s](s.png)')
  })

  it('puts the caret on the image source when it is pressed', () => {
    const doc = 'top\n\n![a](a.png)\n\nbottom'
    const view = mount(doc)
    view.contentDOM
      .querySelector('.cm-md-image-frame img')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    expect(view.state.selection.main.head).toBe(doc.indexOf('![a]'))
    expect(view.contentDOM.querySelector('.cm-md-image-frame img')).toBeNull()
  })

  it('leaves the document itself alone', () => {
    const doc = 'top\n\n![a](a.png)\n\none ![s](s.png) two\n'
    const view = mount(doc)
    for (let pos = 0; pos <= doc.length; pos += 2) view.dispatch({ selection: { anchor: pos } })
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('keeps one widget across an edit elsewhere, and a new one when the address changes', () => {
    const state = blockStateOf('![a](a.png)\n\nend', 14, context)
    const before = blocksOf(state)[0]
    const moved = state.update({ changes: { from: 0, insert: 'x\n\n' } }).state
    expect(blocksOf(moved)[0]?.widget.eq(before?.widget as never)).toBe(true)
    const edited = state.update({ changes: { from: 5, to: 6, insert: 'b' } }).state
    expect(blocksOf(edited)[0]?.widget.eq(before?.widget as never)).toBe(false)
  })

  it('treats images that differ in address, alt, title or placement as different widgets', () => {
    const widgetOf = (doc: string) => blocksOf(blockStateOf(doc, doc.length, context))[0]?.widget
    const base = widgetOf('![a](a.png "t")\n\nend')
    for (const other of [
      '![a](b.png "t")\n\nend',
      '![b](a.png "t")\n\nend',
      '![a](a.png "u")\n\nend',
      'x ![a](a.png "t") y\n\nend',
    ]) {
      expect(base?.eq(widgetOf(other) as never), other).toBe(false)
    }
    expect(base?.eq(widgetOf('![a](a.png "t")\n\nother') as never)).toBe(true)
  })

  it('refuses a relative image when the layer has no folder to resolve it against', () => {
    const [item] = images(
      '![a](a.png)\n\nend',
      imageContext.of({ folder: () => null, url: String }),
    )
    expect(item?.image.kind).toBe('refused')
    expect(item?.src).toBeNull()
  })
})

describe('the fixed-size box (ISC-182)', () => {
  it('holds a fixed height while the image is loading, and the same height when it fails', () => {
    const view = mount('![a cat](cat.png)\n\nend')
    const frame = frameOf(view)
    const loading = frame.style.minHeight
    expect(loading).toMatch(/^\d+px$/)
    frame.querySelector('.cm-md-image-frame img')?.dispatchEvent(new Event('error'))
    expect(frame.style.minHeight).toBe(loading)
    expect(frame.classList.contains('cm-md-image-failed')).toBe(true)
    expect(frame.textContent).toContain('a cat')
    expect(frame.querySelector('.cm-md-image-frame img')).toBeNull()
  })

  it('holds the same height for an image that is refused', () => {
    const view = mount('![nope](http://example.com/a.png)\n\n![ok](a.png)\n\nend')
    const [refused, ok] = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-image-frame')]
    expect(refused?.querySelector('.cm-md-image-frame img')).toBeNull()
    expect(refused?.textContent).toContain('nope')
    expect(refused?.style.minHeight).toBe(ok?.style.minHeight)
    expect(refused?.style.minHeight).not.toBe('')
  })

  it('uses a smaller fixed box for an image inside text', () => {
    const view = mount('one ![s](s.png) two\n\n![b](b.png)\n\nend')
    const [inline, block] = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-image-frame')]
    const small = parseInt(inline?.style.minHeight ?? '0')
    expect(small).toBeGreaterThan(0)
    expect(small).toBeLessThan(parseInt(block?.style.minHeight ?? '0'))
  })

  it('sizes the box from the image once it has loaded, and asks the view to measure', async () => {
    const view = mount('![a](a.png)\n\nend')
    const measure = vi.spyOn(view, 'requestMeasure')
    const frame = frameOf(view)
    const img = frame.querySelector('.cm-md-image-frame img')
    if (img === null) throw new Error('no image')
    Object.defineProperty(img, 'naturalWidth', { value: 400 })
    Object.defineProperty(img, 'naturalHeight', { value: 200 })
    img.dispatchEvent(new Event('load'))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(frame.style.aspectRatio.replaceAll(' ', '')).toBe('400/200')
    expect(frame.style.maxWidth).toBe('400px')
    expect(frame.style.minHeight).toBe('')
    expect(frame.classList.contains('cm-md-image-loaded')).toBe(true)
    expect(measure).toHaveBeenCalled()
  })

  it('remembers the size, so the same image is reserved exactly the next time', () => {
    const src = 'asset://localhost/%2Fnotes%2Fdocs%2Fa.png'
    rememberImageSize(src, 640, 320)
    expect(imageSizeOf(src)).toEqual({ width: 640, height: 320 })
    const frame = frameOf(mount('![a](a.png)\n\nend'))
    expect(frame.style.aspectRatio.replaceAll(' ', '')).toBe('640/320')
    expect(frame.style.maxWidth).toBe('640px')
    expect(frame.style.minHeight).toBe('')
  })

  it('learns the size from a first load', () => {
    const src = 'asset://localhost/%2Fnotes%2Fdocs%2Fa.png'
    const img = frameOf(mount('![a](a.png)\n\nend')).querySelector('.cm-md-image-frame img')
    if (img === null) throw new Error('no image')
    Object.defineProperty(img, 'naturalWidth', { value: 30 })
    Object.defineProperty(img, 'naturalHeight', { value: 20 })
    img.dispatchEvent(new Event('load'))
    expect(imageSizeOf(src)).toEqual({ width: 30, height: 20 })
  })

  it('keeps the cache bounded, forgetting the oldest first', () => {
    for (let i = 0; i < 5000; i++) rememberImageSize(`u${String(i)}`, 10, 10)
    expect(imageSizeOf('u0')).toBeUndefined()
    expect(imageSizeOf('u4999')).toEqual({ width: 10, height: 10 })
  })

  it('ignores a size that is zero or not a number', () => {
    rememberImageSize('bad', 0, 10)
    rememberImageSize('bad2', Number.NaN, 10)
    expect(imageSizeOf('bad')).toBeUndefined()
    expect(imageSizeOf('bad2')).toBeUndefined()
  })

  it('tells CodeMirror its height: the remembered one, or the placeholder', () => {
    const doc = '![a](a.png)\n\nend'
    const placeholder = blocksOf(blockStateOf(doc, doc.length, context))[0]?.estimatedHeight ?? 0
    expect(placeholder).toBeGreaterThan(100)
    rememberImageSize('asset://localhost/%2Fnotes%2Fdocs%2Fa.png', 400, 300)
    const known = blocksOf(blockStateOf(doc, doc.length, context))[0]?.estimatedHeight ?? 0
    expect(known).toBeGreaterThan(300)
    expect(known).not.toBe(placeholder)
  })
})

describe('a late image and the first visible line (ISC-72)', () => {
  const EDGE = 100

  /** Waits for the view's own measure cycle, which runs in an animation frame. */
  const frame = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()))

  function rect(top: number, bottom: number): DOMRect {
    return {
      top,
      bottom,
      left: 0,
      right: 0,
      width: 0,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }
  }

  interface Rig {
    view: EditorView
    frame: HTMLElement
    /** Where the image box is, in the page's coordinates. */
    place(top: number, bottom: number): void
    scrollTop(): number
    sized(): boolean
    load(): void
  }

  /** One image and the lines after it, with every position stubbed (jsdom has no layout). */
  function rig(): Rig {
    const view = mount('![a](a.png)\n\nnext\n\nend')
    let scrollTop = 0
    Object.defineProperty(view.scrollDOM, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
      },
      configurable: true,
    })
    view.scrollDOM.getBoundingClientRect = () => rect(EDGE, EDGE + 500)
    const frame = frameOf(view)
    const wrap = frame.parentElement
    const img = frame.querySelector<HTMLImageElement>('.cm-md-image-frame img')
    if (wrap === null || img === null) throw new Error('no image on the page')
    let box = rect(0, 0)
    wrap.getBoundingClientRect = () => box
    const sized = (): boolean => frame.classList.contains('cm-md-image-sized')
    // The first line in view sits 200 px lower once the image has its real height.
    for (const line of view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')) {
      line.getBoundingClientRect = () => rect(sized() ? 420 : 220, 440)
    }
    Object.defineProperty(img, 'naturalWidth', { value: 400 })
    Object.defineProperty(img, 'naturalHeight', { value: 360 })
    return {
      view,
      frame,
      place: (top, bottom) => {
        box = rect(top, bottom)
      },
      scrollTop: () => scrollTop,
      sized,
      load: () => img.dispatchEvent(new Event('load')),
    }
  }

  it('sizes the box in the view measure cycle, not in the load event', async () => {
    const t = rig()
    t.place(EDGE + 30, EDGE + 118)
    t.load()
    expect(t.sized()).toBe(false)
    await frame()
    expect(t.sized()).toBe(true)
    expect(t.frame.style.minHeight).toBe('')
  })

  it('measures the new height in the same cycle, with a second pass of the measure loop', async () => {
    const passes = async (load: boolean): Promise<number> => {
      const t = rig()
      t.place(EDGE + 30, EDGE + 118)
      // The view's own measurement; each pass of its loop calls it once.
      const state = (t.view as unknown as { viewState: { measure(): number } }).viewState
      const measure = vi.spyOn(state, 'measure')
      if (load) t.load()
      else t.view.requestMeasure()
      await frame()
      return measure.mock.calls.length
    }
    expect(await passes(true)).toBeGreaterThan(await passes(false))
  })

  it('restores only the growth of its own image when two load in the same frame', async () => {
    // A is wholly above the view. B sits just above the first visible line, L. When A grows,
    // the line between A and B comes into view, above B: it must not become the reference.
    const view = mount('![a](a.png)\n\n![b](b.png)\n\nnext\n\nend')
    let scrollTop = 0
    Object.defineProperty(view.scrollDOM, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
      },
      configurable: true,
    })
    view.scrollDOM.getBoundingClientRect = () => rect(EDGE, EDGE + 500)
    const [frameA, frameB] = [
      ...view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-image-frame'),
    ]
    if (frameA === undefined || frameB === undefined) throw new Error('two images expected')
    const sizedA = (): boolean => frameA.classList.contains('cm-md-image-sized')
    const sizedB = (): boolean => frameB.classList.contains('cm-md-image-sized')
    if (frameA.parentElement === null || frameB.parentElement === null) throw new Error('no boxes')
    frameA.parentElement.getBoundingClientRect = () => rect(EDGE - 300, EDGE - 10)
    frameB.parentElement.getBoundingClientRect = () => rect(EDGE + 30, EDGE + 118)
    // Lines in document order: the one between A and B, then L ("next") and the rest.
    const [between, ...after] = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')]
    if (between === undefined) throw new Error('no lines')
    const shiftA = (): number => (sizedA() ? 384 : 0)
    const shiftB = (): number => (sizedB() ? 445 : 0)
    // Hidden above the edge until A has grown, then in view above B's old place.
    between.getBoundingClientRect = () => rect(EDGE - 80 + shiftA(), EDGE - 56 + shiftA())
    for (const line of after) {
      line.getBoundingClientRect = () => rect(220 + shiftA() + shiftB(), 244 + shiftA() + shiftB())
    }
    for (const each of [frameA, frameB]) {
      const img = each.querySelector<HTMLImageElement>('.cm-md-image-frame img')
      if (img === null) throw new Error('no image')
      Object.defineProperty(img, 'naturalWidth', { value: 400 })
      Object.defineProperty(img, 'naturalHeight', { value: 300 })
      img.dispatchEvent(new Event('load'))
    }
    await frame()
    expect(sizedA() && sizedB()).toBe(true)
    // A is CodeMirror's to make up for; B's 445 is ours, not 0 and not 445 + 384.
    expect(scrollTop).toBe(445)
  })

  it('puts the first line back when the image sits between the anchor point and that line', async () => {
    const t = rig()
    // Below the point CodeMirror anchors on (12 px under the top), above the first line (at 220).
    t.place(EDGE + 30, EDGE + 118)
    t.load()
    await frame()
    // The line was at 220, is at 420 once the image has grown, so the scroll follows it down.
    expect(t.scrollTop()).toBe(200)
  })

  it('puts it back when the image holds the anchor point itself', async () => {
    const t = rig()
    t.place(EDGE - 80, EDGE + 80)
    t.load()
    await frame()
    expect(t.scrollTop()).toBe(200)
  })

  it('leaves the scroll alone for an image wholly above the anchor point: CodeMirror covers it', async () => {
    const t = rig()
    t.place(EDGE - 300, EDGE + 10)
    t.load()
    await frame()
    expect(t.sized()).toBe(true)
    expect(t.scrollTop()).toBe(0)
  })

  it('leaves the scroll alone for an image below the first line: it moves only what follows', async () => {
    const t = rig()
    t.place(EDGE + 300, EDGE + 460)
    t.load()
    await frame()
    expect(t.sized()).toBe(true)
    expect(t.scrollTop()).toBe(0)
  })

  it('does not scroll for an image that has left the page, and still remembers its size', async () => {
    const t = rig()
    t.place(EDGE + 30, EDGE + 118)
    t.load()
    t.view.dispatch({ changes: { from: 0, to: 11, insert: 'gone' } })
    await frame()
    expect(t.scrollTop()).toBe(0)
    expect(imageSizeOf('asset://localhost/%2Fnotes%2Fdocs%2Fa.png')).toEqual({
      width: 400,
      height: 360,
    })
  })

  it('shows an image whose size cannot be read as failed, not as an empty box', () => {
    const view = mount('![a](a.png)\n\nend')
    const frame = frameOf(view)
    const img = frame.querySelector('.cm-md-image-frame img')
    Object.defineProperty(img, 'naturalWidth', { value: 0 })
    Object.defineProperty(img, 'naturalHeight', { value: 0 })
    img?.dispatchEvent(new Event('load'))
    expect(frame.classList.contains('cm-md-image-failed')).toBe(true)
    expect(frame.style.minHeight).not.toBe('')
  })

  it('gives the reason in an editor hint, not a native title (ISC-226)', () => {
    const view = mount('![a](file:///x/a.png)\n\nend')
    const refused = view.contentDOM.querySelector<HTMLElement>('[data-hint]')
    expect(refused?.dataset.hint).toMatch(/^Not loaded/)
    expect(view.contentDOM.querySelector('[title]')).toBeNull()
  })
})
