// @vitest-environment jsdom
/**
 * Hints for things drawn in the editor (ISC-226): a broken link shows a hint drawn like the shadcn
 * tooltip (popover tokens, an arrow), after the same wait, and never a native title.
 */
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { brokenLinks, CHECK_DELAY_MS, LinkStatus, linkStatus } from '@/editor/brokenLinks'
import { Text } from '@codemirror/state'
import { createFollowerState, createState } from '@/editor/create'
import { EDITOR_HINT_DELAY, hoverHints } from '@/editor/hoverHints'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const tip = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[data-hover-hint]')

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

async function mountBroken(): Promise<{ view: EditorView; link: HTMLElement }> {
  const status = new LinkStatus((hrefs) => Promise.resolve(hrefs.map(() => true)))
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({
    state: createState('See [gone](gone.md) here.', [
      linkStatus.of(status),
      brokenLinks(),
      hoverHints(),
    ]),
    parent,
  })
  ensureSyntaxTree(view.state, view.state.doc.length, 5000)
  views.push(view)
  await wait(CHECK_DELAY_MS + 50)
  const link = view.contentDOM.querySelector<HTMLElement>('.cm-md-link-broken')
  if (link === null) throw new Error('no broken link drawn')
  return { view, link }
}
const over = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
}

describe('the hint on a broken link', () => {
  it('is data, not a native title', async () => {
    const { link } = await mountBroken()
    expect(link.getAttribute('data-hint')).toBe('Missing file')
    expect(link.hasAttribute('title')).toBe(false)
  })

  it('shows after the wait, in the shadcn tooltip look, with an arrow', async () => {
    const { link } = await mountBroken()
    over(link)
    await wait(EDITOR_HINT_DELAY - 150)
    expect(tip()).toBeNull()
    await wait(250)
    expect(tip()?.textContent).toBe('Missing file')
    // The look (popover colors, ring, shadow) is the `.editor-hint` rules in styles/tokens.css.
    expect(tip()?.classList.contains('editor-hint')).toBe(true)
    expect(tip()?.querySelector('.editor-hint-arrow')).not.toBeNull()
  })

  it('is drawn at the pointer, not at the hovered thing', async () => {
    const { view, link } = await mountBroken()
    const at = (type: string, x: number, y: number): void => {
      link.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }))
    }
    // The pointer moves on while the wait runs; the hint goes where it ended up.
    at('pointerover', 40, 60)
    at('pointermove', 300, 200)
    await wait(EDITOR_HINT_DELAY + 100)
    const arrow = (): HTMLElement | null => tip()?.querySelector('.editor-hint-arrow') ?? null
    // jsdom measures every box as 0 x 0, so the hint sits GAP above the point, centred on it.
    expect(tip()?.style.left).toBe('300px')
    expect(tip()?.style.top).toBe('192px')
    expect(arrow()?.dataset.side).toBe('above')
    expect(arrow()?.style.left).toBe('0px')
    // Too near the top edge for room above: it goes below the pointer instead.
    view.dom.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    link.dispatchEvent(
      new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
    )
    at('pointerover', 120, 3)
    await wait(EDITOR_HINT_DELAY + 100)
    expect(tip()?.style.top).toBe('25px')
    expect(arrow()?.dataset.side).toBe('below')
  })

  it('goes when the pointer leaves, on a press, on a key and on an edit', async () => {
    const { view, link } = await mountBroken()
    const reshow = async (): Promise<void> => {
      over(link)
      await wait(EDITOR_HINT_DELAY + 100)
      expect(tip()).not.toBeNull()
    }
    await reshow()
    link.dispatchEvent(
      new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
    )
    expect(tip()).toBeNull()
    await reshow()
    view.dom.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(tip()).toBeNull()
    await reshow()
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }))
    expect(tip()).toBeNull()
    await reshow()
    view.dispatch({ changes: { from: 0, insert: 'x' } })
    expect(tip()).toBeNull()
  })

  it('never shows if the pointer leaves before the wait is over', async () => {
    const { link } = await mountBroken()
    over(link)
    link.dispatchEvent(
      new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
    )
    await wait(EDITOR_HINT_DELAY + 100)
    expect(tip()).toBeNull()
  })

  it('is removed with the view', async () => {
    const { view, link } = await mountBroken()
    over(link)
    await wait(EDITOR_HINT_DELAY + 100)
    view.destroy()
    expect(tip()).toBeNull()
  })
})

describe('the editor a tab shows', () => {
  it('has the hints without being given them (the wiring a real window uses)', async () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      state: createFollowerState({ doc: Text.of(['text']) }),
      parent,
    })
    views.push(view)
    const thing = document.createElement('span')
    thing.dataset.hint = 'Something'
    view.dom.append(thing)
    over(thing)
    await wait(EDITOR_HINT_DELAY + 100)
    expect(tip()?.textContent).toBe('Something')
  })
})
