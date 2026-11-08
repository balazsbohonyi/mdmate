import { Document } from '@/documents/document'
import type { Follower } from '@/documents/follower'
import { createView } from '@/editor/create'
import type { ScenarioContext, ScenarioOutput } from './params'
import { framePresented, mountEditorHost, sleep } from './support'

/**
 * Two 1 MB documents open in one pane, switched back and forth the way the app swaps tabs. Each
 * file is opened through Rust, each tab is a follower of its document, and a switch parks the tab
 * it leaves and shows the other with `view.setState`. Each switch is timed until the frame is
 * produced. The warm-up switches are dropped.
 *
 * Every other switch lands on a tab whose document was edited meanwhile in another pane, so that
 * switch also applies the change the parked tab had only noted. That is the dearest switch there
 * is, and it counts toward the target like any other.
 */
export async function tabSwitch(ctx: ScenarioContext): Promise<ScenarioOutput> {
  const [a, b] = await Promise.all([
    ctx.host.openFile(ctx.fixture('realistic-1mb.md')),
    ctx.host.openFile(ctx.fixture('tables-heavy-1mb.md')),
  ])
  // A document brings live preview with its parser, the way the app opens one.
  const options = { parser: ctx.params.parser !== 0 }
  const docs = [
    new Document(a, () => undefined, options),
    new Document(b, () => undefined, options),
  ]
  const tabs: Follower[] = docs.map((doc, i) => doc.followerFor(`tab-${i}`))
  // The "other pane" of each document: a second follower that no view shows, used to edit it.
  const elsewhere: Follower[] = docs.map((doc, i) => doc.followerFor(`elsewhere-${i}`))

  const first = tabs[0]
  if (first === undefined) throw new Error('tab is missing')
  const view = createView(mountEditorHost(), first.state)
  first.show(view)
  await framePresented()

  const totalMs: number[] = []
  const syncMs: number[] = []
  const plainMs: number[] = []
  const pendingMs: number[] = []
  let current = 0

  for (let i = 0; i < ctx.params.warmupSwitches + ctx.params.switches; i++) {
    const target = 1 - current
    const withPending = i % 2 === 1
    const next = tabs[target]
    if (!next) throw new Error('tab is missing')
    // Like a real tab strip: park the tab we leave, then show the other one.
    tabs[current]?.park()
    current = target
    if (withPending) elsewhere[target]?.dispatch({ changes: { from: 0, insert: 'x' } })

    const t0 = performance.now()
    next.show(view)
    const t1 = performance.now()
    const t2 = await framePresented()

    if (i >= ctx.params.warmupSwitches) {
      totalMs.push(t2 - t0)
      syncMs.push(t1 - t0)
      ;(withPending ? pendingMs : plainMs).push(t2 - t0)
    }
    await sleep(100)
  }

  return {
    samples: { totalMs, syncMs, plainMs, pendingMs },
    values: { warmupSwitches: ctx.params.warmupSwitches },
  }
}
