import type { ScenarioContext, ScenarioOutput } from './params'

/** What the index holds for `workspace-100k` (`scripts/lib/indexWorkspace.ts`). */
const EXPECTED_FILES = 100_000

/** Rounds of the whole query list that are timed, after one round that is dropped. */
const ROUNDS = 12

/** How many results Ctrl+P asks for. */
const LIMIT = 50

/**
 * What people type into Ctrl+P, on 100,000 files. Each is a state of the box on the way to a file,
 * so the list holds the short ones that match nearly everything (the dearest to score and to sort)
 * as well as the long ones and one that matches nothing.
 */
const QUERIES = [
  'a',
  'n',
  'no',
  'not',
  'note',
  'plan md',
  'rdme',
  'mtg',
  'budget alpha',
  'area-42',
  'area-42/sub-3/plan',
  'spec-tunnel 0',
  'idea.md',
  'zzzq',
] as const

/**
 * How long Ctrl+P takes to answer on a workspace of 100,000 files: from the page asking until the
 * answer is back, through the Tauri bridge, the scoring in Rust and the parse of the answer in the
 * page. The index is built first and left idle, so this is the cost of a query and nothing else (the
 * cost of typing while the index builds is the job of `typing-during-indexing`).
 *
 * Every query in `QUERIES` is asked once per round, 12 rounds, after a first round that is dropped
 * (the first call also faults in the code and the thread pool). The headline is the p95 over every
 * timed ask. The run fails if the index did not hold exactly 100,000 files, if a query that must
 * match found nothing, or if a file under an excluded folder was ever offered.
 *
 * The wording of the scenario was written into `ai-docs/phases/phase-07.1/decisions.md` before its
 * first run.
 */
export async function quickOpenQuery(ctx: ScenarioContext): Promise<ScenarioOutput> {
  const perf = ctx.host.perf
  if (perf === undefined) throw new Error('this scenario needs the perf bridge')
  await perf.grantRoot(ctx.fixture('workspace-100k'))
  const idle = await perf.indexIdle()
  if (idle.files !== EXPECTED_FILES) {
    throw new Error(
      `the index held ${String(idle.files)} files; expected ${String(EXPECTED_FILES)}`,
    )
  }

  const askMs: number[] = []
  const byQuery = new Map<string, number[]>()
  const totals = new Map<string, number>()
  for (let round = 0; round <= ROUNDS; round++) {
    for (const query of QUERIES) {
      const t0 = performance.now()
      const answer = await ctx.host.quickOpenQuery(query, LIMIT)
      const took = performance.now() - t0
      if (answer.indexed !== EXPECTED_FILES) {
        throw new Error(
          `"${query}" saw ${String(answer.indexed)} files; expected ${String(EXPECTED_FILES)}`,
        )
      }
      if (answer.items.some((item) => /^(node_modules|target)\//.test(item.rel))) {
        throw new Error(`"${query}" offered a file under an excluded folder`)
      }
      if (round === 0) {
        totals.set(query, answer.total)
        if (query !== 'zzzq' && answer.items.length === 0) {
          throw new Error(`"${query}" found nothing on a workspace it must match`)
        }
        if (query === 'zzzq' && answer.total !== 0) throw new Error('"zzzq" matched files')
        continue
      }
      askMs.push(took)
      const list = byQuery.get(query) ?? []
      list.push(took)
      byQuery.set(query, list)
    }
  }

  const median = (list: number[]): number => {
    const sorted = [...list].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
  }
  const medians: Record<string, number> = {}
  const matched: Record<string, number> = {}
  for (const query of QUERIES) {
    medians[query] = median(byQuery.get(query) ?? [])
    matched[query] = totals.get(query) ?? Number.NaN
  }
  return {
    samples: { askMs },
    values: { filesIndexed: idle.files, queriesTimed: askMs.length },
    notes: { medianByQueryMs: medians, filesMatchedByQuery: matched },
  }
}
