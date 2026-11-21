// @vitest-environment jsdom
/**
 * Git colours in the tree (P9.1-T28): ISC-656 (what each status looks like, and what a folder
 * takes from what is in it), ISC-657 (what asks Rust again, debounced, newest answer wins), ISC-658
 * (several repositories under one root) and ISC-659 (git off or missing: nothing coloured, nothing
 * said). The rules are tested on the index first, with no page, then through the real tree.
 *
 * The mock host answers `gitStatus` with what a test gives it, and answers empty while the
 * settings it was last given have git off, as Rust does. Timers are faked for `setTimeout` only,
 * so the debounce can be stepped; the page itself waits on promises and `nextTick`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { toasts } from '../helpers/toasts'
import {
  documentOfTab,
  followerOfTab,
  openPath,
  resetDocuments,
  saveDocument,
} from '@/documents/store'
import { buildGitIndex, type GitIndex, type GitLook } from '@/features/tree/gitModel'
import { GIT_DEBOUNCE_MS, gitLook } from '@/features/tree/gitStore'
import { commitNaming, deleteRow, moveRow, renameRow } from '@/features/tree/ops'
import FileTree from '@/features/tree/FileTree.vue'
import { pathKeyer } from '@/features/tree/model'
import {
  loadFolder,
  openFolderDialog,
  removeRootFolder,
  resetTree,
  restoreWorkspace,
  toggleFolder,
} from '@/features/tree/store'
import { cloneSettings, DEFAULT_SETTINGS, settings } from '@/lib/settings'
import { parseGitReport, type GitEntry, type GitReport, type GitStatusName } from '@/platform/git'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'

// ---- the index, with no page ----

const keyOf = pathKeyer(true)

/** An entry of repository `repo`. */
const entry = (
  path: string,
  status: GitStatusName,
  repo = 0,
  folder = status === 'ignored' && path.endsWith('/') ? true : false,
): GitEntry => ({ repo, path: path.replace(/\/$/, ''), status, folder })

function indexOf(repos: string[], entries: GitEntry[]): GitIndex {
  return buildGitIndex({ repos, entries }, keyOf)
}

describe('how a name is drawn (ISC-656)', () => {
  const index = indexOf(
    ['C:/w'],
    [
      entry('C:/w/mod.md', 'modified'),
      entry('C:/w/ren.md', 'renamed'),
      entry('C:/w/new.md', 'untracked'),
      entry('C:/w/staged.md', 'added'),
      entry('C:/w/clash.md', 'conflicted'),
      entry('C:/w/trace.log', 'ignored'),
      entry('C:/w/dist', 'ignored', 0, true),
      entry('C:/w/scratch', 'untracked', 0, true),
      entry('C:/w/notes/changed.md', 'modified'),
      entry('C:/w/only/cache.log', 'ignored'),
    ],
  )
  const look = (path: string, kind: 'root' | 'folder' | 'file' = 'file'): GitLook | undefined =>
    index.look(path, kind)

  it('is green for new names, blue for changed ones, the destructive color for a conflict, muted for ignored', () => {
    expect(look('C:/w/new.md')).toBe('added')
    expect(look('C:/w/staged.md')).toBe('added')
    expect(look('C:/w/mod.md')).toBe('modified')
    expect(look('C:/w/ren.md')).toBe('modified')
    expect(look('C:/w/clash.md')).toBe('conflicted')
    expect(look('C:/w/trace.log')).toBe('ignored')
    expect(look('C:/w/clean.md')).toBeUndefined()
  })

  it("gives everything inside an ignored or an untracked folder the folder's own status", () => {
    expect(look('C:/w/dist', 'folder')).toBe('ignored')
    expect(look('C:/w/dist/out.js')).toBe('ignored')
    expect(look('C:/w/dist/deep/er/x.js')).toBe('ignored')
    expect(look('C:/w/dist/deep', 'folder')).toBe('ignored')
    expect(look('C:/w/scratch', 'folder')).toBe('added')
    expect(look('C:/w/scratch/t.md')).toBe('added')
  })

  it('makes a folder that holds a change blue, and a folder that is untracked itself green', () => {
    expect(look('C:/w/notes', 'folder')).toBe('modified')
    expect(look('C:/w/notes/changed.md')).toBe('modified')
    // It holds a change (the files inside are new) and is untracked itself: its own status wins.
    expect(look('C:/w/scratch', 'folder')).toBe('added')
  })

  it('never lets an ignored name color a folder above it', () => {
    expect(look('C:/w/only', 'folder')).toBeUndefined()
    expect(look('C:/w/only/cache.log')).toBe('ignored')
  })

  it('counts every status but ignored as a change for the folders above it', () => {
    for (const status of ['untracked', 'added', 'modified', 'renamed', 'conflicted'] as const) {
      const one = indexOf(['C:/w'], [entry('C:/w/a/b/f.md', status)])
      expect(one.look('C:/w/a', 'folder'), status).toBe('modified')
      expect(one.look('C:/w/a/b', 'folder'), status).toBe('modified')
      expect(one.look('C:/w', 'folder'), status).toBe('modified')
    }
    const none = indexOf(['C:/w'], [entry('C:/w/a/b/f.log', 'ignored')])
    expect(none.look('C:/w/a', 'folder')).toBeUndefined()
  })

  it('does not color a root row for what is below it, only for a status of its own', () => {
    expect(look('C:/w', 'root')).toBeUndefined()
    const inside = indexOf(['C:/outer'], [entry('C:/outer/build', 'ignored', 0, true)])
    expect(inside.look('C:/outer/build/app', 'root')).toBe('ignored')
    expect(inside.look('C:/outer/build/app/readme.md', 'file')).toBe('ignored')
  })

  it('reads a path however it is spelled', () => {
    const spelled = indexOf(['C:/Work'], [entry('C:/Work/Notes/A.md', 'modified')])
    expect(spelled.look('c:\\work\\notes\\a.md', 'file')).toBe('modified')
    expect(spelled.look('C:\\Work\\Notes\\', 'folder')).toBe('modified')
  })

  it('draws nothing from an empty report', () => {
    const empty = indexOf([], [])
    expect(empty.look('C:/w/anything.md', 'file')).toBeUndefined()
    expect(empty.look('C:/w', 'folder')).toBeUndefined()
  })
})

