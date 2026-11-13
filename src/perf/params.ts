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
  /** 1 (the default) puts live preview in the standalone editors, 0 is plain CodeMirror: the baseline. */
  preview: number
  /** 0 opens documents as plain source, with no Markdown parser (P0-T9 size cutoff). */
  parser: number
  /** typing-outline-open: 1 mounts the Outline panel, 0 makes the same edits with no panel (the control that shows what the panel itself costs). */
  outline: number
  /** typing-outline-open: 0 stops the session journal before the keys, to show what it costs a key (default 1, the app's own behaviour). */
  journal: number
  /** crash-restore: 1 builds the session and reports it (the harness then kills the app), 2 restores it and reports what came back. */
  phase: number
  /** Where the harness generated the 100,000-file workspace (`scripts/perf.ts`); empty when it did not. */
  bigWorkspace: string
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
  preview: 1,
  parser: 1,
  outline: 1,
  journal: 1,
  phase: 0,
  bigWorkspace: '',
}

/** What a scenario hands back. The harness computes every statistic from these raw numbers. */
export interface ScenarioOutput {
  /** Named lists of measurements in milliseconds. */
  samples: Record<string, number[]>
  /** Named single values: wall-clock marks in epoch ms, counts and sizes. */
  values: Record<string, number>
  /** Free-form findings, for the scenarios a person drives. */
  notes?: Record<string, unknown>
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

/** Sizes, in MB, of the generated documents behind the size-cutoff scenarios. */
export const SIZES_MB = [2, 3, 5, 10] as const
