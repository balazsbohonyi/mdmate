// @vitest-environment jsdom
/**
 * Renaming and moving with links (P6-T6, changed in P7.1-T5): ISC-126 (in `ask` mode the question
 * comes before any file is read), ISC-127 (`links.onRename`: `never`, `ask`, `update`, and the
 * environment over the setting) and the answers, the progress, the stop, the summary and the list
 * of files that could not be changed. The mock host reads plain inline links only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, watch as watchRef, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { documentOfTab, openPath, problem, resetDocuments } from '@/documents/store'
import RewriteBanner from '@/features/links/RewriteBanner.vue'
import {
  answerRewrite,
  cancelRewriteScan,
  dismissRewriteReport,
  moveWithLinks,
  rewriteState,
  type RewriteState,
} from '@/features/links/rewrite'
import { commitNaming, moveRow, renameRow } from '@/features/tree/ops'
import { naming, resetTree, restoreWorkspace } from '@/features/tree/store'
import { resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, type MockHost, type MockHostOptions } from '@/platform/mock'
import { clearCommands, isCommandEnabled, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetWorkbench, tabTitle } from '@/workbench/store'
import { renameTab } from '@/workbench/tabMenu'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

const FILES: Record<string, string> = {
  '/work/old.md': '# old\n',
  '/work/a.md': 'one [o](old.md), two [o](old.md#top)\n',
  '/work/sub/b.md': 'back [o](../old.md)\n',
  '/work/none.md': 'no links to it\n',
  '/work/sub2/target.md': 'target\n',
}

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined
/** Every phase the banner went through, in order. */
let phases: string[] = []
let stopWatching: (() => void) | undefined

async function start(
  files: Record<string, string> = FILES,
  extra: Partial<MockHostOptions> = {},
): Promise<void> {
  host = createMockHost({ files, roots: ['/work'], ...extra })
  setHost(host)
  await restoreWorkspace([])
  await flush()
}

function mountBanner(): HTMLElement {
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(RewriteBanner)
  app.mount(root)
  mounted = { app, root }
  return root
}

beforeEach(() => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  resetSettings()
  problem.value = null
  rewriteState.value = null
  phases = []
  stopWatching = watchRef(
    rewriteState,
    (state: RewriteState | null) => {
      if (state !== null && phases.at(-1) !== state.phase) phases.push(state.phase)
    },
    { flush: 'sync' },
  )
})

afterEach(() => {
  stopWatching?.()
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  setHost(undefined)
  resetTree()
  resetSettings()
})

const text = (root: HTMLElement): string => root.textContent.replace(/\s+/g, ' ').trim()

async function rename(path: string, name: string): Promise<void> {
  await renameRow(path)
  await commitNaming(name)
}

/** How many times the page asked Rust to read the workspace for links (and so how many scans). */
function countScans(): { readonly count: number } {
  const seen = { count: 0 }
  const original = host.rewritePlan.bind(host)
  host.rewritePlan = (...args) => {
    seen.count += 1
    return original(...args)
  }
  return seen
}

