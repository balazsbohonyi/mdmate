// @vitest-environment jsdom
/**
 * `<img>` tags (P9-T3): ISC-323 (a tag with `src`, `alt`, `title`, `width` and `height` draws as an
 * image through the same address allowlist as `![]()`, any other attribute is ignored, other HTML
 * stays source) and ISC-324 (a refused address, a `style` or an `on*` attribute loads nothing from
 * that address and runs nothing). The tag is read as plain data first, then drawn in a jsdom view;
 * jsdom loads no images, so a test fires the load event itself.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import {
  imageContext,
  resetImageSizes,
  scanBlocks,
  type ImageItem,
} from '@/editor/livePreview/blocks'
import { parseImgTag } from '@/editor/livePreview/blocks/imageTag'
import { shownSize } from '@/editor/livePreview/blocks/widgets'
import { blockStateOf, drawn, mountPreview } from '../helpers/blocks'

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
  resetImageSizes()
})

const context = imageContext.of({
  folder: () => '/notes/docs',
  boundary: () => null,
  url: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
})

function mount(doc: string, caret = doc.length): EditorView {
  const view = mountPreview(doc, caret, context)
  views.push(view)
  return view
}

function images(doc: string): ImageItem[] {
  const state = blockStateOf(doc, doc.length, context)
  return scanBlocks(state, [{ from: 0, to: doc.length }]).filter(
    (item): item is ImageItem => item.kind === 'image',
  )
}

/** Fires the load event on the first image of the page, as a browser would with this size. */
async function load(view: EditorView, width: number, height: number): Promise<void> {
  const img = view.contentDOM.querySelector('.cm-md-image-frame img')
  if (img === null) throw new Error('no image on the page')
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true })
  img.dispatchEvent(new Event('load'))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

describe('reading an <img> tag (ISC-323)', () => {
  it('takes src, alt, title, width and height', () => {
    expect(
      parseImgTag('<img src="a b.png" alt="An A" title="The A" width="120" height="80">'),
    ).toEqual({ src: 'a b.png', alt: 'An A', title: 'The A', width: 120, height: 80 })
  })

  it('reads single quotes, no quotes, any case, a self-closing end and spaces around =', () => {
    const expected = { src: 'a.png', alt: '', title: null, width: 5, height: null }
    for (const tag of [
      "<img src='a.png' width='5'>",
      '<img src=a.png width=5>',
      '<IMG SRC="a.png" WIDTH="5">',
      '<img src="a.png" width="5"/>',
      '<img src="a.png" width="5" />',
      '<img   src = "a.png"   width = "5" >',
    ]) {
      expect(parseImgTag(tag), tag).toEqual(expected)
    }
  })

  it('takes the first of a repeated attribute, as a browser does', () => {
    expect(parseImgTag('<img src="a.png" src="b.png" width="1" width="9">')).toMatchObject({
      src: 'a.png',
      width: 1,
    })
  })

  it('reads a size written as whole pixels and ignores anything else', () => {
    const width = (value: string) => parseImgTag(`<img src="a.png" width="${value}">`)?.width
    expect(width('300')).toBe(300)
    expect(width('300px')).toBe(300)
    expect(width(' 40 ')).toBe(40)
    for (const bad of ['0', '-5', '30.5', '1e3', 'abc', '50%', '', '100000', '12 34']) {
      expect(width(bad), bad).toBeNull()
    }
  })

  it('reads the character references an address or a label may hold, and no others', () => {
    expect(
      parseImgTag('<img src="a&amp;b.png" alt="x &lt; y &quot;z&quot; &#65;&#x42;">'),
    ).toMatchObject({
      src: 'a&b.png',
      alt: 'x < y "z" AB',
    })
    // A reference to a control character or an unknown name stays as written.
    expect(parseImgTag('<img src="a&#0;b.png" alt="&nosuch; &#1;">')).toMatchObject({
      src: 'a&#0;b.png',
      alt: '&nosuch; &#1;',
    })
  })

  it('keeps only the five attributes, whatever else the tag carries', () => {
    const tag = parseImgTag(
      '<img src="a.png" style="background:url(x)" onerror="alert(1)" onload="alert(2)" srcset="b.png 2x" class="c" id="i" loading="lazy" data-x="1" crossorigin>',
    )
    expect(tag).not.toBeNull()
    expect(Object.keys(tag ?? {}).sort()).toEqual(['alt', 'height', 'src', 'title', 'width'])
    expect(JSON.stringify(tag)).not.toMatch(/alert|style|srcset|onerror|onload/)
  })

  it('is not an image when it is anything but exactly one tag with an address', () => {
    for (const text of [
      '<img>',
      '<img alt="no address">',
      '<img src="">',
      '<img src>',
      '<img src="a.png"',
      '<img src="a.png>',
      '<img src="a.png"> after',
      'before <img src="a.png">',
      '<img src="a.png"><img src="b.png">',
      '<img src="a.png"\nwidth="5">',
      '<imgx src="a.png">',
      '<img/src="a.png">',
      '<img src="a.png"width="5">',
      '<picture><img src="a.png"></picture>',
      '<div>',
      'plain text',
      '',
    ]) {
      expect(parseImgTag(text), JSON.stringify(text)).toBeNull()
    }
  })

  it('never throws, and never keeps a key outside the five, on random text', () => {
    let seed = 7
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const pieces = [
      '<img',
      ' ',
      'src',
      '=',
      '"',
      "'",
      'a.png',
      '>',
      '/',
      'width',
      '5',
      'on',
      '&amp;',
      '\n',
    ]
    for (let round = 0; round < 4000; round++) {
      let text = ''
      for (let n = Math.floor(next() * 14); n > 0; n--) {
        text += pieces[Math.floor(next() * pieces.length)] ?? ''
      }
      const tag = parseImgTag(text)
      if (tag !== null) {
        expect(Object.keys(tag).sort(), JSON.stringify(text)).toEqual([
          'alt',
          'height',
          'src',
          'title',
          'width',
        ])
        expect(tag.src, JSON.stringify(text)).not.toBe('')
      }
    }
  })
})