describe('the innermost repository decides (ISC-656, ISC-658)', () => {
  // The outer repository calls `projects` untracked, since only the inner repository is in it.
  const index = indexOf(
    ['C:/w', 'C:/w/projects/inner'],
    [
      entry('C:/w/projects', 'untracked', 0, true),
      entry('C:/w/outer.md', 'modified', 0),
      entry('C:/w/projects/inner/kept.md', 'modified', 1),
      entry('C:/w/projects/inner/build', 'ignored', 1, true),
    ],
  )

  it('colors the folder the outer repository reported, and nothing it does not hold', () => {
    expect(index.look('C:/w/projects', 'folder')).toBe('added')
    expect(index.look('C:/w/projects/loose.md', 'file')).toBe('added')
  })

  it("does not hand the outer folder's status to what lies in the inner repository", () => {
    expect(index.look('C:/w/projects/inner/readme.md', 'file')).toBeUndefined()
    expect(index.look('C:/w/projects/inner/deep/x.md', 'file')).toBeUndefined()
  })

  it('colors the inner repository by its own report', () => {
    expect(index.look('C:/w/projects/inner/kept.md', 'file')).toBe('modified')
    expect(index.look('C:/w/projects/inner/build/out.js', 'file')).toBe('ignored')
    expect(index.look('C:/w/projects/inner', 'folder')).toBe('modified')
    expect(index.look('C:/w/outer.md', 'file')).toBe('modified')
  })

  it('does not take an entry from a repository that does not hold the path', () => {
    const wrong = indexOf(['C:/w', 'C:/w/inner'], [entry('C:/w/inner/a.md', 'modified', 0)])
    expect(wrong.look('C:/w/inner/a.md', 'file')).toBeUndefined()
  })
})

// ---- the tree, with a fake host ----

const settle = async (): Promise<void> => {
  for (let round = 0; round < 6; round++) {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }
}

