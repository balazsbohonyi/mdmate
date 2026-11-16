// @vitest-environment jsdom
/**
 * Colors for a non-Markdown file follow the file's name: a rename to another extension changes them
 * with no reopening (the plugin itself is tested in tests/editor/sourceLanguage.test.ts).
 */
import { syntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  documentMoved,
  documentOfTab,
  followerOfTab,
  openPath,
  resetDocuments,
} from '@/documents/store'
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
  setHost(
    createMockHost({
      files: {
        '/w/notes.txt': '{ "theme": "light", "size": 15 }\n',
        '/w/data.json': '{ "theme": "light", "size": 15 }\n',
      },
    }),
  )
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

describe('colors for a plain-source file follow its name', () => {
  it('colors a .json file when it opens, and leaves a .txt file plain', async () => {
    const json = showing(await openPath('/w/data.json'))
    await expect.poll(() => syntaxTree(json.state).length, { timeout: 5000 }).toBeGreaterThan(0)
    const txt = showing(await openPath('/w/notes.txt'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(syntaxTree(txt.state).length).toBe(0)
  })

  it('renaming notes.txt to notes.json colors it, and renaming it back takes the colors off', async () => {
    const tab = await openPath('/w/notes.txt')
    const doc = documentOfTab(tab)
    if (doc === undefined) throw new Error('no document')
    const view = showing(tab)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(syntaxTree(view.state).length).toBe(0)

    documentMoved(doc.id, '/w/notes.json')
    await expect.poll(() => syntaxTree(view.state).length, { timeout: 5000 }).toBeGreaterThan(0)

    documentMoved(doc.id, '/w/notes.txt')
    await expect.poll(() => syntaxTree(view.state).length, { timeout: 5000 }).toBe(0)
  })
})