describe('where an <img> tag is drawn (ISC-323)', () => {
  it('draws a tag alone on its line as a block, with its size', () => {
    const doc = 'top\n\n<img src="a.png" alt="A" width="120">\n\nend'
    const [item] = images(doc)
    expect(item).toMatchObject({
      kind: 'image',
      block: true,
      html: true,
      alt: 'A',
      width: 120,
      height: null,
      src: 'asset://localhost/%2Fnotes%2Fdocs%2Fa.png',
    })
    expect(doc.slice(item?.from, item?.to)).toBe('<img src="a.png" alt="A" width="120">')
  })

  it('draws a tag in a paragraph inline, and one alone on a line of a paragraph as a block', () => {
    const inline = 'one <img src="s.png"> two'
    expect(images(inline)[0]).toMatchObject({ block: false, html: true })
    const second = 'first line\n<img src="b.png">\nthird line'
    const [item] = images(second)
    expect(item).toMatchObject({ block: true, html: true })
    expect(second.slice(item?.from, item?.to)).toBe('<img src="b.png">')
  })

  it('draws a Markdown image and a tag together, each as what it is', () => {
    const [md, tag] = images('![m](m.png)\n\n<img src="t.png" width="9">\n')
    expect(md).toMatchObject({ html: false, width: null, height: null })
    expect(tag).toMatchObject({ html: true, width: 9 })
  })

  it('leaves other HTML as source', () => {
    for (const doc of [
      '<div>block</div>\n',
      'some <span>inline</span> html\n',
      '<br>\n',
      '<img src="a.png">\nnext line stays in the block\n',
      '<img alt="no address">\n',
    ]) {
      expect(images(doc), JSON.stringify(doc)).toHaveLength(0)
    }
  })

  it('draws the tag inside other inline HTML and leaves that HTML as source', () => {
    const doc = '<a href="https://example.com"><img src="badge.png"></a>\n'
    const [item] = images(doc)
    expect(item).toMatchObject({ block: false, html: true })
    expect(doc.slice(item?.from, item?.to)).toBe('<img src="badge.png">')
    expect(images('<picture><img src="a.png"></picture>\n')).toHaveLength(1)
  })

  it('leaves a tag in a table, a code fence, a list, a quote or code text as text', () => {
    expect(images('| a |\n|---|\n| <img src="y.png"> |\n')).toHaveLength(0)
    expect(images('```\n<img src="y.png">\n```\n')).toHaveLength(0)
    expect(images('- <img src="y.png">\n')).toHaveLength(0)
    expect(images('> <img src="y.png">\n')).toHaveLength(0)
    expect(images('`<img src="y.png">`\n')).toHaveLength(0)
  })

  it('shows the source while the caret is in the tag, and draws it again after', () => {
    const doc = 'top\n\n<img src="a.png" width="50">\n\nbottom'
    const view = mount(doc)
    expect(view.contentDOM.querySelector('.cm-md-image-frame img')).not.toBeNull()
    view.dispatch({ selection: { anchor: doc.indexOf('width') } })
    expect(view.contentDOM.querySelector('.cm-md-image-frame img')).toBeNull()
    expect(view.contentDOM.textContent).toContain('<img src="a.png" width="50">')
    view.dispatch({ selection: { anchor: doc.length } })
    expect(view.contentDOM.querySelector('.cm-md-image-frame img')).not.toBeNull()
  })

  it('draws the tag again when only its width changed', () => {
    const doc = 'a\n\n<img src="a.png" width="50">\n\nb'
    const state = blockStateOf(doc, doc.length, context)
    const before = drawn(state)
    const edited = state.update({
      changes: { from: doc.indexOf('50'), to: doc.indexOf('50') + 2, insert: '80' },
      selection: { anchor: 0 },
    }).state
    expect(drawn(edited)).toEqual(before)
    const widget = (s: typeof state) =>
      scanBlocks(s, [{ from: 0, to: s.doc.length }]).find((item) => item.kind === 'image')
    expect(widget(state)).toMatchObject({ width: 50 })
    expect(widget(edited)).toMatchObject({ width: 80 })
  })
})

