import type { Host, PerfConfig } from '@/platform'

/** Knobs the harness can override through `MDMATE_PERF_PARAMS`. */
export interface PerfParams {
  /** open-1mb: opens per run. The first one is the cold open. */
  opens: number
  /** tab-switch: switches kept per run, after `warmupSwitches` that are dropped. */
  switches: number
  warmupSwitches: number
  /** typing: keys kept per run, after `warmupKeys` that are dropped, `keyIntervalMs` apart. */
  keys: number
  warmupKeys: number
  keyIntervalMs: number
}

export const DEFAULT_PARAMS: PerfParams = {
  // The first attempt used 6 opens and 40 switches, and their medians and p95s moved too much
  // between runs to repeat. More samples per run make the estimate steadier; the rule is unchanged.
  opens: 16,
  switches: 120,
  warmupSwitches: 6,
  keys: 300,
  warmupKeys: 30,
  keyIntervalMs: 50,
}

/** What a scenario hands back. The harness computes every statistic from these raw numbers. */
export interface ScenarioOutput {
  /** Named lists of measurements in milliseconds. */
  samples: Record<string, number[]>
  /** Named single values: wall-clock marks in epoch ms, counts and sizes. */
  values: Record<string, number>
}

export interface ScenarioContext {
  host: Host
  config: PerfConfig
  params: PerfParams
  /** The path of a generated fixture. */
  fixture(name: string): string
}

/** How the page looked while it was measured, so a throttled run can be spotted afterwards. */
export interface PageEnv {
  visibility: string
  hasFocus: boolean
  devicePixelRatio: number
  innerWidth: number
  innerHeight: number
  userAgent: string
  /** Mean ms between animation frames. About 16.7 on a 60 Hz display; 0 when not measured. */
  rafMeanMs: number
}

export interface PerfReport extends ScenarioOutput {
  scenario: string
  ok: boolean
  error?: string
  env: PageEnv
}