/** Steps past the debounce and lets the answers reach the rows. */
async function tick(ms = GIT_DEBOUNCE_MS + 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

const FILES: Record<string, string> = {
  '/work/mod.md': '# mod\n',
  '/work/new.md': '# new\n',
  '/work/clash.md': '# clash\n',
  '/work/clean.md': '# clean\n',
  '/work/trace.log': 'log\n',
  '/work/notes/changed.md': '# changed\n',
  '/work/notes/same.md': '# same\n',
  '/work/dist/out.js': 'out\n',
  '/work/dist/deep/more.js': 'more\n',
  '/work/scratch/t.md': '# t\n',
  '/work/only/cache.log': 'cache\n',
  '/work/only/real.md': '# real\n',
}

const WORK_REPORT: GitReport = {
  repos: ['/work'],
  entries: [
    entry('/work/mod.md', 'modified'),
    entry('/work/new.md', 'untracked'),
    entry('/work/clash.md', 'conflicted'),
    entry('/work/trace.log', 'ignored'),
    entry('/work/notes/changed.md', 'modified'),
    entry('/work/dist', 'ignored', 0, true),
    entry('/work/scratch', 'untracked', 0, true),
    entry('/work/only/cache.log', 'ignored'),
  ],
}

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined
let report: GitReport | ((root: string) => GitReport)

function mountTree(): HTMLElement {
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(FileTree)
  app.mount(root)
  mounted = { app, root }
  return root
}

/** Starts a host whose git answers with `report` as it is at the time of the call. */
function start(options: Parameters<typeof createMockHost>[0] = {}): MockHost {
  host = createMockHost({
    files: FILES,
    roots: ['/work'],
    git: (root) => (typeof report === 'function' ? report(root) : report),
    ...options,
  })
  setHost(host)
  return host
}

/**
 * Starts a host that never says a folder changed, so the only things that can ask for the status
 * are the triggers the test is about: the watcher would otherwise ask after every file the page
 * makes, whatever else the page does.
 */
function startSilent(options: Parameters<typeof createMockHost>[0] = {}): MockHost {
  const silent = start(options)
  silent.watchTree = () => Promise.resolve(() => undefined)
  return silent
}

/** The name span of a row, which carries the look. */
function nameOf(path: string, under?: string): HTMLElement | null {
  const rows = [...document.querySelectorAll<HTMLElement>(`[data-row-path="${path}"]`)]
  const row = under === undefined ? rows[0] : rows.find((r) => r.dataset.rowRoot === under)
  return row?.querySelector<HTMLElement>('span.truncate') ?? null
}

const lookOf = (path: string, under?: string): string | undefined =>
  nameOf(path, under)?.dataset.git

const classOf = (path: string): string => nameOf(path)?.className ?? ''

/** Opens the root and the given folders and shows the first colours. */
async function open(...folders: string[]): Promise<HTMLElement> {
  await restoreWorkspace([], [{ root: '/work', path: '/work' }])
  const tree = mountTree()
  await settle()
  for (const folder of folders) {
    await toggleFolder(folder)
    await settle()
  }
  await tick()
  return tree
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  resetTree()
  resetDocuments()
  resetWorkbench()
  Object.assign(settings.git, cloneSettings(DEFAULT_SETTINGS).git)
  Object.assign(settings.workspace, cloneSettings(DEFAULT_SETTINGS).workspace)
  report = WORK_REPORT
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  setHost(undefined)
  resetTree()
  vi.useRealTimers()
})

describe('what the tree draws (ISC-656)', () => {
  it('colors each status, a changed folder blue and an ignored folder and what is in it muted', async () => {
    start()
    await open('/work/notes', '/work/dist', '/work/dist/deep', '/work/scratch', '/work/only')
    expect(lookOf('/work/mod.md')).toBe('modified')
    expect(lookOf('/work/new.md')).toBe('added')
    expect(lookOf('/work/clash.md')).toBe('conflicted')
    expect(lookOf('/work/trace.log')).toBe('ignored')
    expect(lookOf('/work/clean.md')).toBeUndefined()
    // A tracked folder with one change is blue; the change inside is blue; the rest is plain.
    expect(lookOf('/work/notes')).toBe('modified')
    expect(lookOf('/work/notes/changed.md')).toBe('modified')
    expect(lookOf('/work/notes/same.md')).toBeUndefined()
    // An ignored folder, what is in it, and what is in that.
    expect(lookOf('/work/dist')).toBe('ignored')
    expect(lookOf('/work/dist/out.js')).toBe('ignored')
    expect(lookOf('/work/dist/deep/more.js')).toBe('ignored')
    // An untracked folder is green, and so is what is in it.
    expect(lookOf('/work/scratch')).toBe('added')
    expect(lookOf('/work/scratch/t.md')).toBe('added')
    // An ignored child colors no parent, and a clean sibling stays plain.
    expect(lookOf('/work/only')).toBeUndefined()
    expect(lookOf('/work/only/cache.log')).toBe('ignored')
    expect(lookOf('/work/only/real.md')).toBeUndefined()
    // The root is not blue for what is below it.
    expect(lookOf('/work')).toBeUndefined()
  })

  it('puts the colors on the name as classes written out whole', async () => {
    start()
    await open()
    expect(classOf('/work/new.md')).toContain('text-git-added')
    expect(classOf('/work/mod.md')).toContain('text-git-modified')
    expect(classOf('/work/clash.md')).toContain('text-destructive')
    expect(classOf('/work/trace.log')).toContain('text-git-ignored')
    expect(classOf('/work/clean.md')).not.toMatch(/text-(git|destructive)/)
  })

  it("keeps the color on a selected row, which only changes the row's fill", async () => {
    start()
    await open()
    const row = document.querySelector<HTMLElement>('[data-row-path="/work/mod.md"]')
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    const selected = document.querySelector<HTMLElement>('[data-row-path="/work/mod.md"]')
    expect(selected?.getAttribute('aria-selected')).toBe('true')
    expect(selected?.className).toContain('bg-sidebar-accent')
    expect(nameOf('/work/mod.md')?.className).toContain('text-git-modified')
  })

  it('leaves the naming box and the notes uncolored', async () => {
    start()
    await open()
    await renameRow('/work/mod.md')
    await settle()
    const box = document.querySelector('[data-row-path="/work/mod.md"] input')
    expect(box).not.toBeNull()
    expect(document.querySelector('[data-row-path="/work/mod.md"] [data-git]')).toBeNull()
  })
})

