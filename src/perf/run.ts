import { windowShown } from '@/lib/lifecycle'
import { getHost } from '@/platform'
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
import { probeDecorations } from './throwawayDecorations'
import { typing } from './typing'

const scenarios: Record<string, (ctx: ScenarioContext) => Promise<ScenarioOutput>> = {
  startup,
  'open-1mb': open,
  'tab-switch': tabSwitch,
  'typing-1mb': (ctx) => typing(ctx, 'dispatch'),
  'typing-1mb-trusted': (ctx) => typing(ctx, 'trusted'),
  'open-10mb': (ctx) => open(ctx, 'realistic-10mb.md'),
  'typing-10mb': (ctx) => typing(ctx, 'dispatch', 'realistic-10mb.md'),
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
    const output = await run(ctx)
    if (ctx.params.decorations === 1) Object.assign(output.values, probeDecorations())
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
