// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { followLinkFrom, jumpToFragment, pendingLink, resolvePendingLink } from '@/documents/links'
import { documentOfTab, followerOfTab, openPath, problem, resetDocuments } from '@/documents/store'
import { createState } from '@/editor/create'
import { findAnchor, githubSlug, headingAnchors, headingText } from '@/editor/headingSlug'
import { isFollowGesture, linkAt, linkNavigation, type LinkHit } from '@/editor/links'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { findPane, panesOf } from '@/workbench/splitTree'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'

beforeAll(() => {
  // jsdom has no layout; CodeMirror's mouse handling asks ranges for their boxes.
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

function parsed(doc: string) {
  const state = createState(doc)
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

describe('linkAt', () => {
  it('finds the target of each kind of link, as written', () => {
    const doc = [
      'An [inline](other.md#Part "t") link.', // line 1
      'A [reference][ref] and a [shortcut].',
      'An <https://example.com/a> autolink and <me@example.com>.',
      'A bare https://example.org/x and www.example.net.',
      'An ![image](pic.png) and [**bold** text](b.md).',
      '',
      '[ref]: <ref target.md>',
      '[Shortcut]: https://example.com/s',
    ].join('\n')
    const state = parsed(doc)
    const at = (needle: string) => linkAt(state, doc.indexOf(needle))?.href ?? null
    expect(at('inline')).toBe('other.md#Part')
    expect(at('reference')).toBe('<ref target.md>')
    expect(at('shortcut')).toBe('https://example.com/s')
    expect(at('example.com/a')).toBe('https://example.com/a')
    expect(at('me@')).toBe('mailto:me@example.com')
    expect(at('example.org')).toBe('https://example.org/x')
    expect(at('www.')).toBe('http://www.example.net')
    expect(at('image')).toBeNull()
    expect(at('bold')).toBe('b.md')
    expect(at('A bare')).toBeNull()
  })

  it('returns null for a reference with no definition', () => {
    const state = parsed('See [nothing][missing].')
    expect(linkAt(state, 6)).toBeNull()
  })
})

describe('Ctrl+click in a view', () => {
  function mounted(doc: string, onFollow: (hit: LinkHit) => void) {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({ state: createState(doc, [linkNavigation(onFollow)]), parent })
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    return view
  }

  /** Lets CodeMirror's own mouse handling finish, which places the caret on mouseup. */
  function release(view: EditorView): void {
    view.contentDOM.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
  }

  function press(view: EditorView, pos: number, init: MouseEventInit): MouseEvent {
    // jsdom has no layout, so the position under the pointer is stubbed.
    view.posAtCoords = () => pos
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    })
    view.contentDOM.dispatchEvent(event)
    return event
  }

  it('follows the link under the pointer and keeps the caret where it was', () => {
    const hits: LinkHit[] = []
    const view = mounted('Go [there](b.md) now.', (hit) => hits.push(hit))
    press(view, 5, { ctrlKey: true })
    release(view)
    expect(hits.map((h) => h.href)).toEqual(['b.md'])
    expect(view.state.selection.main.head).toBe(0)
    view.destroy()
  })

  it('never navigates on a plain click (ISC-82)', () => {
    const hits: LinkHit[] = []
    const view = mounted('Go [there](b.md) now.', (hit) => hits.push(hit))
    for (const init of [
      {},
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true, button: 1 },
      { ctrlKey: true, altKey: true },
    ]) {
      press(view, 5, init)
      release(view)
    }
    expect(hits).toEqual([])
    // Where a plain click puts the caret is CodeMirror's own hit test, which jsdom cannot run;
    // the real window checks it (Phase 5 decisions).
    view.destroy()
  })

  it('does nothing on Ctrl+click away from a link', () => {
    const hits: LinkHit[] = []
    const view = mounted('Go [there](b.md) now.', (hit) => hits.push(hit))
    press(view, 19, { ctrlKey: true })
    release(view)
    expect(hits).toEqual([])
    view.destroy()
  })

  it('only Ctrl or Cmd with the main button is the gesture', () => {
    const gesture = (init: MouseEventInit) => isFollowGesture(new MouseEvent('mousedown', init))
    expect(gesture({ ctrlKey: true, button: 0 })).toBe(true)
    expect(gesture({ metaKey: true, button: 0 })).toBe(true)
    expect(gesture({ button: 0 })).toBe(false)
    expect(gesture({ ctrlKey: true, button: 2 })).toBe(false)
    expect(gesture({ ctrlKey: true, shiftKey: true, button: 0 })).toBe(false)
  })
})

