// @vitest-environment jsdom
// ISC-776, ISC-777 and ISC-779: the Git branch in the status bar. The mock answers `gitStatus`
// with the report below and `gitBranch` with the repository found above a file, as Rust does.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { openPath, resetDocuments } from '@/documents/store'
import { GIT_DEBOUNCE_MS } from '@/features/tree/gitStore'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import { cloneSettings, DEFAULT_SETTINGS, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import { parseFileBranch, parseGitReport, type FileBranch } from '@/platform/git'
import { createMockHost, type MockHost } from '@/platform/mock'
import StatusBar from '@/shell/StatusBar.vue'
import { clearCommands, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { findCounts } from '@/workbench/find'
import { openSettingsTab, resetWorkbench, selectTab } from '@/workbench/store'

const FILES: Record<string, string> = {
  '/work/a.md': '# a\n',
  '/work/inner/b.md': '# b\n',
  '/work/a/b/c/d/deep/n.md': '# deep\n',
  '/lone/n.md': '# lone\n',
  '/plain/p.md': '# plain\n',
}

/** The branch each repository is on, changed by a test as a checkout would. */
let heads: Record<string, string>
/** The repositories the status of `/work` finds; `deep` is below what that search reaches. */
const SCANNED = ['/work', '/work/inner']
const ALL = [...SCANNED, '/work/a/b/c/d/deep', '/lone']

/** What walking up from a file finds. */
function holder(path: string): FileBranch | null {
  const repo = ALL.filter((at) => path.startsWith(`${at}/`)).sort((a, b) => b.length - a.length)[0]
  return repo === undefined ? null : { repo, branch: heads[repo] ?? null }
}

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
/** Past the wait before git is asked again, and the answers. */
const settle = async (): Promise<void> => {
  await sleep(GIT_DEBOUNCE_MS + 80)
  await nextTick()
}

beforeEach(() => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  Object.assign(settings.git, cloneSettings(DEFAULT_SETTINGS).git)
  heads = {
    '/work': 'main',
    '/work/inner': 'feature/inner',
    '/work/a/b/c/d/deep': 'deep-one',
    '/lone': 'lonely',
  }
  host = createMockHost({
    files: FILES,
    roots: ['/work'],
    // A clean repository: no entries, only the branches.
    git: () => ({
      repos: SCANNED,
      branches: SCANNED.map((repo) => heads[repo] ?? null),
      entries: [],
    }),
    gitHolder: holder,
  })
  setHost(host)
  clearCommands()
  registerDefaultCommands()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(StatusBar)
  app.mount(root)
  mounted = { app, root }
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  resetTree()
  resetDocuments()
  resetWorkbench()
  findCounts.clear()
  setHost(undefined)
  document.body.replaceChildren()
})

const item = (): HTMLElement | null => document.querySelector('[data-status-branch]')
const shown = (): string | null => item()?.querySelector('[data-branch-name]')?.textContent ?? null

async function open(path: string): Promise<string> {
  const tab = await openPath(path)
  await settle()
  return tab
}

const openRoot = async (): Promise<void> => {
  await restoreWorkspace([], [{ root: '/work', path: '/work' }])
  await settle()
}

describe('the branch of the focused file (ISC-776)', () => {
  it('is at the left of the bar with a branch icon', async () => {
    await openRoot()
    await open('/work/a.md')
    expect(shown()).toBe('main')
    const footer = document.querySelector('footer')!
    expect(footer.firstElementChild).toBe(item())
    expect(item()!.querySelector('svg')).not.toBeNull()
    expect(item()!.textContent).toContain('Git branch')
    // The branch alone, never the folder of the repository.
    expect(item()!.textContent).not.toContain('work')
    expect(item()!.querySelector('[title]')).toBeNull()
  })

  it('follows the focused file, inside the sidebar folders and outside them', async () => {
    await openRoot()
    const first = await open('/work/a.md')
    await open('/work/inner/b.md')
    expect(shown()).toBe('feature/inner')
    await open('/lone/n.md')
    expect(shown()).toBe('lonely')
    selectTab(first)
    await settle()
    expect(shown()).toBe('main')
  })

  it('is that of a repository nested too deep for the search under the folder', async () => {
    await openRoot()
    await open('/work/a/b/c/d/deep/n.md')
    expect(shown()).toBe('deep-one')
  })

  it('shows for a file with no folder open', async () => {
    await open('/lone/n.md')
    expect(shown()).toBe('lonely')
  })

  it('is asked again when the window gets the focus back (ISC-778)', async () => {
    await openRoot()
    await open('/work/a.md')
    heads['/work'] = 'other'
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(shown()).toBe('other')
    await open('/lone/n.md')
    heads['/lone'] = 'moved'
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(shown()).toBe('moved')
  })
})

describe('when there is no branch to show (ISC-777)', () => {
  it('shows a detached HEAD as the short commit id', async () => {
    heads['/lone'] = '0123abc'
    await open('/lone/n.md')
    expect(shown()).toBe('0123abc')
  })

  it('is hidden for a file in no repository', async () => {
    await open('/lone/n.md')
    await open('/plain/p.md')
    expect(item()).toBeNull()
  })

  it('is hidden for an untitled document and for a tab with no document', async () => {
    await open('/lone/n.md')
    const asked = host.branchCalls.length
    void runCommand(COMMAND_IDS.newFile)
    await settle()
    expect(item()).toBeNull()
    expect(host.branchCalls.length).toBe(asked)
    await open('/work/a.md')
    openSettingsTab()
    await settle()
    expect(item()).toBeNull()
  })

  it('is hidden while git is off, and comes back with it', async () => {
    await openRoot()
    await open('/work/a.md')
    settings.git.enabled = false
    await settle()
    expect(item()).toBeNull()
    const asked = host.branchCalls.length
    await open('/lone/n.md')
    expect(host.branchCalls.length).toBe(asked)
    settings.git.enabled = true
    await settle()
    expect(shown()).toBe('lonely')
  })
})

describe('a repository the page has read (ISC-779)', () => {
  it('is named as known, so its branch costs no read', async () => {
    await openRoot()
    await open('/work/a.md')
    expect(host.branchCalls.at(-1)?.known).toEqual(SCANNED)
    // Nothing was asked about the file before the status of its folder was in.
    expect(host.branchCalls.every((call) => call.known.includes('/work'))).toBe(true)
  })
})

describe('the answers as Rust sends them', () => {
  it('reads a branch of a file, and nothing', () => {
    // The same JSON Rust's `FileBranch` serializes to.
    const sent = { repo: 'C:/work', branch: null }
    expect(parseFileBranch(sent)).toEqual(sent)
    expect(parseFileBranch(null)).toBeNull()
    for (const bad of ['main', {}, { repo: 'C:/work' }, { repo: 1, branch: 'main' }])
      expect(() => parseFileBranch(bad), JSON.stringify(bad)).toThrow()
  })

  it('refuses a report whose branches do not match its repositories', () => {
    const report = { repos: ['C:/work'], branches: ['main'], entries: [] }
    expect(parseGitReport(report)).toEqual(report)
    for (const branches of [undefined, [], [1], ['a', 'b']])
      expect(() => parseGitReport({ ...report, branches }), JSON.stringify(branches)).toThrow()
  })
})
