// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { followerOfTab, openPath, resetDocuments } from '@/documents/store'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'

beforeEach(() => {
  setHost(
    createMockHost({
      files: { 'C:/notes/a.md': '# A\n\nfirst\n', 'C:/notes/b.md': '# B\n\nsecond\n' },
    }),
  )
  resetWorkbench()
  resetDocuments()
})

afterEach(() => {
  resetWorkbench()
  resetDocuments()
  setHost(undefined)
})

interface Target {
  range: { head: number }
  y: string
}

/** The scroll effect a `show` dispatches into the view, as a plain description. */
function shownWith(view: EditorView, show: () => void): Target[] {
  const seen: Target[] = []
  const dispatch = view.dispatch.bind(view)
  view.dispatch = ((...specs: Parameters<EditorView['dispatch']>) => {
    for (const spec of specs) {
      const effects = 'effects' in spec ? [spec.effects].flat() : []
      for (const effect of effects) {
        if (effect !== undefined) seen.push(effect.value as Target)
      }
    }
    dispatch(...specs)
  }) as EditorView['dispatch']
  show()
  view.dispatch = dispatch
  return seen
}

function mounted(): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  return new EditorView({ parent })
}

describe('a tab keeps its own scroll position (ISC-245)', () => {
  it('a tab shown for the first time starts at its caret, not where the tab before it was scrolled', async () => {
    const a = followerOfTab(await openPath('C:/notes/a.md'))
    const b = followerOfTab(await openPath('C:/notes/b.md'))
    if (a === undefined || b === undefined) throw new Error('no follower')
    const view = mounted()
    a.show(view)
    // The pane's one view is scrolled down while A is on screen.
    vi.spyOn(view, 'scrollSnapshot').mockReturnValue(
      EditorView.scrollIntoView(9999, { y: 'start' }),
    )
    a.park()
    const seen = shownWith(view, () => b.show(view))
    expect(seen).toHaveLength(1)
    expect(seen[0].range.head).toBe(0)
    expect(seen[0].y).toBe('center')
    b.park()
    view.destroy()
  })

  it('a tab that was shown before goes back to where it was', async () => {
    const a = followerOfTab(await openPath('C:/notes/a.md'))
    if (a === undefined) throw new Error('no follower')
    const view = mounted()
    a.show(view)
    vi.spyOn(view, 'scrollSnapshot').mockReturnValue(EditorView.scrollIntoView(7, { y: 'start' }))
    a.park()
    const seen = shownWith(view, () => a.show(view))
    expect(seen).toHaveLength(1)
    expect(seen[0].range.head).toBe(7)
    expect(seen[0].y).toBe('start')
    a.park()
    view.destroy()
  })

  it('the remembered place moves with the text when something is typed above it while parked', async () => {
    const a = followerOfTab(await openPath('C:/notes/a.md'))
    if (a === undefined) throw new Error('no follower')
    const view = mounted()
    a.show(view)
    vi.spyOn(view, 'scrollSnapshot').mockReturnValue(EditorView.scrollIntoView(7, { y: 'start' }))
    a.park()
    a.dispatch({ changes: { from: 0, insert: '12345' } })
    const seen = shownWith(view, () => a.show(view))
    expect(seen[0].range.head).toBe(12)
    a.park()
    view.destroy()
  })

  it('a jump into a tab still wins over the remembered place', async () => {
    const a = followerOfTab(await openPath('C:/notes/a.md'))
    if (a === undefined) throw new Error('no follower')
    const view = mounted()
    a.show(view)
    vi.spyOn(view, 'scrollSnapshot').mockReturnValue(EditorView.scrollIntoView(2, { y: 'start' }))
    a.park()
    a.reveal(8)
    const seen = shownWith(view, () => a.show(view))
    expect(seen).toHaveLength(1)
    expect(seen[0].range.head).toBe(8)
    a.park()
    view.destroy()
  })
})
