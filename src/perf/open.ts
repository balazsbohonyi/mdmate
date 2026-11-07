import { createState, createView } from '@/editor/create'
import type { ScenarioContext, ScenarioOutput } from './params'
import { throwawayDecorations } from './throwawayDecorations'
import { decodeUtf8, framePresented, mountEditorHost, sleep } from './support'

/**
 * Opening a 1 MB file into an editor that is already running: read the bytes over IPC, decode
 * them, build the state, show it, and wait for the frame. The first open of the run is the cold
 * one; the harness reports it apart from the rest.
 */
export async function open(
  ctx: ScenarioContext,
  fixture = 'realistic-1mb.md',
): Promise<ScenarioOutput> {
  const extensions = throwawayDecorations(ctx.params)
  const path = ctx.fixture(fixture)
  const empty = createState('', extensions)
  const view = createView(mountEditorHost(), empty)
  await framePresented()

  const totalMs: number[] = []
  const ipcMs: number[] = []
  const decodeMs: number[] = []
  const stateMs: number[] = []
  const showMs: number[] = []
  const paintMs: number[] = []
  let bytesRead = 0

  for (let i = 0; i < ctx.params.opens; i++) {
    const t0 = performance.now()
    const bytes = await ctx.host.readFile(path)
    const t1 = performance.now()
    const text = decodeUtf8(bytes)
    const t2 = performance.now()
    const state = createState(text, extensions)
    const t3 = performance.now()
    view.setState(state)
    const t4 = performance.now()
    const t5 = await framePresented()

    bytesRead = bytes.byteLength
    totalMs.push(t5 - t0)
    ipcMs.push(t1 - t0)
    decodeMs.push(t2 - t1)
    stateMs.push(t3 - t2)
    showMs.push(t4 - t3)
    paintMs.push(t5 - t4)

    // Back to an empty tab and a short rest, so each open starts from the same place.
    view.setState(empty)
    await framePresented()
    await sleep(200)
  }

  return {
    samples: { totalMs, ipcMs, decodeMs, stateMs, showMs, paintMs },
    values: { bytes: bytesRead },
  }
}