describe('GitHub heading slugs', () => {
  it('matches the slugs GitHub writes', () => {
    expect(githubSlug('Hello World')).toBe('hello-world')
    expect(githubSlug('API v2.0 (beta)!')).toBe('api-v20-beta')
    expect(githubSlug('snake_case and kebab-case')).toBe('snake_case-and-kebab-case')
    expect(githubSlug('Café déjà vu')).toBe('café-déjà-vu')
    expect(githubSlug('  two  spaces ')).toBe('--two--spaces-')
    expect(githubSlug('C++ & C#')).toBe('c--c')
    expect(githubSlug('emoji 🎉 here')).toBe('emoji--here')
    expect(githubSlug('数字 123')).toBe('数字-123')
  })

  it('slugs the rendered text, not the Markdown', () => {
    expect(headingText('**Bold** and *it* `code`')).toBe('Bold and it code')
    expect(headingText('[Link text](https://x.example) after')).toBe('Link text after')
    expect(headingText('![logo](a.png) Title')).toBe('Title')
    expect(headingText('Escaped \\*star\\*')).toBe('Escaped *star*')
    expect(headingText('~~old~~ new')).toBe('old new')
  })

  it('numbers duplicates and skips fenced code and frontmatter', () => {
    const doc = Text.of([
      '---',
      'title: x',
      '---',
      '# Intro',
      '```',
      '# not a heading',
      '```',
      '## Intro',
      'Setext',
      '======',
      '### **Intro**',
      '#hashtag is not a heading',
      '    # indented code',
    ])
    expect(headingAnchors(doc).map((a) => a.slug)).toEqual([
      'intro',
      'intro-1',
      'setext',
      'intro-2',
    ])
    expect(findAnchor(doc, 'intro-1')).toBe(doc.line(8).from)
    expect(findAnchor(doc, 'Setext')).toBe(doc.line(9).from)
    expect(findAnchor(doc, 'user-content-intro-2')).toBe(doc.line(11).from)
    expect(findAnchor(doc, 'not-a-heading')).toBeNull()
  })
})

