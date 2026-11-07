import {
  buildSnapshot,
  JOURNAL_INTERVAL_MS,
  journalIsCurrent,
  journalStats,
  sessionReady,
} from '@/documents/session'
import { documentOfTab, followerOfTab, openPath } from '@/documents/store'
import { endingsOf } from '@/editor/lineEndings'
import { joinWithEndings } from '@/lib/endings'
import { allTabs, serialize } from '@/workbench/splitTree'
import { moveTabTo, selectTab, splitActivePane, workbenchLayout } from '@/workbench/store'
import type { ScenarioContext, ScenarioOutput } from './params'
import { epochNow, sleep } from './support'

/** What one tab looks like, in a form two runs can be compared on. */
interface TabState {
  id: string
  path: string
  dirty: boolean
  anchor: number
  head: number
  /** SHA-256 of the bytes a save would write: the text with every break's own ending. */
  sha256: string
  length: number
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function describeWorkbench(): Promise<{ layout: string; tabs: TabState[] }> {
  const layout = workbenchLayout.value
  const tabs: TabState[] = []
  for (const id of allTabs(layout)) {
    const doc = documentOfTab(id)
    if (doc === undefined) throw new Error(`tab ${id} has no document`)
    const raw = joinWithEndings(doc.master.doc.toString(), endingsOf(doc.master))
    const { anchor, head } = doc.caretOf(id)
    tabs.push({
      id,
      path: doc.path,
      dirty: doc.dirty,
      anchor,
      head,
      sha256: await sha256Hex(raw),
      length: raw.length,
    })
  }
  return { layout: JSON.stringify(serialize(layout)), tabs }
}

function typeAt(tab: string, from: number, insert: string): void {
  const follower = followerOfTab(tab)
  if (follower === undefined) throw new Error(`no editor for ${tab}`)
  follower.dispatch({ changes: { from, insert } })
}

/** Resolves when `done` is true, polling every 5 ms, or rejects after `timeoutMs`. */
async function until(done: () => boolean, timeoutMs: number, what: string): Promise<number> {
  const began = performance.now()
  while (!done()) {
    if (performance.now() - began > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await sleep(5)
  }
  return performance.now() - began
}

/**
 * Phase 1: a workbench with tabs in two panes, carets set, and unsaved edits in three files, one
 * with mixed line endings and one of 1 MB. It then waits for the journal to write by itself (no
 * flush, no close) and reports what it holds. The harness kills the app on that report.
 */
async function buildSession(ctx: ScenarioContext): Promise<ScenarioOutput> {
  const small = (name: string): string => `${ctx.config.fixturesDir}/${name}`
  const crlf = await openPath(small('crlf.md'))
  const mixed = await openPath(small('mixed-eol.md'))
  const big = await openPath(ctx.fixture('realistic-1mb.md'))
  await openPath(small('lf.md'))
  splitActivePane('row')
  moveTabTo(big, workbenchLayout.value.activePane)
  selectTab(mixed)

  followerOfTab(mixed)?.dispatch({ selection: { anchor: 5, head: 12 } })
  typeAt(crlf, 0, 'CRASH-A ')
  typeAt(mixed, 20, 'CRASH-MID ')
  const bigDoc = documentOfTab(big)
  if (bigDoc === undefined) throw new Error('the big document did not open')
  typeAt(big, 0, 'CRASH-HEAD ')
  typeAt(big, Math.floor(bigDoc.master.doc.length / 2), 'CRASH-MIDDLE ')
  followerOfTab(big)?.dispatch({ selection: { anchor: 1000 } })

  const editedAt = epochNow()
  const writesBefore = journalStats.writes
  // The journal writes on its own timer, with nothing here asking it to.
  const lagMs = await until(
    () => journalStats.writes > writesBefore,
    JOURNAL_INTERVAL_MS * 5,
    'the journal to write',
  )
  if (journalStats.lastError !== null)
    throw new Error(`the journal failed: ${journalStats.lastError}`)
  if (!journalIsCurrent()) throw new Error('the journal on disk is not the current state')

  const state = await describeWorkbench()
  const snapshotBytes = new TextEncoder().encode(buildSnapshot()).length
  const out: ScenarioOutput = {
    samples: {},
    values: {
      editedAtMs: editedAt,
      journalLagMs: lagMs,
      intervalMs: JOURNAL_INTERVAL_MS,
      snapshotBytes,
      buildMs: journalStats.lastBuildMs,
      writeMs: journalStats.lastWriteMs,
    },
    notes: { state },
  }
  const host = ctx.host.perf
  if (host === undefined) throw new Error('not a perf build')
  await host.ready(JSON.stringify({ scenario: 'crash-restore', ok: true, ...out }))
  // The harness ends the app now, the hard way. Nothing here may run another journal write.
  return new Promise<ScenarioOutput>(() => undefined)
}

/** Phase 2: the app started the normal way and restored by itself. Report what came back. */
async function reportRestored(): Promise<ScenarioOutput> {
  const restored = await sessionReady
  const state = await describeWorkbench()
  performance.measure('restore', 'restore-start', 'restore-end')
  const restoreMs = performance.getEntriesByName('restore')[0]?.duration ?? Number.NaN
  return {
    samples: {},
    values: {
      restoreMs,
      restoredTabs: restored?.tabs ?? 0,
      restoredBuffers: restored?.buffers ?? 0,
      notices: restored?.notices.length ?? 0,
    },
    notes: { state, notices: restored?.notices ?? [] },
  }
}

export function crashRestore(ctx: ScenarioContext): Promise<ScenarioOutput> {
  if (ctx.params.phase === 1) return buildSession(ctx)
  if (ctx.params.phase === 2) return reportRestored()
  return Promise.reject(
    new Error('crash-restore needs --set phase=1 or phase=2; the harness sets it'),
  )
}