describe('what asks for the status (ISC-657)', () => {
  it('asks when a root opens, with the folders that are open', async () => {
    start()
    await open('/work/notes')
    expect(host.gitCalls.length).toBeGreaterThanOrEqual(1)
    const last = host.gitCalls.at(-1)
    expect(last?.root).toBe('/work')
    expect([...(last?.folders ?? [])].sort()).toEqual(['/work', '/work/notes'])
  })

  it('asks when a folder is opened as a root from the dialog', async () => {
    startSilent({ files: { ...FILES, '/more/x.md': '# x\n' }, pickFolder: () => '/more' })
    await open()
    const before = host.gitCalls.length
    await openFolderDialog()
    await tick()
    // One question for each open root, the new one included.
    expect(host.gitCalls.slice(before).map((call) => call.root)).toEqual(['/work', '/more'])
  })

  it('turns a burst of triggers into one question', async () => {
    start()
    await open()
    const before = host.gitCalls.length
    for (let n = 0; n < 5; n++) {
      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(20)
    }
    expect(host.gitCalls.length).toBe(before)
    await tick()
    expect(host.gitCalls.length).toBe(before + 1)
  })

  it('asks again when the window gets the focus back', async () => {
    start()
    await open()
    const before = host.gitCalls.length
    report = { repos: ['/work'], entries: [entry('/work/clean.md', 'modified')] }
    window.dispatchEvent(new Event('focus'))
    await tick()
    expect(host.gitCalls.length).toBe(before + 1)
    expect(lookOf('/work/clean.md')).toBe('modified')
    expect(lookOf('/work/mod.md')).toBeUndefined()
  })

  it('asks after mdmate saves a file', async () => {
    startSilent()
    await open()
    const tab = await openPath('/work/clean.md')
    followerOfTab(tab)?.dispatch({ changes: { from: 0, insert: 'X' } })
    await tick()
    const before = host.gitCalls.length
    expect(await saveDocument(documentOfTab(tab)?.id ?? -1)).toBe(true)
    await tick()
    expect(host.gitCalls.length).toBe(before + 1)
  })

  it('asks after mdmate renames a file', async () => {
    startSilent()
    await open('/work/notes')
    const before = host.gitCalls.length
    await renameRow('/work/clean.md')
    await commitNaming('renamed.md')
    await tick()
    expect(host.gitCalls.length).toBe(before + 1)
  })

  it('asks after mdmate moves a file', async () => {
    startSilent()
    await open('/work/notes')
    const before = host.gitCalls.length
    await moveRow('/work/clean.md', '/work/notes')
    await tick()
    expect(host.gitCalls.length).toBe(before + 1)
  })

  it('asks after mdmate deletes a file', async () => {
    startSilent()
    await open('/work/notes')
    const before = host.gitCalls.length
    await deleteRow('/work/clean.md')
    await tick()
    expect(host.gitCalls.length).toBe(before + 1)
  })

  it('asks after a file is made in the tree', async () => {
    startSilent()
    await open()
    const before = host.gitCalls.length
    const { newFileIn } = await import('@/features/tree/ops')
    await newFileIn('/work')
    await commitNaming('fresh.md')
    await tick()
    expect(host.gitCalls.length).toBe(before + 1)
  })

  it('does not ask on its own when nothing happened', async () => {
    startSilent()
    await open()
    const before = host.gitCalls.length
    await tick(5000)
    expect(host.gitCalls.length).toBe(before)
  })

  it('asks when Rust says an open folder changed on disk', async () => {
    start()
    await open()
    const before = host.gitCalls.length
    host.files.write('/work/outside.md', 'another program wrote this\n')
    await tick()
    expect(host.gitCalls.length).toBeGreaterThan(before)
  })

  it('drops an answer that is older than a newer question', async () => {
    const answers: ((value: GitReport) => void)[] = []
    start({
      git: () =>
        new Promise<GitReport>((resolve) => {
          answers.push(resolve)
        }),
    })
    await restoreWorkspace([], [{ root: '/work', path: '/work' }])
    mountTree()
    await tick()
    expect(answers.length).toBe(1)
    // A second question goes out while the first is still unanswered.
    window.dispatchEvent(new Event('focus'))
    await tick()
    expect(answers.length).toBe(2)
    // The newer answer arrives first, then the older one.
    answers[1]?.({ repos: ['/work'], entries: [entry('/work/mod.md', 'modified')] })
    await settle()
    expect(lookOf('/work/mod.md')).toBe('modified')
    answers[0]?.({ repos: ['/work'], entries: [entry('/work/new.md', 'untracked')] })
    await settle()
    expect(lookOf('/work/mod.md')).toBe('modified')
    expect(lookOf('/work/new.md')).toBeUndefined()
  })

  it('drops an answer for a root that was removed meanwhile', async () => {
    const answers: ((value: GitReport) => void)[] = []
    start({
      git: () =>
        new Promise<GitReport>((resolve) => {
          answers.push(resolve)
        }),
    })
    await restoreWorkspace([], [{ root: '/work', path: '/work' }])
    mountTree()
    await tick()
    await removeRootFolder('/work')
    // The answer comes before the page has asked again, so nothing but the root check can stop it.
    answers[0]?.({ repos: ['/work'], entries: [entry('/work/mod.md', 'modified')] })
    await settle()
    expect(gitLook('/work', '/work/mod.md', 'file')).toBeUndefined()
    await tick()
    expect(gitLook('/work', '/work/mod.md', 'file')).toBeUndefined()
  })
})

