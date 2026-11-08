// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  brokenLinks,
  CHECK_DELAY_MS,
  FRESH_MS,
  isLocalTarget,
  LinkStatus,
  linkStatus,
} from '@/editor/brokenLinks'
import { createState } from '@/editor/create'
import { inlineLinksIn } from '@/editor/links'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('isLocalTarget', () => {
  it('is true only for a target that names a file relative to the document', () => {
    for (const href of ['a.md', 'sub/b.md#x', '../c.md', '<with space.md>', 'pic.png', 'README']) {
      expect(isLocalTarget(href), href).toBe(true)
    }
    for (const href of [
      '#heading',
      'https://x.example',
      'mailto:a@b.c',
      'javascript:x',
      '',
      '  ',
    ]) {
      expect(isLocalTarget(href), href).toBe(false)
    }
  })
})

describe('LinkStatus', () => {
  it('asks again only for unknown or stale targets', async () => {
    let now = 0
    const asked: string[][] = []
    const status = new LinkStatus(
      (hrefs) => {
        asked.push([...hrefs])
        return Promise.resolve(hrefs.map((href) => href.startsWith('gone')))
      },
      () => now,
    )
    expect(status.stale(['a.md', 'gone.md', 'a.md'])).toEqual(['a.md', 'gone.md'])
    expect(await status.refresh(['a.md', 'gone.md'])).toBe(true)
    expect(status.isMissing('gone.md')).toBe(true)
    expect(status.isMissing('a.md')).toBe(false)
    now = FRESH_MS - 1
    expect(status.stale(['a.md', 'gone.md', 'new.md'])).toEqual(['new.md'])
    now = FRESH_MS
    expect(status.stale(['a.md'])).toEqual(['a.md'])
    // The same answers again change nothing.
    expect(await status.refresh(['a.md', 'gone.md'])).toBe(false)
    expect(asked).toEqual([
      ['a.md', 'gone.md'],
      ['a.md', 'gone.md'],
    ])
  })

  it('splits a long list into requests Rust accepts', async () => {
    const sizes: number[] = []
    const status = new LinkStatus((hrefs) => {
      sizes.push(hrefs.length)
      return Promise.resolve(hrefs.map(() => false))
    })
    await status.refresh(Array.from({ length: 1201 }, (_, i) => `f${String(i)}.md`))
    expect(sizes).toEqual([500, 500, 201])
  })
})

describe('inlineLinksIn', () => {
  it('lists inline links with their targets, and no images or references', () => {
    const doc = '[a](a.md) ![i](i.png) [r][ref] <https://x.example> [b](<b c.md>)\n\n[ref]: r.md'
    const state = createState(doc)
    ensureSyntaxTree(state, state.doc.length, 5000)
    expect(inlineLinksIn(state, 0, doc.length).map((hit) => hit.href)).toEqual(['a.md', '<b c.md>'])
  })
})

describe('the broken style in a view', () => {
  const views: EditorView[] = []
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy()
  })

  function mount(doc: string, missing: (href: string) => boolean) {
    const calls: string[][] = []
    const status = new LinkStatus((hrefs) => {
      calls.push([...hrefs])
      return Promise.resolve(hrefs.map(missing))
    })
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      state: createState(doc, [linkStatus.of(status), brokenLinks()]),
      parent,
    })
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    views.push(view)
    return { view, calls }
  }

  const broken = (view: EditorView) =>
    [...view.contentDOM.querySelectorAll('.cm-md-link-broken')].map((node) => node.textContent)

  it('marks only the links whose file is missing, after a background check (ISC-79)', async () => {
    const { view, calls } = mount(
      'See [here](a.md), [gone](gone.md) and [web](https://x.example).',
      (href) => href.startsWith('gone'),
    )
    expect(broken(view)).toEqual([])
    await wait(CHECK_DELAY_MS + 50)
    expect(calls).toEqual([['a.md', 'gone.md']])
    expect(broken(view)).toEqual(['[gone](gone.md)'])
  })

  it('checks a link typed later, and clears the style when the target is fixed', async () => {
    const { view, calls } = mount('Start.', (href) => href === 'gone.md')
    // Let the first check pass with nothing to ask, so only the edit can cause the next one.
    await wait(CHECK_DELAY_MS + 50)
    expect(calls).toEqual([])
    view.dispatch({ changes: { from: 6, insert: ' [x](gone.md)' } })
    await wait(CHECK_DELAY_MS + 50)
    expect(broken(view)).toEqual(['[x](gone.md)'])
    const at = view.state.doc.toString().indexOf('gone.md')
    view.dispatch({ changes: { from: at, to: at + 'gone'.length, insert: 'here' } })
    await wait(CHECK_DELAY_MS + 50)
    expect(broken(view)).toEqual([])
  })

  it('asks again on its own once answers go stale, so a file that appears is drawn as fine', async () => {
    vi.useFakeTimers()
    try {
      let gone = true
      const { view, calls } = mount('[later](later.md)', () => gone)
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 10)
      expect(broken(view)).toEqual(['[later](later.md)'])
      gone = false
      await vi.advanceTimersByTimeAsync(FRESH_MS + 10)
      expect(calls.length).toBe(2)
      expect(broken(view)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays quiet with no local links on screen', async () => {
    vi.useFakeTimers()
    try {
      const { calls } = mount('Only [web](https://x.example) here.', () => true)
      await vi.advanceTimersByTimeAsync(FRESH_MS * 3)
      expect(calls).toEqual([])
      // No timer is left waiting, so an idle view costs nothing.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does nothing without a status', async () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({ state: createState('[gone](gone.md)', [brokenLinks()]), parent })
    views.push(view)
    await wait(CHECK_DELAY_MS + 50)
    expect(broken(view)).toEqual([])
  })
})