describe('how big the picture is shown (ISC-323)', () => {
  it('follows the picture for the side that is not given, and is the box when both are', () => {
    const natural = { width: 400, height: 200 }
    expect(shownSize(natural, null, null)).toEqual(natural)
    expect(shownSize(natural, 100, null)).toEqual({ width: 100, height: 50 })
    expect(shownSize(natural, null, 100)).toEqual({ width: 200, height: 100 })
    expect(shownSize(natural, 100, 100)).toEqual({ width: 100, height: 100 })
  })

  it('sizes a block frame to the width once the picture has loaded, ratio kept', async () => {
    const view = mount('<img src="a.png" width="120">\n\nend')
    await load(view, 240, 140)
    const frame = view.contentDOM.querySelector<HTMLElement>('.cm-md-image-frame')
    expect(frame?.style.maxWidth).toBe('120px')
    expect(frame?.style.aspectRatio.replaceAll(' ', '')).toBe('120/70')
  })

  it('sizes an inline frame to the width, and a tag with both to that exact box', async () => {
    const inline = mount('one <img src="a.png" width="60"> two')
    await load(inline, 240, 140)
    const frame = inline.contentDOM.querySelector<HTMLElement>('.cm-md-image-frame')
    expect(frame?.style.width).toBe('60px')

    const both = mount('<img src="a.png" width="120" height="60">\n\nend')
    await load(both, 240, 140)
    const box = both.contentDOM.querySelector<HTMLElement>('.cm-md-image-frame')
    expect(box?.style.aspectRatio.replaceAll(' ', '')).toBe('120/60')
    expect(box?.querySelector('img')?.style.objectFit).toBe('fill')
  })

  it('leaves a Markdown image, and a tag with no size, at the picture’s own size', async () => {
    const md = mount('![a](a.png)\n\nend')
    await load(md, 240, 140)
    expect(md.contentDOM.querySelector<HTMLElement>('.cm-md-image-frame')?.style.maxWidth).toBe(
      '240px',
    )
    const tag = mount('<img src="a.png">\n\nend')
    await load(tag, 240, 140)
    const frame = tag.contentDOM.querySelector<HTMLElement>('.cm-md-image-frame')
    expect(frame?.style.maxWidth).toBe('240px')
    expect(tag.contentDOM.querySelector('img')?.style.objectFit).toBe('')
  })
})

