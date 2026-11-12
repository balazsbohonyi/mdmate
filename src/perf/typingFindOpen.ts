import { EMPTY_FIND, findEffect } from '@/editor/find'
import type { ScenarioContext, ScenarioOutput } from './params'
import { typing, type TypingMode } from './typing'

/** One letter, the query that marks the most in a viewport: the cap of 1,500 marks is the limit. */
const QUERY = 'e'

/**
 * ISC-260's cost: typing with the find bar's query active. It is the `typing-1mb` scenario,
 * unchanged (same document, caret, keys, measure), with the query "e" (Match case off, Whole word
 * off) set on the editor before the keys, so the match marks of the viewport are made again at
 * every key, as they are when someone types with the bar open.
 *
 * What it does not include: the bar's own match count. That runs on a timer 250 ms after the last
 * edit (so not between keys typed 50 ms apart), is bounded to 20 ms, and was timed in the real
 * window in P7-T1. The bar itself (a Vue component in the pane) is not mounted; it holds the query
 * and reads the count, neither of which is work at a key. The scenario counts the marks in the DOM
 * every 200 ms and fails if it never sees one. Its wording was written into
 * `ai-docs/phases/phase-07/decisions.md` before its first run.
 */
export async function typingFindOpen(
  ctx: ScenarioContext,
  mode: TypingMode,
): Promise<ScenarioOutput> {
  let marksMax = 0
  let sampler: ReturnType<typeof setInterval> | undefined
  let out: ScenarioOutput
  try {
    out = await typing(ctx, mode, 'realistic-1mb.md', (view) => {
      view.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: QUERY }) })
      sampler = setInterval(() => {
        marksMax = Math.max(marksMax, view.dom.querySelectorAll('.cm-md-find').length)
      }, 200)
    })
  } finally {
    clearInterval(sampler)
  }
  if (marksMax === 0) throw new Error('the editor never drew a match mark; nothing was measured')
  return { samples: out.samples, values: { ...out.values, marksDrawnMax: marksMax } }
}
