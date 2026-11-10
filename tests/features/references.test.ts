// @vitest-environment jsdom
/**
 * Find File References (P6-T9): ISC-218. The list over a fixture workspace is written out by hand
 * below. The search itself is Rust's and is proven against its own fixtures in
 * `src-tauri/src/links/references.rs`; the mock host here reads plain inline links only, so these
 * tests prove the page: what it asks, what it shows and where a click lands.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import {
  allDocuments,
  documentOfTab,
  followerOfTab,
  openPath,
  problem,
  resetDocuments,
} from '@/documents/store'
import ReferencesPanel from '@/features/references/ReferencesPanel.vue'
import {
  closeReferences,
  findFileReferences,
  openReference,
  referencesState,
  resetReferences,
} from '@/features/references/store'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import { setHost, type ReferencesFound } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { resetSidebar, sidebarPanel } from '@/workbench/sidebar'
import { allTabs } from '@/workbench/splitTree'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

const TARGET = '/work/docs/target.md'

const FILES: Record<string, string> = {
  [TARGET]: '# target\n\nme [me](target.md)\n',
  '/work/index.md':
    '# Index\n[a](docs/target.md)\n![i](docs/target.md#top)\n[other](docs/other.md)\n[web](https://example.com/docs/target.md)\nlast [t](docs/target.md) and more\n',
  '/work/docs/sub/deep.md': '[up](../target.md)\n[dot](./../target.md)\n[sibling](../other.md)\n',
  '/work/docs/notes.txt': 'see [t](target.md)\n',
  '/work/docs/other.md': 'nothing links anywhere\n',
  '/work/pic.png': 'png',
  '/work/gallery.md': 'a picture ![p](pic.png)\n',
}

/** Every link that leads to TARGET, by file and line, as the fixture above is written. */
const EXPECTED = [
  '/work/docs/notes.txt:1',
  '/work/docs/sub/deep.md:1',
  '/work/docs/sub/deep.md:2',
  '/work/docs/target.md:3',
  '/work/index.md:2',
  '/work/index.md:3',
  '/work/index.md:6',
]

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined

async function start(): Promise<void> {
  host = createMockHost({ files: FILES, roots: ['/work'] })
  setHost(host)
  await restoreWorkspace([])
  await flush()
}

function listed(): string[] {
  const state = referencesState.value
  if (state?.phase !== 'done') throw new Error(`the search is ${state?.phase ?? 'not made'}`)
  return state.found.references.map((reference) => `${reference.path}:${String(reference.line)}`)
}

function mountPanel(): HTMLElement {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(ReferencesPanel)
  app.mount(root)
  mounted = { app, root }
  return root
}

beforeEach(() => {
  resetTree()
  resetWorkbench()
  resetDocuments()
  resetSidebar()
  resetReferences()
  problem.value = null
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  setHost(undefined)
  resetTree()
  resetSidebar()
})

describe('Find File References (ISC-218)', () => {
  it('lists every file and line that links to the file', async () => {
    await start()
    await findFileReferences(TARGET)
    expect(listed()).toEqual(EXPECTED)
    const state = referencesState.value
    if (state?.phase !== 'done') throw new Error('not done')
    expect(state.found.files).toBe(4)
    expect(sidebarPanel.value).toBe('references')
  })

  it('does not list a link to another file, a web address or a different folder', async () => {
    await start()
    await findFileReferences('/work/docs/other.md')
    // index.md line 4 and deep.md line 3 link to it; the web address and the others do not.
    expect(listed()).toEqual(['/work/docs/sub/deep.md:3', '/work/index.md:4'])
  })

  it('finds the links to an image', async () => {
    await start()
    await findFileReferences('/work/pic.png')
    expect(listed()).toEqual(['/work/gallery.md:1'])
  })

  it('says so when nothing links to the file', async () => {
    await start()
    await findFileReferences('/work/gallery.md')
    expect(listed()).toEqual([])
    const root = mountPanel()
    await flush()
    expect(root.querySelector('[data-references-summary]')?.textContent?.trim()).toBe(
      'No file links to this one.',
    )
  })

  it('reads an open document with unsaved edits as the editor holds it', async () => {
    await start()
    const tab = await openPath('/work/index.md')
    followerOfTab(tab)?.dispatch({ changes: { from: 0, insert: '\n\n' } })
    await findFileReferences(TARGET)
    // Two lines were added above the links, so index.md's lines moved down by two.
    expect(listed().filter((entry) => entry.startsWith('/work/index.md'))).toEqual([
      '/work/index.md:4',
      '/work/index.md:5',
      '/work/index.md:8',
    ])
  })

  it('shows the newest search when an older one answers late', async () => {
    await start()
    const real = host.findReferences.bind(host)
    let releaseSlow: (() => void) | undefined
    host.findReferences = async (path, buffers) => {
      if (path === TARGET) {
        await new Promise<void>((resolve) => {
          releaseSlow = resolve
        })
      }
      return real(path, buffers)
    }
    const slow = findFileReferences(TARGET)
    await flush()
    await findFileReferences('/work/pic.png')
    releaseSlow?.()
    await slow
    await flush()
    const state = referencesState.value
    expect(state?.phase === 'done' && state.target).toBe('/work/pic.png')
  })

  it('shows why a search failed', async () => {
    await start()
    host.findReferences = () => Promise.reject(new Error('the disk went away'))
    await findFileReferences(TARGET)
    const state = referencesState.value
    expect(state?.phase).toBe('failed')
    const root = mountPanel()
    await flush()
    expect(root.querySelector('[data-references-summary]')?.textContent).toContain(
      'the disk went away',
    )
  })

  it('closing the list goes back to the folders', async () => {
    await start()
    await findFileReferences(TARGET)
    closeReferences()
    expect(referencesState.value).toBeNull()
    expect(sidebarPanel.value).toBe('folders')
  })
})