describe('ask: the question comes before any file is read (ISC-126)', () => {
  beforeEach(() => {
    settings.links.onRename = 'ask'
  })

  it('asks first with Yes first and focused, reads nothing, and changes nothing until the answer', async () => {
    await start()
    const scans = countScans()
    const root = mountBanner()
    const running = rename('/work/old.md', 'new.md')
    await flush()
    expect(root.querySelector('[data-rewrite-banner]')?.getAttribute('data-phase')).toBe('asking')
    expect(text(root)).toContain('Update links to old.md?')
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons.map((button) => button.dataset.answer)).toEqual([
      'update',
      'move-only',
      'cancel',
    ])
    expect(buttons.map((button) => button.textContent.trim())).toEqual(['Yes', 'No', 'Cancel'])
    // The note is short, so the question and the buttons fit the default sidebar.
    expect(root.querySelector('[data-rewrite-note]')?.textContent.trim()).toBe(
      "Scans this workspace's Markdown files. May take a while.",
    )
    expect(document.activeElement).toBe(buttons[0])
    // No file was read for links, the name box is gone, and nothing has moved.
    expect(scans.count).toBe(0)
    expect(naming.value).toBeNull()
    expect(host.files.has('/work/old.md')).toBe(true)
    expect(host.files.read('/work/a.md')).toBe(FILES['/work/a.md'])

    answerRewrite('cancel')
    await running
  })

  it('Yes reads the workspace, rewrites without a second question and says what it did', async () => {
    await start()
    const scans = countScans()
    const root = mountBanner()
    const running = rename('/work/old.md', 'new.md')
    await flush()
    root.querySelector<HTMLButtonElement>('[data-answer="update"]')?.click()
    await running
    await flush()
    expect(scans.count).toBe(1)
    expect(phases).toEqual(['asking', 'scanning', 'report'])
    expect(host.files.has('/work/new.md')).toBe(true)
    expect(host.files.read('/work/a.md')).toBe('one [o](new.md), two [o](new.md#top)\n')
    expect(host.files.read('/work/sub/b.md')).toBe('back [o](../new.md)\n')
    expect(host.files.read('/work/none.md')).toBe(FILES['/work/none.md'])
    expect(root.querySelector('[data-rewrite-updated]')?.textContent.trim()).toBe(
      'Updated 3 links in 2 files.',
    )
    // The line only says what happened: the keyboard stays where it was.
    expect(root.contains(document.activeElement)).toBe(false)
    dismissRewriteReport()
    await nextTick()
    expect(root.querySelector('[data-rewrite-banner]')).toBeNull()
  })

  it('says "1 link in 1 file" in the singular', async () => {
    await start({ '/work/old.md': 'x', '/work/a.md': '[o](old.md)\n' })
    const root = mountBanner()
    const running = rename('/work/old.md', 'new.md')
    await flush()
    answerRewrite('update')
    await running
    await flush()
    expect(text(root)).toContain('Updated 1 link in 1 file.')
  })

  it('the line that only says what was updated goes away by itself', async () => {
    // Started on the real clock: restoring the workspace waits on timers.
    await start({ '/work/old.md': 'x', '/work/a.md': '[o](old.md)\n' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const running = rename('/work/old.md', 'new.md')
      await vi.advanceTimersByTimeAsync(0)
      answerRewrite('update')
      await vi.advanceTimersByTimeAsync(0)
      await running
      expect(rewriteState.value).toMatchObject({ phase: 'report', updated: { links: 1, files: 1 } })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(rewriteState.value).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('Yes on a file nothing links to renames it and says that no link pointed to it', async () => {
    await start()
    const root = mountBanner()
    const running = rename('/work/none.md', 'still-none.md')
    await flush()
    answerRewrite('update')
    await running
    await flush()
    expect(host.files.has('/work/still-none.md')).toBe(true)
    expect(rewriteState.value).toMatchObject({ phase: 'report', updated: { links: 0, files: 0 } })
    expect(text(root)).toContain('No links pointed to it, so none were changed.')
  })

  it('Cancel leaves the file where it was and every link as it was, and reads nothing', async () => {
    await start()
    const scans = countScans()
    const running = rename('/work/old.md', 'new.md')
    await flush()
    answerRewrite('cancel')
    await running
    await flush()
    expect(scans.count).toBe(0)
    expect(host.files.has('/work/old.md')).toBe(true)
    expect(host.files.has('/work/new.md')).toBe(false)
    expect(host.files.read('/work/a.md')).toBe(FILES['/work/a.md'])
    expect(naming.value).toBeNull()
    expect(rewriteState.value).toBeNull()
  })

  it('No moves the file, leaves every link alone, and reads nothing', async () => {
    await start()
    const scans = countScans()
    const running = rename('/work/old.md', 'new.md')
    await flush()
    answerRewrite('move-only')
    await running
    await flush()
    expect(scans.count).toBe(0)
    expect(host.files.has('/work/new.md')).toBe(true)
    expect(host.files.has('/work/old.md')).toBe(false)
    expect(host.files.read('/work/a.md')).toBe(FILES['/work/a.md'])
    expect(rewriteState.value).toBeNull()
  })

  it('asks for a move too', async () => {
    await start()
    const root = mountBanner()
    const running = moveRow('/work/old.md', '/work/sub2')
    await flush()
    expect(text(root)).toContain('Update links to old.md?')
    answerRewrite('update')
    await running
    await flush()
    expect(host.files.read('/work/a.md')).toBe('one [o](sub2/old.md), two [o](sub2/old.md#top)\n')
    expect(host.files.read('/work/sub/b.md')).toBe('back [o](../sub2/old.md)\n')
  })

  it('asks nothing for a move that moves nothing', async () => {
    await start()
    const scans = countScans()
    const moved = await moveWithLinks('/work/old.md', { kind: 'move', into: '/work' })
    expect(moved).not.toBeNull()
    expect(phases).toEqual([])
    expect(scans.count).toBe(0)
  })

  it('keeps a name that is taken in the box with the reason, and asks and reads nothing', async () => {
    await start()
    const scans = countScans()
    await rename('/work/old.md', 'a.md')
    expect(naming.value?.error).toContain('already exists')
    expect(phases).toEqual([])
    expect(scans.count).toBe(0)
    expect(host.files.has('/work/old.md')).toBe(true)
  })
})

describe('links.onRename (ISC-127)', () => {
  it('is never by default: the file is renamed with no question and no file read for links', async () => {
    expect(settings.links.onRename).toBe('never')
    await start()
    const scans = countScans()
    await rename('/work/old.md', 'new.md')
    await flush()
    expect(phases).toEqual([])
    expect(scans.count).toBe(0)
    expect(host.files.has('/work/new.md')).toBe(true)
    expect(host.files.has('/work/old.md')).toBe(false)
    expect(host.files.read('/work/a.md')).toBe(FILES['/work/a.md'])
    expect(naming.value).toBeNull()
  })

  it('never: a move is only a move too', async () => {
    await start()
    const scans = countScans()
    await moveRow('/work/old.md', '/work/sub2')
    await flush()
    expect(scans.count).toBe(0)
    expect(host.files.has('/work/sub2/old.md')).toBe(true)
    expect(host.files.read('/work/a.md')).toBe(FILES['/work/a.md'])
  })

  it('never: a name that is taken stays in the box with the reason', async () => {
    await start()
    await rename('/work/old.md', 'a.md')
    expect(naming.value?.error).toContain('already exists')
    expect(host.files.has('/work/old.md')).toBe(true)
  })

  it('update: rewrites without asking', async () => {
    await start()
    settings.links.onRename = 'update'
    await rename('/work/old.md', 'new.md')
    await flush()
    expect(phases).not.toContain('asking')
    expect(host.files.read('/work/a.md')).toBe('one [o](new.md), two [o](new.md#top)\n')
    expect(host.files.has('/work/new.md')).toBe(true)
  })

  it('asks again when the setting is set to ask', async () => {
    await start()
    settings.links.onRename = 'update'
    settings.links.onRename = 'ask'
    const running = rename('/work/old.md', 'new.md')
    await flush()
    expect(rewriteState.value?.phase).toBe('asking')
    answerRewrite('cancel')
    await running
  })

  it('the environment wins over the setting, both ways', async () => {
    await start(FILES, { linksOnRename: 'update' })
    settings.links.onRename = 'never'
    await rename('/work/old.md', 'new.md')
    await flush()
    expect(host.files.read('/work/a.md')).toBe('one [o](new.md), two [o](new.md#top)\n')

    await start(FILES, { linksOnRename: 'never' })
    settings.links.onRename = 'update'
    const scans = countScans()
    await rename('/work/old.md', 'new.md')
    await flush()
    expect(scans.count).toBe(0)
    expect(host.files.read('/work/a.md')).toBe(FILES['/work/a.md'])
  })
})

describe('the scan', () => {
  beforeEach(() => {
    settings.links.onRename = 'update'
  })

  it('shows how many files it has read and can be stopped', async () => {
    const many: Record<string, string> = { '/work/old.md': 'x' }
    for (let n = 0; n < 40; n++) many[`/work/f${n}.md`] = '[o](old.md)\n'
    await start(many)
    const root = mountBanner()
    let sawProgress = false
    const stop = watchRef(
      rewriteState,
      (state: RewriteState | null) => {
        if (state?.phase === 'scanning' && state.scanned >= 3) {
          sawProgress = true
          cancelRewriteScan()
        }
      },
      { flush: 'sync' },
    )
    await rename('/work/old.md', 'new.md')
    await flush()
    stop()
    expect(sawProgress).toBe(true)
    expect(phases).toContain('scanning')
    expect(phases).not.toContain('asking')
    expect(host.files.has('/work/old.md')).toBe(true)
    expect(host.files.read('/work/f0.md')).toBe('[o](old.md)\n')
    expect(root.querySelector('[data-rewrite-banner]')).toBeNull()
  })

  it('shows the count in the banner while it runs', async () => {
    const many: Record<string, string> = { '/work/old.md': 'x' }
    for (let n = 0; n < 20; n++) many[`/work/f${n}.md`] = '[o](old.md)\n'
    await start(many)
    const root = mountBanner()
    let shown = ''
    const stop = watchRef(
      rewriteState,
      async (state: RewriteState | null) => {
        if (state?.phase === 'scanning' && state.scanned === 5) {
          await nextTick()
          shown = root.querySelector('[data-rewrite-progress]')?.textContent.trim() ?? ''
        }
      },
      { flush: 'sync' },
    )
    const running = rename('/work/old.md', 'new.md')
    await flush()
    stop()
    expect(shown).toContain('5 files checked')
    cancelRewriteScan()
    await running
  })
})

describe('files that could not be changed (ISC-128, from the page)', () => {
  it('folds the files that could not be checked behind their title, one cut-off line each', async () => {
    await start()
    settings.links.onRename = 'update'
    const root = mountBanner()
    const original = host.rewritePlan.bind(host)
    host.rewritePlan = async (...args) => ({
      ...(await original(...args)),
      skipped: [
        { path: '/work/latin1.md', reason: 'its encoding is not one mdmate writes' },
        { path: '/work/other.md', reason: 'its encoding is not one mdmate writes' },
      ],
    })
    await rename('/work/old.md', 'new.md')
    await flush()
    expect(text(root)).toContain('2 files could not be checked')
    expect(root.querySelector('[data-rewrite-list]')).toBeNull()
    root.querySelector<HTMLButtonElement>('[data-rewrite-toggle="skipped"]')?.click()
    await nextTick()
    const rows = [...root.querySelectorAll('[data-rewrite-list="skipped"] li')]
    expect(rows.map((row) => row.querySelector('.text-primary')?.textContent.trim())).toEqual([
      'latin1.md',
      'other.md',
    ])
    expect(rows.every((row) => row.querySelectorAll('.truncate').length === 2)).toBe(true)
    // The keyboard is on Dismiss, not on the fold, so Enter closes the report.
    expect(document.activeElement?.getAttribute('data-answer')).toBe('dismiss')
  })

  it('lists each with its reason after the others were written', async () => {
    await start()
    settings.links.onRename = 'update'
    const root = mountBanner()
    // Another program edits a.md between the scan and the move.
    const original = host.rewritePlan.bind(host)
    host.rewritePlan = async (...args) => {
      const planned = await original(...args)
      host.files.write('/work/a.md', 'edited meanwhile [o](old.md)\n')
      return planned
    }
    await rename('/work/old.md', 'new.md')
    await flush()
    expect(host.files.read('/work/sub/b.md')).toBe('back [o](../new.md)\n')
    expect(host.files.read('/work/a.md')).toBe('edited meanwhile [o](old.md)\n')
    expect(rewriteState.value?.phase).toBe('report')
    expect(text(root)).toContain('Updated links in 1 file.')
    expect(text(root)).toContain('1 file kept its old links')
    // The list is folded away behind its title until the chevron is clicked.
    expect(root.querySelector('[data-rewrite-list]')).toBeNull()
    const toggle = root.querySelector<HTMLButtonElement>('[data-rewrite-toggle="failed"]')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle?.querySelector('svg')).not.toBeNull()
    toggle?.click()
    await nextTick()
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    const list = root.querySelector('[data-rewrite-list="failed"]')
    expect(list?.textContent).toContain('a.md')
    expect(list?.textContent).toContain('changed')
    // The name has its own colour and the line is cut with an ellipsis, not wrapped.
    expect(list?.querySelector('.text-primary')?.textContent.trim()).toBe('a.md')
    expect(list?.querySelectorAll('.truncate').length).toBe(2)
    toggle?.click()
    await nextTick()
    expect(root.querySelector('[data-rewrite-list]')).toBeNull()

    dismissRewriteReport()
    await nextTick()
    expect(root.querySelector('[data-rewrite-banner]')).toBeNull()
  })
})

describe('Rename from F2 and the tab menu (ISC-217)', () => {
  let removeCommands: (() => void) | undefined

  beforeEach(() => {
    clearCommands()
    removeCommands = registerDefaultCommands()
  })

  afterEach(() => {
    removeCommands?.()
    clearCommands()
  })

  it('F2 renames the active file through the rewrite flow: links change and the tab follows', async () => {
    settings.links.onRename = 'ask'
    await start()
    const root = mountBanner()
    const tab = await openPath('/work/old.md')
    expect(isCommandEnabled(COMMAND_IDS.rename)).toBe(true)
    await runCommand(COMMAND_IDS.rename)
    await flush()
    // The name box is open on the file's row.
    expect(naming.value).toMatchObject({ kind: 'rename', path: '/work/old.md' })

    const running = commitNaming('new.md')
    await flush()
    // The same question a rename from the tree asks.
    expect(text(root)).toContain('Update links to old.md?')
    answerRewrite('update')
    await running
    await flush()
    expect(host.files.read('/work/a.md')).toBe('one [o](new.md), two [o](new.md#top)\n')
    expect(host.files.read('/work/sub/b.md')).toBe('back [o](../new.md)\n')
    expect(documentOfTab(tab)?.path).toBe('/work/new.md')
    expect(tabTitle(tab)).toBe('new.md')
  })

  it('the tab menu renames a tab that is in the background', async () => {
    await start()
    settings.links.onRename = 'update'
    const old = await openPath('/work/old.md')
    await openPath('/work/none.md') // the active tab is another file
    await renameTab(old)
    await flush()
    expect(naming.value).toMatchObject({ kind: 'rename', path: '/work/old.md' })
    await commitNaming('renamed.md')
    await flush()
    expect(host.files.read('/work/a.md')).toBe('one [o](renamed.md), two [o](renamed.md#top)\n')
    expect(documentOfTab(old)?.path).toBe('/work/renamed.md')
    expect(tabTitle(old)).toBe('renamed.md')
  })

  it('a name that is taken is refused in the box and nothing is rewritten', async () => {
    await start()
    await openPath('/work/old.md')
    await runCommand(COMMAND_IDS.rename)
    await flush()
    await commitNaming('a.md')
    await flush()
    expect(naming.value?.error).not.toBeNull()
    expect(host.files.has('/work/old.md')).toBe(true)
    expect(host.files.read('/work/a.md')).toBe(FILES['/work/a.md'])
  })

  it('F2 is off with no tab open and for a file outside every folder', async () => {
    await start({ ...FILES, '/outside/o.md': 'o\n' })
    expect(isCommandEnabled(COMMAND_IDS.rename)).toBe(false)
    await openPath('/outside/o.md')
    expect(isCommandEnabled(COMMAND_IDS.rename)).toBe(false)
  })
})
