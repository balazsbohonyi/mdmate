import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { docMeta } from '@/documents/meta'
import {
  activeDocument,
  canSaveActive,
  documentOfTab,
  followerOfTab,
  openPath,
  pendingClose,
  requestCloseTab,
  resetDocuments,
  resolvePendingClose,
  saveDocument,
} from '@/documents/store'
import { suggestedFileName } from '@/documents/suggest'
import { newUntitledTab, resetUntitled } from '@/documents/untitled'
import { openFolderDialog, resetTree } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { clearCommands, isCommandEnabled, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { allTabs, panesOf } from '@/workbench/splitTree'
import { resetWorkbench, splitActivePane, tabTitle, workbenchLayout } from '@/workbench/store'
import { toasts } from '../helpers/toasts'

const A = 'C:/notes/a.md'
const OTHER = 'D:/elsewhere/x.md'

let host: MockHost
let picked: string | null
let removeCommands: () => void

/** The tab the last `newUntitledTab` made: the active one. */
function activeTab(): string {
  const layout = workbenchLayout.value
  const pane = layout.root.kind === 'pane' ? layout.root : undefined
  const tab = pane?.activeTab
  if (tab === null || tab === undefined) throw new Error('no active tab')
  return tab
}

function type(tab: string, text: string): void {
  const follower = followerOfTab(tab)
  if (follower === undefined) throw new Error('no document')
  follower.dispatch({ changes: { from: follower.state.doc.length, insert: text } })
}

beforeEach(() => {
  picked = null
  host = createMockHost({
    files: { [A]: '# A\n', [OTHER]: 'x\n' },
    pickFolder: () => 'C:/notes',
    pickSave: () => picked,
  })
  setHost(host)
  resetWorkbench()
  resetDocuments()
  resetUntitled()
  resetTree()
  clearCommands()
  removeCommands = registerDefaultCommands()
})

afterEach(() => {
  removeCommands()
  clearCommands()
  resetTree()
  resetWorkbench()
  resetDocuments()
  setHost(undefined)
})

describe('the new-file command', () => {
  it('opens an empty untitled Markdown tab and makes it the active one', async () => {
    await runCommand(COMMAND_IDS.newFile)
    const tab = activeTab()
    expect(tabTitle(tab)).toBe('Untitled-1')
    const doc = documentOfTab(tab)
    expect(doc?.untitled).toBe(true)
    expect(doc?.kind).toBe('markdown')
    expect(doc?.master.doc.toString()).toBe('')
    expect(docMeta(doc?.id ?? -1)).toMatchObject({ untitled: true, dirty: false, path: '' })
    expect(activeDocument()).toBe(doc)
  })

  it('numbers the tabs through the session and never reuses a number', async () => {
    await newUntitledTab()
    const first = activeTab()
    await newUntitledTab()
    expect(tabTitle(activeTab())).toBe('Untitled-2')
    requestCloseTab(first)
    await newUntitledTab()
    expect(tabTitle(activeTab())).toBe('Untitled-3')
  })

  it('opens in the pane it is told to, not only the focused one (the + of a tab strip, ISC-247)', async () => {
    await openPath(A)
    splitActivePane('row')
    const [left, right] = panesOf(workbenchLayout.value)
    expect(workbenchLayout.value.activePane).toBe(right?.id)
    await newUntitledTab(left?.id)
    const [leftNow, rightNow] = panesOf(workbenchLayout.value)
    const titles = (tabs: readonly string[] | undefined) => tabs?.map(tabTitle) ?? []
    expect(titles(leftNow?.tabs)).toContain('Untitled-1')
    expect(titles(rightNow?.tabs)).not.toContain('Untitled-1')
    expect(tabTitle(leftNow?.activeTab ?? '')).toBe('Untitled-1')
  })

  it('is a document Rust knows by id only: no file listing, no path', async () => {
    await newUntitledTab()
    expect(host.openDocuments().size).toBe(0)
  })
})

describe('the first save', () => {
  it('shows the save dialog, writes the buffer, and the tab becomes that file', async () => {
    await newUntitledTab()
    const tab = activeTab()
    type(tab, '# Meeting notes\n\nbody\n')
    picked = 'C:/notes/meeting-notes.md'
    const doc = documentOfTab(tab)!
    expect(await saveDocument(doc.id)).toBe(true)

    expect(host.files.read(picked)).toBe('# Meeting notes\n\nbody\n')
    expect(tabTitle(tab)).toBe('meeting-notes.md')
    expect(doc.path).toBe(picked)
    expect(doc.untitled).toBe(false)
    expect(docMeta(doc.id)).toMatchObject({ untitled: false, dirty: false, saveError: null })
    // From now on it is an ordinary document: the next save goes to the same file.
    type(tab, 'more\n')
    expect(await saveDocument(doc.id)).toBe(true)
    expect(host.files.read(picked)).toBe('# Meeting notes\n\nbody\nmore\n')
    expect(host.saveDialogs).toHaveLength(1)
  })

  it('writes nothing and keeps the buffer when the dialog is cancelled', async () => {
    await newUntitledTab()
    const tab = activeTab()
    type(tab, 'draft')
    const doc = documentOfTab(tab)!
    expect(await saveDocument(doc.id)).toBe(false)
    expect(host.files.paths().sort()).toEqual([OTHER, A].sort())
    expect(doc.untitled).toBe(true)
    expect(docMeta(doc.id)).toMatchObject({ dirty: true, saveError: null })
    expect(tabTitle(tab)).toBe('Untitled-1')
  })

  it('is offered even for an empty tab: Save is enabled, and asks where', async () => {
    await newUntitledTab()
    expect(canSaveActive()).toBe(true)
    expect(isCommandEnabled(COMMAND_IDS.save)).toBe(true)
    await runCommand(COMMAND_IDS.save)
    expect(host.saveDialogs).toHaveLength(1)
  })

  it('suggests the name from the first heading and starts in the workspace folder', async () => {
    await openFolderDialog()
    await openPath(A)
    // The last file opened is outside the workspace; the workspace folder still wins.
    await openPath(OTHER)
    await newUntitledTab()
    type(activeTab(), '# Meeting notes\n')
    await runCommand(COMMAND_IDS.save)
    expect(host.saveDialogs[0]).toEqual({ name: 'meeting-notes.md', folder: 'C:/notes' })
  })

  it('starts in the folder of the last file opened when no workspace folder holds the open files', async () => {
    await openPath(OTHER)
    await newUntitledTab()
    await runCommand(COMMAND_IDS.save)
    expect(host.saveDialogs[0]).toEqual({ name: 'Untitled.md', folder: 'D:/elsewhere' })
  })

  it('leaves the folder to the system before any file was opened', async () => {
    await newUntitledTab()
    await runCommand(COMMAND_IDS.save)
    expect(host.saveDialogs[0]).toEqual({ name: 'Untitled.md', folder: null })
  })

  it('puts a name with no extension in .md and never replaces a file for it', async () => {
    await newUntitledTab()
    const tab = activeTab()
    type(tab, 'hello\n')
    picked = 'C:/notes/plain'
    await saveDocument(documentOfTab(tab)!.id)
    expect(host.files.read('C:/notes/plain.md')).toBe('hello\n')

    await newUntitledTab()
    const second = activeTab()
    type(second, 'other\n')
    const doc = documentOfTab(second)!
    expect(await saveDocument(doc.id)).toBe(false)
    expect(docMeta(doc.id)?.saveError).toMatch(/already exists/)
    expect(host.files.read('C:/notes/plain.md')).toBe('hello\n')
    expect(doc.untitled).toBe(true)
  })
})

describe('the name suggestion', () => {
  it.each([
    ['# Meeting notes\n\nbody', 'meeting-notes.md'],
    ['intro\n\n## Second  heading!\n', 'second-heading.md'],
    ['# Árvíztűrő tükörfúrógép\n', 'árvíztűrő-tükörfúrógép.md'],
    ['# Closing hashes ##\n', 'closing-hashes.md'],
    ['# C++ & Rust: a comparison\n', 'c-rust-a-comparison.md'],
    ['no heading here\n', 'Untitled.md'],
    ['', 'Untitled.md'],
    ['#hashtag is not a heading\n', 'Untitled.md'],
    ['#\n', 'Untitled.md'],
    ['# !!!\n', 'Untitled.md'],
    ['```\n# inside a fence\n```\n', 'Untitled.md'],
    ['```\n# inside a fence\n```\n# after it\n', 'after-it.md'],
  ])('turns %j into %s', (text, name) => {
    expect(suggestedFileName(text)).toBe(name)
  })

  it('keeps a long heading to a name Windows accepts', () => {
    const name = suggestedFileName(`# ${'word '.repeat(60)}\n`)
    expect(name.endsWith('.md')).toBe(true)
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name).not.toMatch(/-\.md$/)
  })
})