describe('following links through the store', () => {
  let host: MockHost
  const files = {
    'C:/notes/a.md':
      '# Top\n\nSee [b](b.md), [part](b.md#second-part) and [down](#lower-down).\n\n## Lower down\n',
    'C:/notes/b.md': '# B\n\nfirst\n\n## Second part\n\nmore\n',
    'C:/notes/spec.pdf': '%PDF',
  }

  beforeEach(() => {
    host = createMockHost({ files })
    setHost(host)
    resetWorkbench()
    resetDocuments()
    problem.value = null
    pendingLink.value = null
  })
  afterEach(() => {
    setHost(undefined)
  })

  const activeTab = () =>
    findPane(workbenchLayout.value, workbenchLayout.value.activePane)?.activeTab ?? null
  const tabCount = () => panesOf(workbenchLayout.value).reduce((n, pane) => n + pane.tabs.length, 0)

  it('opens a relative .md link in a new tab (ISC-74)', async () => {
    const a = await openPath('C:/notes/a.md')
    await followLinkFrom(a, 'b.md')
    const tab = activeTab()
    expect(tab).not.toBe(a)
    expect(tab === null ? null : documentOfTab(tab)?.path).toBe('C:/notes/b.md')
    expect(tabCount()).toBe(2)
  })

  it('jumps to a #heading in the same document (ISC-75)', async () => {
    const a = await openPath('C:/notes/a.md')
    await followLinkFrom(a, '#lower-down')
    const follower = followerOfTab(a)
    expect(follower?.state.selection.main.head).toBe(
      files['C:/notes/a.md'].indexOf('## Lower down'),
    )
    expect(activeTab()).toBe(a)
  })

  it('opens file.md#heading at that heading (ISC-76)', async () => {
    const a = await openPath('C:/notes/a.md')
    await followLinkFrom(a, 'b.md#second-part')
    const tab = activeTab()
    expect(tab).not.toBe(a)
    if (tab === null) throw new Error('no active tab')
    expect(followerOfTab(tab)?.state.selection.main.head).toBe(
      files['C:/notes/b.md'].indexOf('## Second part'),
    )
  })

  it('hands a web link to the OS and stays put', async () => {
    const a = await openPath('C:/notes/a.md')
    await followLinkFrom(a, 'https://example.com/x')
    expect(host.opened).toEqual(['https://example.com/x'])
    expect(activeTab()).toBe(a)
  })

  it('asks before another file opens in its default app, and opens it only on yes', async () => {
    const a = await openPath('C:/notes/a.md')
    await followLinkFrom(a, 'spec.pdf')
    expect(host.opened).toEqual([])
    expect(pendingLink.value).toMatchObject({
      tabId: a,
      href: 'spec.pdf',
      path: 'C:/notes/spec.pdf',
    })
    await resolvePendingLink('cancel')
    expect(host.opened).toEqual([])
    expect(pendingLink.value).toBeNull()
    await followLinkFrom(a, 'spec.pdf')
    await resolvePendingLink('open')
    expect(host.opened).toEqual(['C:/notes/spec.pdf'])
  })

  it('reports a refused, a missing and a heading-less target and changes nothing', async () => {
    const a = await openPath('C:/notes/a.md')
    await followLinkFrom(a, 'javascript:alert(1)')
    expect(problem.value).toContain('cannot be followed')
    await followLinkFrom(a, 'gone.md')
    expect(problem.value).toContain('not found')
    expect(jumpToFragment(a, 'nowhere')).toBe(false)
    expect(problem.value).toContain('#nowhere')
    expect(tabCount()).toBe(1)
    expect(host.opened).toEqual([])
  })

  it('a jump into a tab that is not on screen yet scrolls when the tab is shown', async () => {
    const b = await openPath('C:/notes/b.md')
    const follower = followerOfTab(b)
    if (follower === undefined) throw new Error('no follower')
    const target = files['C:/notes/b.md'].indexOf('## Second part')
    follower.reveal(target)
    expect(follower.state.selection.main.head).toBe(target)
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({ state: follower.state, parent })
    const scrolls: number[] = []
    const dispatch = view.dispatch.bind(view)
    view.dispatch = ((...specs: Parameters<EditorView['dispatch']>) => {
      for (const spec of specs) {
        const effects = 'effects' in spec ? [spec.effects].flat() : []
        // show() dispatches only the scroll; setState is not a dispatch.
        if (effects.some((effect) => effect !== undefined)) scrolls.push(1)
      }
      dispatch(...specs)
    }) as EditorView['dispatch']
    follower.show(view)
    expect(scrolls.length).toBe(1)
    follower.park()
    view.destroy()
  })

  it('reaches the store from a Ctrl+click in a real view of a tab', async () => {
    const a = await openPath('C:/notes/a.md')
    const follower = followerOfTab(a)
    if (follower === undefined) throw new Error('no follower')
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({ state: follower.state, parent })
    follower.show(view)
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    view.posAtCoords = () => files['C:/notes/a.md'].indexOf('[b]') + 1
    // A plain click first: nothing opens.
    view.contentDOM.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(tabCount()).toBe(1)
    view.contentDOM.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(tabCount()).toBe(2)
    follower.park()
    view.destroy()
  })
})