describe('a root with several repositories (ISC-658)', () => {
  const MANY: Record<string, string> = {
    '/many/one/a.md': '# a\n',
    '/many/one/b.md': '# b\n',
    '/many/two/c.md': '# c\n',
    '/many/two/d.md': '# d\n',
    '/many/plain.md': '# plain\n',
  }
  let one: GitEntry[]
  let two: GitEntry[]
  const reportOfMany = (): GitReport => ({
    repos: ['/many/one', '/many/two'],
    entries: [...one, ...two],
  })

  async function openMany(): Promise<void> {
    one = [entry('/many/one/a.md', 'modified', 0)]
    two = [entry('/many/two/c.md', 'untracked', 1)]
    start({ files: MANY, roots: ['/many'], git: () => reportOfMany() })
    await restoreWorkspace([], [{ root: '/many', path: '/many' }])
    mountTree()
    await settle()
    await toggleFolder('/many/one')
    await toggleFolder('/many/two')
    await tick()
  }

  it('colors each repository from its own report', async () => {
    await openMany()
    expect(lookOf('/many/one/a.md')).toBe('modified')
    expect(lookOf('/many/one/b.md')).toBeUndefined()
    expect(lookOf('/many/one')).toBe('modified')
    expect(lookOf('/many/two/c.md')).toBe('added')
    expect(lookOf('/many/two/d.md')).toBeUndefined()
    expect(lookOf('/many/two')).toBe('modified')
    expect(lookOf('/many/plain.md')).toBeUndefined()
    // One question covers the whole root.
    expect(host.gitCalls.filter((call) => call.root === '/many').length).toBeGreaterThan(0)
  })

  it("follows a change in one repository without touching the other's rows", async () => {
    await openMany()
    const twoRow = nameOf('/many/two/c.md')
    const twoLook = lookOf('/many/two/c.md')
    one = [entry('/many/one/b.md', 'conflicted', 0)]
    window.dispatchEvent(new Event('focus'))
    await tick()
    expect(lookOf('/many/one/a.md')).toBeUndefined()
    expect(lookOf('/many/one/b.md')).toBe('conflicted')
    // The other repository's rows are the same elements with the same look.
    expect(nameOf('/many/two/c.md')).toBe(twoRow)
    expect(lookOf('/many/two/c.md')).toBe(twoLook)
    expect(lookOf('/many/two/d.md')).toBeUndefined()
  })

  it("colors a folder shown under two roots from each root's own report", async () => {
    start({
      files: { '/outer/inner/x.md': '# x\n', '/outer/y.md': '# y\n' },
      roots: ['/outer', '/outer/inner'],
      git: (root) =>
        root === '/outer'
          ? { repos: ['/outer'], entries: [entry('/outer/inner/x.md', 'modified', 0)] }
          : { repos: [], entries: [] },
    })
    await restoreWorkspace(
      [],
      [
        { root: '/outer', path: '/outer' },
        { root: '/outer/inner', path: '/outer/inner' },
        { root: '/outer', path: '/outer/inner' },
      ],
    )
    mountTree()
    await tick()
    expect(lookOf('/outer/inner/x.md', '/outer')).toBe('modified')
    expect(lookOf('/outer/inner/x.md', '/outer/inner')).toBeUndefined()
  })
})