describe('closing an untitled tab', () => {
  it('closes an empty one at once', async () => {
    await newUntitledTab()
    requestCloseTab(activeTab())
    expect(allTabs(workbenchLayout.value)).toEqual([])
    expect(pendingClose.value).toBeNull()
  })

  it('asks about one with text, like any edited tab, and Save runs the dialog', async () => {
    await newUntitledTab()
    const tab = activeTab()
    type(tab, 'precious')
    requestCloseTab(tab)
    expect(pendingClose.value?.tabId).toBe(tab)
    expect(allTabs(workbenchLayout.value)).toEqual([tab])

    // The user picks a file, so the document is saved and the tab closes.
    picked = 'C:/notes/precious.md'
    await resolvePendingClose('save')
    expect(host.files.read(picked)).toBe('precious')
    expect(allTabs(workbenchLayout.value)).toEqual([])
  })

  it('keeps asking when the user cancels the save dialog, and Discard drops the text', async () => {
    await newUntitledTab()
    const tab = activeTab()
    type(tab, 'precious')
    requestCloseTab(tab)
    await resolvePendingClose('save') // the dialog is cancelled
    expect(pendingClose.value?.tabId).toBe(tab)
    expect(allTabs(workbenchLayout.value)).toEqual([tab])
    await resolvePendingClose('discard')
    expect(allTabs(workbenchLayout.value)).toEqual([])
    expect(host.files.paths()).toHaveLength(2)
  })
})

describe('F2', () => {
  it('acts as Save As on an untitled tab', async () => {
    await newUntitledTab()
    type(activeTab(), 'x')
    picked = 'C:/notes/named.md'
    expect(isCommandEnabled(COMMAND_IDS.rename)).toBe(true)
    await runCommand(COMMAND_IDS.rename)
    expect(host.files.read(picked)).toBe('x')
  })

  it('is not offered on a file that is on disk (P6-T9 renames those)', async () => {
    await openPath(A)
    expect(isCommandEnabled(COMMAND_IDS.rename)).toBe(false)
  })
})

describe('Open Recent', () => {
  it('never lists an untitled tab, and lists the file once it has been saved', async () => {
    await newUntitledTab()
    type(activeTab(), 'x')
    expect(host.recent.files).toEqual([])
    picked = 'C:/notes/saved.md'
    await runCommand(COMMAND_IDS.save)
    expect(host.recent.files).toEqual([picked])
    expect(toasts.last).toBeNull()
  })
})
