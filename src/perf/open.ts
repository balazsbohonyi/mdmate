import { Document } from '@/documents/document'
import { createState, createView } from '@/editor/create'
import type { ScenarioContext, ScenarioOutput } from './params'
import { framePresented, mountEditorHost, sleep } from './support'

/**
 * Opening a file the way the app does, into an editor that is already running: Rust reads and
 * decodes it and sends the frame over IPC (`openFile`), the page builds the document and the tab's
 * editor state, shows it, and waits for the frame. The first open of the run is the cold one; the
 * harness reports it apart from the rest.
 *
 * Between opens the document is closed in Rust, as closing its last tab does, so every open starts
 * from the same place. The parser follows the scenario's `parser` knob, so the size-cutoff scenarios
 * keep measuring what they were made to measure; the app's own cutoff is tested in
 * `tests/documents/largeFile.test.ts`.
 */
export async function open(
  ctx: ScenarioContext,
  fixture = 'realistic-1mb.md',
): Promise<ScenarioOutput> {
  // A document brings live preview with its parser, the way the app opens one.
  const options = { parser: ctx.params.parser !== 0 }
  const path = ctx.fixture(fixture)
  const empty = createState('', [], { parser: options.parser, preview: options.parser })
  const view = createView(mountEditorHost(), empty)
  await framePresented()

  const totalMs: number[] = []
  const openMs: number[] = []
  const documentMs: number[] = []
  const showMs: number[] = []
  const paintMs: number[] = []
  let bytesRead = 0

  for (let i = 0; i < ctx.params.opens; i++) {
    const t0 = performance.now()
    const opened = await ctx.host.openFile(path)
    const t1 = performance.now()
    const doc = new Document(opened, () => undefined, options)
    const tab = doc.followerFor('tab-open')
    const t2 = performance.now()
    tab.show(view)
    const t3 = performance.now()
    const t4 = await framePresented()

    bytesRead = opened.size
    totalMs.push(t4 - t0)
    openMs.push(t1 - t0)
    documentMs.push(t2 - t1)
    showMs.push(t3 - t2)
    paintMs.push(t4 - t3)

    // Back to an empty tab and a short rest, so each open starts from the same place.
    tab.park()
    view.setState(empty)
    await ctx.host.closeDocument(opened.id)
    await framePresented()
    await sleep(200)
  }

  return {
    samples: { totalMs, openMs, documentMs, showMs, paintMs },
    values: { bytes: bytesRead },
  }
}
