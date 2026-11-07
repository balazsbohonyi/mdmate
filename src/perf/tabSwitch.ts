import type { EditorState } from '@codemirror/state'
import { createState, createView } from '@/editor/create'
import type { ScenarioContext, ScenarioOutput } from './params'
import { decodeUtf8, framePresented, mountEditorHost, sleep } from './support'

/**
 * Two 1 MB documents open in one pane, switched back and forth with `view.setState`, which is how
 * the app swaps tabs. Each switch is timed until the frame is produced. The warm-up switches are
 * dropped.
 */
export async function tabSwitch(ctx: ScenarioContext): Promise<ScenarioOutput> {
  const [a, b] = await Promise.all([
    ctx.host.readFile(ctx.fixture('realistic-1mb.md')),
    ctx.host.readFile(ctx.fixture('tables-heavy-1mb.md')),
  ])
  const tabs: EditorState[] = [createState(decodeUtf8(a)), createState(decodeUtf8(b))]
  const view = createView(mountEditorHost(), tabs[0] ?? createState(''))
  await framePresented()

  const totalMs: number[] = []
  const syncMs: number[] = []
  let current = 0

  for (let i = 0; i < ctx.params.warmupSwitches + ctx.params.switches; i++) {
    // Like a real tab strip: park the state of the tab we leave, then show the other one.
    tabs[current] = view.state
    current = 1 - current
    const next = tabs[current]
    if (!next) throw new Error('tab state is missing')

    const t0 = performance.now()
    view.setState(next)
    const t1 = performance.now()
    const t2 = await framePresented()

    if (i >= ctx.params.warmupSwitches) {
      totalMs.push(t2 - t0)
      syncMs.push(t1 - t0)
    }
    await sleep(100)
  }

  return {
    samples: { totalMs, syncMs },
    values: { warmupSwitches: ctx.params.warmupSwitches },
  }
}