describe('the pointer cursor over a link while Ctrl is held (ISC-239)', () => {
  const DOC = 'Plain words and [a link](b.md) here.\n\n[gone](gone.md) is missing.'
  const LINK_AT = DOC.indexOf('[a link]') + 3
  const PLAIN_AT = 2

  function mountedView() {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      state: createState(DOC, [linkNavigation(() => undefined)]),
      parent,
    })
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    return view
  }

  /** A mouse move over the first line, with the position under the pointer stubbed (no layout in jsdom). */
  function move(view: EditorView, pos: number, init: MouseEventInit, on?: Element): void {
    view.posAtCoords = () => pos
    const line = on ?? view.contentDOM.querySelector('.cm-line')
    line?.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 30, clientY: 10, ...init }),
    )
  }

  const pointer = (view: EditorView): boolean => view.dom.classList.contains('cm-follow-link')
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('turns on over a link with Ctrl (or Cmd) held, and never without', () => {
    const view = mountedView()
    move(view, LINK_AT, {})
    expect(pointer(view)).toBe(false)
    move(view, LINK_AT, { ctrlKey: true })
    expect(pointer(view)).toBe(true)
    move(view, LINK_AT, { metaKey: true })
    expect(pointer(view)).toBe(true)
    move(view, LINK_AT, { ctrlKey: true, shiftKey: true })
    expect(pointer(view)).toBe(false)
    move(view, LINK_AT, { ctrlKey: true, altKey: true })
    expect(pointer(view)).toBe(false)
    view.destroy()
  })

  it('stays off over text that is not a link', () => {
    const view = mountedView()
    move(view, PLAIN_AT, { ctrlKey: true })
    expect(pointer(view)).toBe(false)
    move(view, LINK_AT, { ctrlKey: true })
    expect(pointer(view)).toBe(true)
    move(view, PLAIN_AT, { ctrlKey: true })
    expect(pointer(view)).toBe(false)
    view.destroy()
  })

  it('turns off when Ctrl is let go, when the pointer leaves and when the window loses focus', () => {
    const view = mountedView()
    move(view, LINK_AT, { ctrlKey: true })
    expect(pointer(view)).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false }))
    expect(pointer(view)).toBe(false)
    move(view, LINK_AT, { ctrlKey: true })
    view.dom.dispatchEvent(new MouseEvent('mouseleave'))
    expect(pointer(view)).toBe(false)
    move(view, LINK_AT, { ctrlKey: true })
    window.dispatchEvent(new Event('blur'))
    expect(pointer(view)).toBe(false)
    view.destroy()
  })

  it('turns on when Ctrl goes down with the pointer already resting on the link', () => {
    const view = mountedView()
    const line = view.contentDOM.querySelector('.cm-line')
    move(view, LINK_AT, {})
    Object.assign(document, { elementFromPoint: () => line ?? null })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))
    Reflect.deleteProperty(document, 'elementFromPoint')
    expect(pointer(view)).toBe(true)
    view.destroy()
  })

  it('stays off over a link marked missing, and over anything that is not a line of text', () => {
    const view = mountedView()
    const missing = document.createElement('span')
    missing.className = 'cm-md-link-broken'
    view.contentDOM.querySelector('.cm-line')?.append(missing)
    move(view, LINK_AT, { ctrlKey: true }, missing)
    expect(pointer(view)).toBe(false)
    const widget = document.createElement('div')
    view.contentDOM.append(widget)
    move(view, LINK_AT, { ctrlKey: true }, widget)
    expect(pointer(view)).toBe(false)
    view.destroy()
  })

  it('removes the class with the view', () => {
    const view = mountedView()
    move(view, LINK_AT, { ctrlKey: true })
    expect(pointer(view)).toBe(true)
    view.destroy()
    expect(pointer(view)).toBe(false)
  })
})