describe('a tag that asks for more than it may have (ISC-324)', () => {
  it('loads nothing from an address the allowlist refuses, and still shows the label', () => {
    for (const src of [
      'http://example.invalid/a.png',
      'file:///C:/Windows/win.ini',
      'C:\\Windows\\win.ini',
      '//host.invalid/share/a.png',
      '\\\\host.invalid\\share\\a.png',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      '../../secret.png',
      '/etc/passwd',
    ]) {
      const [item] = images(`<img src="${src}" alt="x">\n`)
      expect(item?.src, src).toBeNull()
      expect(item?.image.kind, src).toBe('refused')
      const view = mount(`<img src="${src}" alt="the label">\n\nend`)
      expect(view.contentDOM.querySelector('.cm-md-image-frame img'), src).toBeNull()
      expect(view.contentDOM.querySelector('.cm-md-image-label')?.textContent, src).toBe(
        'the label',
      )
    }
  })

  it('draws an https address and a relative path, through the same allowlist as ![]()', () => {
    const [remote, local] = images(
      '<img src="https://example.com/a.png">\n\n<img src="sub/a.png">\n',
    )
    expect(remote?.src).toBe('https://example.com/a.png')
    expect(local?.src).toBe('asset://localhost/%2Fnotes%2Fdocs%2Fsub%2Fa.png')
    // An address spelt with character references is read before the allowlist, never after it.
    const [sneaky] = images('<img src="&#46;&#46;/&#46;&#46;/a.png">\n')
    expect(sneaky?.src).toBeNull()
  })

  it('puts no style, handler or extra attribute on anything it draws', async () => {
    const view = mount(
      '<img src="a.png" alt="A" title="T" width="50" style="position:fixed;inset:0" onerror="document.title=1" onload="document.title=2" onclick="x()" srcset="b.png 2x" class="evil" id="i">\n\nend',
    )
    await load(view, 240, 140)
    const drawnTree = view.contentDOM.querySelector('.cm-md-image')
    expect(drawnTree).not.toBeNull()
    for (const element of [drawnTree, ...(drawnTree?.querySelectorAll('*') ?? [])]) {
      for (const attribute of element?.getAttributeNames() ?? []) {
        expect(attribute, `${element?.tagName ?? ''} ${attribute}`).not.toMatch(/^on|srcset|^id$/)
      }
    }
    const img = view.contentDOM.querySelector('img')
    expect(img?.getAttribute('class')).toBeNull()
    expect(img?.getAttribute('style') ?? '').not.toMatch(/position|inset/)
    expect(img?.getAttribute('src')).toBe('asset://localhost/%2Fnotes%2Fdocs%2Fa.png')
    expect(img?.alt).toBe('A')
    expect(img?.title).toBe('T')
    expect(document.title).not.toBe('1')
    expect(document.title).not.toBe('2')
  })

  it('draws the label and the title as text, never as markup', () => {
    const view = mount(
      '<img src="x.png" alt="&lt;b&gt;bold&lt;/b&gt;<i>" title="&lt;u&gt;">\n\nend',
    )
    expect(
      view.contentDOM.querySelector('.cm-md-image b, .cm-md-image u, .cm-md-image i'),
    ).toBeNull()
    expect(view.contentDOM.querySelector('img')?.alt).toBe('<b>bold</b><i>')
  })
})

describe('the hostile fixture still loads nothing it should not (ISC-324)', () => {
  const hostile = readFileSync(join(import.meta.dirname, '../fixtures/hostile.md'), 'utf8')

  it('gives an address only to https and to relative paths inside the folder', () => {
    const found = images(hostile)
    expect(found.length).toBeGreaterThanOrEqual(12)
    for (const item of found) {
      if (item.src === null) continue
      expect(
        item.image.kind === 'remote'
          ? item.src.startsWith('https://')
          : /^asset:\/\/localhost\/%2Fnotes%2Fdocs%2F[^/]+$/.test(item.src),
        item.source,
      ).toBe(true)
    }
    // What a tag with an event attribute, a style or a srcset is allowed to load: its own address.
    const tags = found.filter((item) => item.html)
    expect(tags.length).toBeGreaterThanOrEqual(7)
    // Only the three that have a relative address of their own get one; the event attribute, the
    // style and the srcset next to it are dropped, and the refused addresses load nothing.
    expect(tags.filter((item) => item.src !== null).map((item) => item.src)).toEqual([
      'asset://localhost/%2Fnotes%2Fdocs%2Fx',
      'asset://localhost/%2Fnotes%2Fdocs%2Fx.png',
      'asset://localhost/%2Fnotes%2Fdocs%2Fy.png',
    ])
  })

  it('draws no handler and loads no address but its own, in a real view', () => {
    const view = mount(hostile, 0)
    for (const element of view.contentDOM.querySelectorAll('.cm-md-image, .cm-md-image *')) {
      for (const attribute of element.getAttributeNames()) {
        expect(attribute, element.tagName).not.toMatch(/^on|srcset/)
      }
    }
    for (const img of view.contentDOM.querySelectorAll('.cm-md-image img')) {
      expect(img.getAttribute('src') ?? '', img.outerHTML).toMatch(
        /^(https:\/\/|asset:\/\/localhost\/%2Fnotes%2Fdocs%2F)/,
      )
    }
    expect(document.title).toBe('')
  })
})
