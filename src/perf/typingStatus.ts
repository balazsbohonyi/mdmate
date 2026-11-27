import { Text } from '@codemirror/state'
import { createView } from '@/editor/create'
import type { ScenarioContext, ScenarioOutput } from './params'
import { mountEditorHost, waitUntil } from './support'
import { typing, type TypingMode } from './typing'

/**
 * ISC-774: typing with the status bar's file items. The `typing-1mb` keys and measurement, but the
 * editor shows a real document, opened as the app opens it, with the real status bar mounted under
 * it: each key moves `Ln` and `Col`, and asks for the counts again once the typing pauses.
 *
 * The keys come closer together than the pause the counts wait for, so only `Ln` and `Col` change
 * while they are measured. `countTurnMs` is what one turn of the counting costs by itself, which is
 * what a key arriving during it would wait.
 *
 * It fails if the bar showed no word count before the keys, or if its position never followed them.
 */
export async function typingStatus(
  ctx: ScenarioContext,
  mode: TypingMode,
): Promise<ScenarioOutput> {
  const perf = ctx.host.perf
  if (perf === undefined) throw new Error('this scenario needs the perf bridge')
  const fixture = ctx.fixture('realistic-1mb.md')
  await perf.grantRoot(fixture.replace(/[\\/][^\\/]*$/, ''))

  // Loaded now, not at the top: the bar is for this scenario only here.
  const [{ createApp }, { default: StatusBar }, docs, { textStats }, status] = await Promise.all([
    import('vue'),
    import('@/shell/StatusBar.vue'),
    import('@/documents/store'),
    import('@/editor/textStats'),
    import('@/features/status/fileStatus'),
  ])
  const tab = await docs.openPath(fixture)
  const follower = docs.followerOfTab(tab)
  if (follower === undefined) throw new Error('the fixture did not open')

  // The first turn of the first count, on a copy of the text nothing has been counted for.
  const unread = Text.of(follower.state.doc.toString().split('\n'))
  const started = performance.now()
  textStats(unread, { leaves: status.LEAVES_PER_TURN })
  const countTurnMs = performance.now() - started

  const footer = document.createElement('div')
  footer.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:5;display:flex;flex-direction:column;background:var(--color-statusbar)'
  document.body.append(footer)
  const app = createApp(StatusBar)
  app.mount(footer)
  const item = (name: string): string =>
    footer.querySelector(`[data-status-item="${name}"]`)?.textContent?.trim() ?? ''

  const view = createView(mountEditorHost(), follower.state)
  follower.show(view)
  await waitUntil(() => item('words') !== '', 20_000, 'the word count in the status bar')
  const wordsBefore = item('words')

  const positions = new Set<string>()
  const looking = new MutationObserver(() => positions.add(item('position')))
  looking.observe(footer, { subtree: true, childList: true, characterData: true })
  let out: ScenarioOutput
  try {
    out = await typing(ctx, mode, 'realistic-1mb.md', undefined, { view })
  } finally {
    looking.disconnect()
    app.unmount()
    footer.remove()
  }
  if (positions.size < ctx.params.keys / 2)
    throw new Error('the status bar did not follow the caret; nothing was measured')
  return {
    samples: out.samples,
    values: {
      ...out.values,
      wordsShown: Number(wordsBefore.replace(/\D/g, '')),
      positionsShown: positions.size,
      countTurnMs,
    },
  }
}
