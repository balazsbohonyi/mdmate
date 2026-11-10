// @vitest-environment jsdom
/**
 * Renaming and moving with links (P6-T6): ISC-126 (the counts are shown first), ISC-127
 * (`links.confirmRewrite: false` skips the question) and the answers, the progress, the stop and
 * the list of files that could not be changed. The mock host reads plain inline links only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, watch as watchRef, type App } from 'vue'
import { problem, resetDocuments } from '@/documents/store'
import RewriteBanner from '@/features/links/RewriteBanner.vue'
import {
  answerRewrite,
  cancelRewriteScan,
  dismissRewriteReport,
  rewriteState,
  type RewriteState,
} from '@/features/links/rewrite'
import { commitNaming, moveRow, renameRow } from '@/features/tree/ops'
import { naming, resetTree, restoreWorkspace } from '@/features/tree/store'
import { resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'

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

async function start(files: Record<string, string> = FILES): Promise<void> {
  host = createMockHost({ files, roots: ['/work'] })
  setHost(host)
  await restoreWorkspace([])
  await flush()
}

function mountBanner(): HTMLElement {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(RewriteBanner)
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

describe('the question before links are rewritten (ISC-126)', () => {
  it('shows how many links in how many files, and changes nothing until the answer', async () => {
    await start()
    const root = mountBanner()
    const running = rename('/work/old.md', 'new.md')
    await flush()
    expect(root.querySelector('[data-rewrite-banner]')?.getAttribute('data-phase')).toBe('asking')
    expect(root.querySelector('[data-links]')?.textContent).toBe('3 links')
    expect(root.querySelector('[data-files]')?.textContent).toBe('2 files')
    expect(text(root)).toContain('Update 3 links in 2 files?')
    // The name box is gone: the question is the only thing waiting for an answer.
    expect(naming.value).toBeNull()
    // Nothing has moved or changed while the question is open.
    expect(host.files.has('/work/old.md')).toBe(true)
    expect(host.files.read('/work/a.md')).toBe(FILES['/work/a.md'])

    root.querySelector<HTMLButtonElement>('[data-answer="update"]')?.click()
    await running
    await flush()
    expect(host.files.has('/work/new.md')).toBe(true)
    expect(host.files.read('/work/a.md')).toBe('one [o](new.md), two [o](new.md#top)\n')
    expect(host.files.read('/work/sub/b.md')).toBe('back [o](../new.md)\n')
    expect(host.files.read('/work/none.md')).toBe(FILES['/work/none.md'])
    expect(root.querySelector('[data-rewrite-banner]')).toBeNull()
  })

  it('says "1 link in 1 file" in the singular', async () => {
    await start({ '/work/old.md': 'x', '/work/a.md': '[o](old.md)\n' })
    const root = mountBanner()
    const running = rename('/work/old.md', 'new.md')
    await flush()
    expect(text(root)).toContain('Update 1 link in 1 file?')
    answerRewrite('update')
    await running
  })

  it('Cancel leaves the file where it was and every link as it was', async () => {
    await start()
    const running = rename('/work/old.md', 'new.md')
    await flush()
    answerRewrite('cancel')
    await running
    await flush()
    expect(host.files.has('/work/old.md')).toBe(true)
    expect(host.files.has('/work/new.md')).toBe(false)
    expect(host.files.read('/work/a.md')).toBe(FILES['/work/a.md'])
    expect(naming.value).toBeNull()
    expect(rewriteState.value).toBeNull()
  })

  it('forgets the plan when the answer is Cancel', async () => {
    await start()
    const discarded: number[] = []
    const original = host.rewriteDiscard.bind(host)
    host.rewriteDiscard = (token) => {
      discarded.push(token)
      return original(token)
    }
    const running = rename('/work/old.md', 'new.md')
    await flush()
    answerRewrite('cancel')
    await running
    expect(discarded).toHaveLength(1)
    expect(discarded[0]).toBeGreaterThan(0)
  })

  it('asks by default', () => {
    expect(settings.links.confirmRewrite).toBe(true)
  })

  it("Don't update moves the file and leaves every link alone", async () => {
    await start()
    const running = rename('/work/old.md', 'new.md')
    await flush()
    answerRewrite('move-only')
    await running
    await flush()
    expect(host.files.has('/work/new.md')).toBe(true)
    expect(host.files.has('/work/old.md')).toBe(false)
    expect(host.files.read('/work/a.md')).toBe(FILES['/work/a.md'])
  })

  it('does not ask when no link needs to change', async () => {
    await start()
    await rename('/work/none.md', 'still-none.md')
    await flush()
    expect(phases).not.toContain('asking')
    expect(host.files.has('/work/still-none.md')).toBe(true)
  })

  it('asks for a move too', async () => {
    await start()
    const root = mountBanner()
    const running = moveRow('/work/old.md', '/work/sub2')
    await flush()
    expect(text(root)).toContain('Update 3 links in 2 files?')
    answerRewrite('update')
    await running
    await flush()
    expect(host.files.read('/work/a.md')).toBe('one [o](sub2/old.md), two [o](sub2/old.md#top)\n')
    expect(host.files.read('/work/sub/b.md')).toBe('back [o](../sub2/old.md)\n')
  })

  it('keeps a name that is taken in the box with the reason, and scans nothing', async () => {
    await start()
    await rename('/work/old.md', 'a.md')
    expect(naming.value?.error).toContain('already exists')
    expect(phases).not.toContain('asking')
    expect(host.files.has('/work/old.md')).toBe(true)
  })
})

describe('links.confirmRewrite: false (ISC-127)', () => {
  it('rewrites without asking', async () => {
    await start()
    settings.links.confirmRewrite = false
    await rename('/work/old.md', 'new.md')
    await flush()
    expect(phases).not.toContain('asking')
    expect(host.files.read('/work/a.md')).toBe('one [o](new.md), two [o](new.md#top)\n')
    expect(host.files.has('/work/new.md')).toBe(true)
  })

  it('asks again when the setting is back on', async () => {
    await start()
    settings.links.confirmRewrite = false
    settings.links.confirmRewrite = true
    const running = rename('/work/old.md', 'new.md')
    await flush()
    expect(rewriteState.value?.phase).toBe('asking')
    answerRewrite('cancel')
    await running
  })
})

describe('the scan', () => {
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
    answerRewrite('cancel')
    await running
  })
})

describe('files that could not be changed (ISC-128, from the page)', () => {
  it('lists each with its reason after the others were written', async () => {
    await start()
    settings.links.confirmRewrite = false
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
    expect(text(root)).toContain('1 file kept its old links')
    expect(root.querySelector('[data-rewrite-failed]')?.textContent).toContain('a.md')
    expect(root.querySelector('[data-rewrite-failed]')?.textContent).toContain('changed')

    dismissRewriteReport()
    await nextTick()
    expect(root.querySelector('[data-rewrite-banner]')).toBeNull()
  })
})