describe('opening a reference', () => {
  it('opens the file and puts the caret on the link', async () => {
    await start()
    await findFileReferences(TARGET)
    const state = referencesState.value
    if (state?.phase !== 'done') throw new Error('not done')
    const reference = state.found.references.find(
      (item) => item.path === '/work/index.md' && item.line === 6,
    )
    if (reference === undefined) throw new Error('the reference is not listed')
    await openReference(reference)
    const tab = allTabs(workbenchLayout.value).at(-1) ?? ''
    expect(documentOfTab(tab)?.path).toBe('/work/index.md')
    const follower = followerOfTab(tab)
    const text = follower?.state.doc.toString() ?? ''
    // "last [t](" is nine characters, so the caret is at the start of docs/target.md on line 6.
    expect(follower?.state.selection.main.head).toBe(text.indexOf('last [t]') + 9)
  })

  it('opens a file that is already open without opening it twice', async () => {
    await start()
    const tab = await openPath('/work/index.md')
    await findFileReferences(TARGET)
    const state = referencesState.value
    if (state?.phase !== 'done') throw new Error('not done')
    const reference = state.found.references.find((item) => item.path === '/work/index.md')
    if (reference === undefined) throw new Error('the reference is not listed')
    await openReference(reference)
    expect(allTabs(workbenchLayout.value)).toEqual([tab])
    expect(allDocuments()).toHaveLength(1)
  })

  it('keeps the caret inside the line when the file changed since the search', async () => {
    await start()
    const tab = await openPath('/work/gallery.md')
    followerOfTab(tab)?.dispatch({
      changes: {
        from: 0,
        to: followerOfTab(tab)?.state.doc.length ?? 0,
        insert: 'short\nsecond line\nthird',
      },
    })
    // The file has three lines now; a column far past the end of line 1 stays on line 1.
    await openReference({ path: '/work/gallery.md', line: 1, column: 90, text: 'old' })
    expect(followerOfTab(tab)?.state.selection.main.head).toBe(5)
    // A line past the end of the file is the last line.
    await openReference({ path: '/work/gallery.md', line: 40, column: 2, text: 'old' })
    expect(followerOfTab(tab)?.state.selection.main.head).toBe('short\nsecond line\n'.length + 2)
  })

  it('says so when the file cannot be opened', async () => {
    await start()
    await openReference({ path: '/work/gone.md', line: 1, column: 0, text: 'x' })
    expect(problem.value).toContain('Could not open /work/gone.md')
  })
})

describe('the References panel', () => {
  it('groups the links by file with the line and its text', async () => {
    await start()
    await findFileReferences(TARGET)
    const root = mountPanel()
    await flush()
    expect(root.querySelector('[data-references-summary]')?.textContent?.trim()).toBe(
      '7 links in 4 files',
    )
    const files = [...root.querySelectorAll('[data-references-file]')]
    expect(files).toHaveLength(4)
    const index = files.find((file) => file.textContent.includes('index.md'))
    const rows = [...(index?.querySelectorAll('[data-reference]') ?? [])]
    expect(rows.map((row) => row.getAttribute('data-line'))).toEqual(['2', '3', '6'])
    expect(rows[2]?.textContent).toContain('last [t](docs/target.md) and more')
  })

  it('opens the file when a row is clicked', async () => {
    await start()
    await findFileReferences(TARGET)
    const root = mountPanel()
    await flush()
    const row = root.querySelector<HTMLElement>('[data-reference][data-line="1"]')
    row?.click()
    await flush()
    const tab = allTabs(workbenchLayout.value).at(-1) ?? ''
    expect(documentOfTab(tab)?.path).toBe('/work/docs/notes.txt')
  })

  it('says when the list was cut or files could not be checked', async () => {
    await start()
    const answer: ReferencesFound = {
      references: [{ path: '/work/a.md', line: 1, column: 0, text: 'x' }],
      files: 1,
      scanned: 3,
      skipped: [{ path: '/work/old.txt', reason: 'its encoding is not one mdmate writes' }],
      truncated: true,
    }
    await start()
    host.findReferences = () => Promise.resolve(answer)
    await findFileReferences(TARGET)
    const root = mountPanel()
    await flush()
    expect(root.querySelector('[data-references-truncated]')?.textContent).toContain('more')
    expect(root.querySelector('[data-references-skipped]')?.textContent).toContain(
      '1 file could not be checked',
    )
  })
})
