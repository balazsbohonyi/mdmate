import { windowShown } from '@/lib/lifecycle'
import { getHost } from '@/platform'
import { assetScope } from './assetScope'
import { dragAuto, dragByHand } from './dragLab'
import { crashRestore } from './crashRestore'
import { decorationScale } from './decorationScale'
import { journalCost } from './journalCost'
import { SIZES_MB } from './params'
import { labByHand } from './lab'
import { open } from './open'
import {
  DEFAULT_PARAMS,
  type PageEnv,
  type PerfParams,
  type PerfReport,
  type ScenarioContext,
  type ScenarioOutput,
} from './params'
import { startup } from './startup'
import { framePresented, measureFrameCadence, snapshotEnv } from './support'
import { tabSwitch } from './tabSwitch'
import { probePreview } from './previewProbe'
import { reveal } from './reveal'
import { scrollStability } from './scrollStability'
import { typing } from './typing'
import { typingDuringScan } from './typingDuringScan'
import { typingDuringSearch } from './typingDuringSearch'
import { typingFindOpen } from './typingFindOpen'
import { typingOutlineOpen } from './typingOutlineOpen'

/** The size-cutoff scenarios: open and type in a generated document of each size, in MB. */
function sizedScenarios(): Record<string, (ctx: ScenarioContext) => Promise<ScenarioOutput>> {
  const out: Record<string, (ctx: ScenarioContext) => Promise<ScenarioOutput>> = {}
  for (const mb of SIZES_MB) {
    const file = `realistic-${String(mb)}mb.md`
    out[`open-${String(mb)}mb`] = (ctx) => open(ctx, file)
    out[`typing-${String(mb)}mb`] = (ctx) => typing(ctx, 'dispatch', file)
  }
  return out
}

const scenarios: Record<string, (ctx: ScenarioContext) => Promise<ScenarioOutput>> = {
  startup,
  'open-1mb': open,
  'tab-switch': tabSwitch,
  'typing-1mb': (ctx) => typing(ctx, 'dispatch'),
  'typing-1mb-trusted': (ctx) => typing(ctx, 'trusted'),
  'typing-during-scan': typingDuringScan,
  'typing-during-search': (ctx) => typingDuringSearch(ctx, 'dispatch'),
  'typing-during-search-trusted': (ctx) => typingDuringSearch(ctx, 'trusted'),
  'typing-find-open': (ctx) => typingFindOpen(ctx, 'dispatch'),
  'typing-find-open-trusted': (ctx) => typingFindOpen(ctx, 'trusted'),
  'typing-outline-open': (ctx) => typingOutlineOpen(ctx, 'dispatch'),
  'typing-outline-open-trusted': (ctx) => typingOutlineOpen(ctx, 'trusted'),
  ...sizedScenarios(),
  'crash-restore': crashRestore,
  'journal-cost': journalCost,
  'decorations-scale': decorationScale,
  reveal,
  'scroll-stability': scrollStability,
  'asset-scope': assetScope,
  lab: labByHand,
  'drag-auto': dragAuto,
  'lab-drag': dragByHand,
}

/**
 * Paint timings mean nothing when the window is hidden or throttled, so this checks first.
 * A hidden window pauses animation frames, and the run fails rather than report numbers that lie.
 */
async function checkWindow(): Promise<PageEnv> {
  await windowShown
  await framePresented()
  const env = snapshotEnv()
  if (env.visibility !== 'visible') {
    throw new Error(`the window is ${env.visibility}, so paint timings would be wrong`)
  }
  const rafMeanMs = await measureFrameCadence()
  if (rafMeanMs > 25) {
    throw new Error(`animation frames arrive every ${rafMeanMs.toFixed(1)} ms; expected about 16.7`)
  }
  return snapshotEnv(rafMeanMs)
}

/** Runs the scenario the harness asked for, hands the result back, and lets the app quit. */
export async function runPerf(): Promise<void> {
  const host = await getHost()
  const perf = host.perf
  if (!perf) return
  const config = await perf.config()

  let report: PerfReport
  try {
    const run = scenarios[config.scenario]
    if (!run) throw new Error(`unknown scenario "${config.scenario}"`)
    const overrides = (config.params ? JSON.parse(config.params) : {}) as Partial<PerfParams>
    const ctx: ScenarioContext = {
      host,
      config,
      params: { ...DEFAULT_PARAMS, ...overrides },
      fixture: (name) => `${config.fixturesDir}/generated/${name}`,
    }
    // Startup times the wait for the window itself, so it is measured before any check.
    const env = config.scenario === 'startup' ? undefined : await checkWindow()
    // crash-restore phase 1 never returns here: it reports through `ready` and waits to be killed.
    const output = await run(ctx)
    if (ctx.params.preview === 1) Object.assign(output.values, probePreview())
    report = { scenario: config.scenario, ok: true, env: env ?? snapshotEnv(), ...output }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    report = {
      scenario: config.scenario,
      ok: false,
      error: message,
      env: snapshotEnv(),
      samples: {},
      values: {},
    }
  }
  await perf.report(JSON.stringify(report))
}