describe('git off or missing (ISC-659)', () => {
  it('asks Rust nothing and colors nothing when git is off, and says nothing', async () => {
    settings.git.enabled = false
    start()
    await open('/work/notes')
    expect(host.gitCalls).toEqual([])
    expect(document.querySelector('[data-git]')).toBeNull()
    expect(toasts.all).toEqual([])
  })

  it('takes the colors away at once when git is turned off, and brings them back when it is turned on', async () => {
    start()
    await open()
    expect(lookOf('/work/mod.md')).toBe('modified')
    const before = host.gitCalls.length
    settings.git.enabled = false
    await tick()
    expect(document.querySelector('[data-git]')).toBeNull()
    expect(host.gitCalls.length).toBe(before)
    settings.git.enabled = true
    await tick()
    expect(host.gitCalls.length).toBeGreaterThan(before)
    expect(lookOf('/work/mod.md')).toBe('modified')
    expect(toasts.all).toEqual([])
  })

  it('colors nothing and says nothing when Rust finds no git', async () => {
    report = { repos: [], entries: [] }
    start()
    await open()
    expect(host.gitCalls.length).toBeGreaterThan(0)
    expect(document.querySelector('[data-git]')).toBeNull()
    expect(toasts.all).toEqual([])
  })

  it('colors nothing and says nothing when the call fails', async () => {
    start({
      git: () => {
        throw new Error('access to /work is not allowed')
      },
    })
    await open()
    expect(document.querySelector('[data-git]')).toBeNull()
    expect(toasts.all).toEqual([])
  })

  it('colors nothing and says nothing when the answer is not a report', async () => {
    start({ git: () => ({ repos: 'nope' }) as unknown as GitReport })
    await open()
    expect(document.querySelector('[data-git]')).toBeNull()
    expect(toasts.all).toEqual([])
  })

  it('keeps a listing working when git has nothing to say', async () => {
    report = { repos: [], entries: [] }
    start()
    await open()
    await loadFolder('/work')
    await settle()
    expect(nameOf('/work/mod.md')?.textContent).toBe('mod.md')
  })
})

describe('the report as Rust sends it', () => {
  // The same JSON Rust's test `the_report_is_what_the_page_reads` pins.
  const SENT = {
    repos: ['C:/work'],
    entries: [{ repo: 0, path: 'C:/work/a.md', status: 'modified', folder: false }],
  }

  it('is read as it is', () => {
    expect(parseGitReport(SENT)).toEqual(SENT)
    expect(parseGitReport({ repos: [], entries: [] })).toEqual({ repos: [], entries: [] })
  })

  it('refuses a report that is not one, so the rows never draw from it', () => {
    const bad: unknown[] = [
      null,
      'report',
      { repos: 'C:/work', entries: [] },
      { repos: ['C:/work'] },
      { repos: ['C:/work'], entries: [{ ...SENT.entries[0], repo: 1 }] },
      { repos: ['C:/work'], entries: [{ ...SENT.entries[0], repo: -1 }] },
      { repos: ['C:/work'], entries: [{ ...SENT.entries[0], status: 'staged' }] },
      { repos: ['C:/work'], entries: [{ ...SENT.entries[0], path: '' }] },
      { repos: ['C:/work'], entries: [{ ...SENT.entries[0], folder: 'no' }] },
      { repos: [1], entries: [] },
    ]
    for (const value of bad) expect(() => parseGitReport(value), JSON.stringify(value)).toThrow()
  })
})
