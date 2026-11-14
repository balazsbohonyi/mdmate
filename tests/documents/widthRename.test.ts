// @vitest-environment jsdom
/**
 * A tab keeps the whole width while it is one of the app's own JSON files, and that follows the
 * file's name: a rename to or from settings.json takes effect with no reopening (ISC-442; the
 * extension itself is tested in tests/editor/contentWidth.test.ts).
 */
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  documentMoved,
  documentOfTab,
  followerOfTab,
  openPath,
  resetDocuments,
} from '@/documents/store'
import { FULL_WIDTH_CLASS } from '@/editor/documentWidth'
import { resetSettings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'

const views: EditorView[] = []

function showing(tab: string): EditorView {
  const follower = followerOfTab(tab)
  if (follower === undefined) throw new Error(`no follower for ${tab}`)
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({ parent, state: follower.state })
  views.push(view)
  return view
}

beforeEach(() => {
  setHost(createMockHost({ files: { '/w/notes.md': '# notes\n', '/w/settings.json': '{}\n' } }))
  resetWorkbench()
  resetDocuments()
})

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  resetWorkbench()
  resetDocuments()
  resetSettings()
  setHost(undefined)
})

describe('the whole width follows the tab name', () => {
  it('has it from the start for settings.json, and not for an ordinary file', async () => {
    expect(showing(await openPath('/w/settings.json')).dom.classList).toContain(FULL_WIDTH_CLASS)
    expect(showing(await openPath('/w/notes.md')).dom.classList).not.toContain(FULL_WIDTH_CLASS)
  })

  it('a rename to settings.json gives it, and a rename away takes it off', async () => {
    const tab = await openPath('/w/notes.md')
    const doc = documentOfTab(tab)
    if (doc === undefined) throw new Error('no document')
    const view = showing(tab)
    expect(view.dom.classList).not.toContain(FULL_WIDTH_CLASS)

    documentMoved(doc.id, '/w/keybindings.json')
    expect(view.dom.classList).toContain(FULL_WIDTH_CLASS)

    documentMoved(doc.id, '/w/notes.md')
    expect(view.dom.classList).not.toContain(FULL_WIDTH_CLASS)
  })
})
