// @vitest-environment jsdom
/**
 * Drop to open (P6-T3), from the page's side: ISC-200 (files dropped on a pane open in tabs in
 * that pane), ISC-201 (an image dropped outside a document's text opens an image tab) and
 * ISC-202's page half (a path no native drop delivered opens nothing). Rust's half is
 * `pnpm test:rust drop_paths_only`. A native drop is simulated by the mock host, which records the
 * paths as Rust's drop record does; the pane under the pointer is found through `data-pane-id`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { problem, resetDocuments } from '@/documents/store'
import { handleDrop, installFileDrop } from '@/features/drop'
import { resetTree, restoreWorkspace, workspaceRoots } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { findPane } from '@/workbench/splitTree'
import {
  imageTabs,
  resetWorkbench,
  splitActivePane,
  tabRecord,
  tabTitle,
  workbenchLayout,
} from '@/workbench/store'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 4; round++) await settle()
}

const FILES: Record<string, string> = {
  '/in/a.md': '# a',
  '/in/b.txt': 'b',
  '/in/c.png': 'png',
  '/in/folder/x.md': 'x',
  '/never/secret.md': 'never dropped',
}

let host: MockHost
let hit: Element | null = null

/** An element inside a pane, as the drop handler reads it. */
function inPane(paneId: string, inner?: string): Element {
  const pane = document.createElement('section')
  pane.dataset.paneId = paneId
  document.body.append(pane)
  if (inner === undefined) return pane
  const child = document.createElement('div')
  child.className = inner
  pane.append(child)
  return child
}

async function start(listen = true): Promise<void> {
  host = createMockHost({ files: FILES, roots: ['/ws'] })
  setHost(host)
  if (listen) await installFileDrop()
  document.elementFromPoint = () => hit
}

function dropOn(target: Element | null, paths: string[]): Promise<void> {
  hit = target
  host.simulateDrop(paths, { x: 5, y: 5 })
  return flush()
}

/** The tabs of a pane, by file name. */
function tabNames(paneId: string): string[] {
  return (findPane(workbenchLayout.value, paneId)?.tabs ?? []).map((tab) => tabTitle(tab))
}

beforeEach(() => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  problem.value = null
})

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(document, 'elementFromPoint')
  hit = null
  setHost(undefined)
  resetTree()
  resetWorkbench()
  resetDocuments()
  vi.restoreAllMocks()
})

describe('files dropped on a pane (ISC-200)', () => {
  it('open in tabs in the pane they landed on, not the active one', async () => {
    await start()
    splitActivePane('row')
    const layout = workbenchLayout.value
    const [left, right] = (function leaves(node: typeof layout.root): string[] {
      return node.kind === 'pane' ? [node.id] : node.children.flatMap(leaves)
    })(layout.root)
    if (left === undefined || right === undefined) throw new Error('two panes expected')
    // The left pane is the active one; the drop lands on the right.
    expect(layout.activePane).toBe(right)
    await dropOn(inPane(left), ['/in/a.md', '/in/b.txt'])
    expect(tabNames(left)).toEqual(['a.md', 'b.txt'])
    expect(tabNames(right)).toEqual([])
  })

  it('open in the active pane when they land outside every pane', async () => {
    await start()
    await dropOn(document.body, ['/in/a.md'])
    const active = workbenchLayout.value.activePane
    expect(tabNames(active)).toEqual(['a.md'])
  })

  it('open a second tab on a document another pane already shows, and focus it when the pane has one', async () => {
    await start()
    splitActivePane('row')
    const leaves = (node: typeof workbenchLayout.value.root): string[] =>
      node.kind === 'pane' ? [node.id] : node.children.flatMap(leaves)
    const [left, right] = leaves(workbenchLayout.value.root)
    if (left === undefined || right === undefined) throw new Error('two panes expected')
    await dropOn(inPane(left), ['/in/a.md'])
    await dropOn(inPane(right), ['/in/a.md'])
    expect(tabNames(left)).toEqual(['a.md'])
    expect(tabNames(right)).toEqual(['a.md'])
    await dropOn(inPane(right), ['/in/a.md'])
    expect(tabNames(right)).toEqual(['a.md'])
  })

  it('open as text when they are not Markdown', async () => {
    await start()
    await dropOn(document.body, ['/in/b.txt'])
    const tab = findPane(workbenchLayout.value, workbenchLayout.value.activePane)?.tabs[0]
    expect(tab === undefined ? undefined : tabRecord(tab)?.kind).toBe('text')
  })
})

describe('an image dropped from Explorer (ISC-201)', () => {
  it('opens an image tab on the tab strip or any part of a pane that is not text', async () => {
    await start()
    const strip = inPane(workbenchLayout.value.activePane)
    await dropOn(strip, ['/in/c.png'])
    expect(imageTabs()).toHaveLength(1)
    expect(imageTabs()[0]?.[1]).toMatchObject({ kind: 'image', path: '/in/c.png' })
  })

  it("opens a tab when the text it lands on is no editor's (a drop onto a real view links instead: dropImage.test.ts)", async () => {
    await start()
    await dropOn(inPane(workbenchLayout.value.activePane, 'cm-content'), ['/in/c.png'])
    expect(imageTabs()).toHaveLength(1)
    expect(problem.value).toBeNull()
  })

  it("still opens a Markdown file dropped over a document's text", async () => {
    await start()
    await dropOn(inPane(workbenchLayout.value.activePane, 'cm-content'), ['/in/a.md'])
    expect(tabNames(workbenchLayout.value.activePane)).toEqual(['a.md'])
  })
})

describe('what a drop must still do', () => {
  it('opens nothing for a path no native drop delivered, and says so', async () => {
    await start()
    hit = document.body
    await handleDrop(['/never/secret.md'], { x: 5, y: 5 })
    expect(tabNames(workbenchLayout.value.activePane)).toEqual([])
    expect(problem.value).toMatch(/Could not use the dropped files/)
  })

  it('opens none of a drop that mixes one delivered path with one that was not', async () => {
    await start(false)
    // Rust's record learns the first path; nothing listens, so nothing opens yet.
    host.simulateDrop(['/in/a.md'], { x: 5, y: 5 })
    hit = document.body
    await handleDrop(['/in/a.md', '/never/secret.md'], { x: 5, y: 5 })
    await flush()
    expect(tabNames(workbenchLayout.value.activePane)).toEqual([])
  })

  it('still makes a dropped folder a root, and opens its sibling file in the same drop', async () => {
    await start()
    await restoreWorkspace([])
    await dropOn(document.body, ['/in/folder', '/in/a.md'])
    expect(workspaceRoots.value).toContain('/in/folder')
    expect(tabNames(workbenchLayout.value.activePane)).toEqual(['a.md'])
  })
})
