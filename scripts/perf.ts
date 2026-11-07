#!/usr/bin/env node
/**
 * The perf harness. `pnpm perf <scenario...|all> [--runs 5] [--skip-build] [--fresh-profile]
 * [--set name=value]`.
 *
 * It builds the release app with the perf driver, launches it once per run, lets the app measure
 * itself on the real WebView2, and writes everything to perf-results/. Windows only for now.
 *
 * A window opens for every run. Leave the mouse and keyboard alone, and keep the window uncovered.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_PARAMS, SIZES_MB, type PerfParams, type PerfReport } from '../src/perf/params.ts'
import { driveDrag, driveTyping, sleep } from './lib/cdp.ts'
import { REPEATABILITY_RULE, median, repeatability, summarize } from './lib/perfStats.ts'

const ROOT = resolve(import.meta.dirname, '..')
const EXE = join(ROOT, 'src-tauri', 'target', 'release', 'mdmate.exe')
const RESULTS = join(ROOT, 'perf-results')
const PROFILE = join(RESULTS, 'webview2-profile')
const RUN_TIMEOUT_MS = 180_000

interface RunData {
  spawnMs: number
  exitMs: number
  exitCode: number | null
  stragglers: number
  idlePct: number
  report: PerfReport
}

interface Spec {
  /** The ISA claim this scenario supports. */
  claim: string
  /** The scenario name the page runs. */
  page: string
  headlineName: string
  targetMs: number
  /** Real key events from the DevTools port instead of in-page dispatch. */
  trusted?: boolean
  /** Which harness driver plays input into the page. Typing is the default. */
  driver?: 'drag'
  /** A pass/fail check run once, not a timing: the page's values and notes are printed as they are. */
  check?: boolean
  /** How long a launch may take. Checks that need a person get longer. */
  timeoutMs?: number
  /** Every number worth printing for one run, headline first. */
  metrics(run: RunData): Record<string, number>
}

const at = (list: readonly number[] | undefined, i: number) => list?.[i] ?? Number.NaN
const q = (report: PerfReport, name: string) => report.samples[name] ?? []
const v = (report: PerfReport, name: string) => report.values[name] ?? Number.NaN

/**
 * The 16 ms budget applies to the main-thread work a key causes (`workMs`). Key to frame adds the
 * idle wait for the frame to start, so it is printed for reference and never judged.
 */
function typingMetrics({ report }: RunData): Record<string, number> {
  const work = summarize(q(report, 'workMs'))
  return {
    'work per key, p95': work.p95,
    'work per key, median': work.p50,
    'work per key, p99': work.p99,
    'work per key, max': work.max,
    'of which update, p95': summarize(q(report, 'updateMs')).p95,
    'of which frame render, p95': summarize(q(report, 'renderMs')).p95,
    'key to frame, p95 (with frame wait)': summarize(q(report, 'latencyMs')).p95,
  }
}

function openMetrics({ report }: RunData): Record<string, number> {
  const warm = (name: string) => median(q(report, name).slice(1))
  return {
    'warm open, median': warm('totalMs'),
    'cold open (first)': at(q(report, 'totalMs'), 0),
    'warm: IPC read': warm('ipcMs'),
    'warm: decode': warm('decodeMs'),
    'warm: build state': warm('stateMs'),
    'warm: show': warm('showMs'),
    'warm: paint': warm('paintMs'),
  }
}

/** Open and type scenarios at each size the cutoff question needs. */
function sizedSpecs(): Record<string, Spec> {
  const out: Record<string, Spec> = {}
  for (const mb of SIZES_MB) {
    const size = `${String(mb)}mb`
    out[`open-${size}`] = {
      claim: 'fog: size cutoff',
      page: `open-${size}`,
      headlineName: 'warm open, median',
      targetMs: 100,
      metrics: openMetrics,
    }
    out[`typing-${size}`] = {
      claim: 'fog: size cutoff',
      page: `typing-${size}`,
      headlineName: 'work per key, p95',
      targetMs: 16,
      metrics: typingMetrics,
    }
  }
  return out
}

const SPECS: Record<string, Spec> = {
  startup: {
    claim: 'ISC-4',
    page: 'startup',
    headlineName: 'launch to editable',
    targetMs: 1000,
    metrics({ report, spawnMs }) {
      const t = (name: string) => v(report, name)
      return {
        'launch to editable': t('readyMs') - spawnMs,
        'spawn to Rust main': t('rustStartedMs') - spawnMs,
        'Rust main to page start': t('timeOriginMs') - t('rustStartedMs'),
        'page start to app mounted': t('appMountedMs') - t('timeOriginMs'),
        'app mounted to window shown': t('windowShownMs') - t('appMountedMs'),
        'app mounted to editor': t('editorMountedMs') - t('appMountedMs'),
        'last of those to first frame':
          t('readyMs') - Math.max(t('windowShownMs'), t('editorMountedMs')),
      }
    },
  },
  'open-1mb': {
    claim: 'ISC-5',
    page: 'open-1mb',
    headlineName: 'warm open, median',
    targetMs: 100,
    metrics: openMetrics,
  },
  ...sizedSpecs(),
  'asset-scope': {
    claim: 'fog: asset protocol scope',
    page: 'asset-scope',
    headlineName: '',
    targetMs: 0,
    check: true,
    metrics: () => ({}),
  },
  lab: {
    claim: 'fog: text drag, drop units, snap layouts',
    page: 'lab',
    headlineName: '',
    targetMs: 0,
    check: true,
    timeoutMs: 20 * 60_000,
    metrics: () => ({}),
  },
  'drag-auto': {
    claim: 'P5-T7 spike: drag-to-move with trusted input',
    page: 'drag-auto',
    headlineName: '',
    targetMs: 0,
    check: true,
    trusted: true,
    driver: 'drag',
    timeoutMs: 4 * 60_000,
    metrics: () => ({}),
  },
  'lab-drag': {
    claim: 'P5-T7 spike: drag-to-move by hand',
    page: 'lab-drag',
    headlineName: '',
    targetMs: 0,
    check: true,
    timeoutMs: 20 * 60_000,
    metrics: () => ({}),
  },
  'typing-10mb': {
    claim: 'fog: size cutoff',
    page: 'typing-10mb',
    headlineName: 'work per key, p95',
    targetMs: 16,
    metrics: typingMetrics,
  },
  'tab-switch': {
    claim: 'ISC-6',
    page: 'tab-switch',
    headlineName: 'switch, p95',
    targetMs: 50,
    metrics({ report }) {
      const total = summarize(q(report, 'totalMs'))
      return {
        'switch, p95': total.p95,
        'switch, median': total.p50,
        'switch, max': total.max,
        'synchronous part, median': summarize(q(report, 'syncMs')).p50,
      }
    },
  },
  'typing-1mb': {
    claim: 'ISC-7',
    page: 'typing-1mb',
    headlineName: 'work per key, p95',
    targetMs: 16,
    metrics: typingMetrics,
  },
  'typing-1mb-trusted': {
    claim: 'ISC-7',
    page: 'typing-1mb-trusted',
    headlineName: 'work per key, p95',
    targetMs: 16,
    trusted: true,
    metrics: typingMetrics,
  },
}

function fail(message: string): never {
  console.error(`perf: ${message}`)
  process.exit(1)
}

function parseArgs(argv: string[]) {
  const names: string[] = []
  const set: Partial<Record<keyof PerfParams, number>> = {}
  let runs = 5
  // Launches that are measured but not counted. The first attempt used one, and the first
  // counted run of tab-switch and startup still came out slower than the rest, so it is two.
  let warmups = 2
  let skipBuild = false
  let freshProfile = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg === '--runs') runs = Number(argv[++i])
    else if (arg === '--warmups') warmups = Number(argv[++i])
    else if (arg === '--skip-build') skipBuild = true
    else if (arg === '--fresh-profile') freshProfile = true
    else if (arg === '--set') {
      const [key, value] = (argv[++i] ?? '').split('=')
      if (!key || !(key in DEFAULT_PARAMS) || Number.isNaN(Number(value)))
        fail(`bad --set ${key ?? ''}`)
      set[key as keyof PerfParams] = Number(value)
    } else if (arg.startsWith('--')) fail(`unknown option ${arg}`)
    else names.push(arg)
  }
  if (!Number.isInteger(runs) || runs < 1) fail('--runs needs a whole number of 1 or more')
  if (!Number.isInteger(warmups) || warmups < 0) fail('--warmups needs a whole number of 0 or more')
  // `all` is the five scenarios behind ISC-4 to ISC-7. The 10 MB ones are for the size-cutoff
  // question and are named on purpose.
  const chosen = names.includes('all')
    ? Object.keys(SPECS).filter((key) => !SPECS[key]?.claim.startsWith('fog'))
    : names
  if (chosen.length === 0 || chosen.some((name) => !(name in SPECS))) {
    fail(`name a scenario: ${Object.keys(SPECS).join(', ')}, or all`)
  }
  return { chosen, runs, warmups, skipBuild, freshProfile, params: { ...DEFAULT_PARAMS, ...set } }
}

function build(): void {
  console.log('perf: building the release app with the perf driver (the first build is slow)...')
  // A constant command line; the shell is there because pnpm is a .cmd file on Windows.
  // The asset protocol is off in the real config. The lab turns it on for this build only, so the
  // question "can its scope grow at runtime" can be tested without changing the app's config.
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(
    join(RESULTS, 'tauri.perf.conf.json'),
    JSON.stringify({ app: { security: { assetProtocol: { enable: true, scope: [] } } } }),
  )
  // With the asset protocol on in the config, the Tauri CLI adds the `protocol-asset` feature to the
  // main `tauri` dependency in Cargo.toml. Shipped builds must not carry it, and the Rust build
  // script rejects the mismatch, so the file is put back whatever the build does.
  const manifest = join(ROOT, 'src-tauri', 'Cargo.toml')
  const original = readFileSync(manifest, 'utf8')
  let status: number | null
  try {
    status = spawnSync(
      'pnpm tauri build --features perf --no-bundle --config perf-results/tauri.perf.conf.json',
      {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, VITE_MDMATE_PERF: '1' },
      },
    ).status
  } finally {
    writeFileSync(manifest, original)
  }
  if (status !== 0) fail('the release build failed')
}

function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function webview2Version(): string {
  try {
    const key = String.raw`HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`
    const out = execFileSync('reg', ['query', key, '/v', 'pv'], { encoding: 'utf8' })
    return /pv\s+REG_SZ\s+(\S+)/.exec(out)?.[1] ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** The smallest step `Date.now()` takes. Launch timings compare it with the app's own clock. */
function clockResolutionMs(): number {
  let smallest = Number.POSITIVE_INFINITY
  const end = Date.now() + 200
  let last = Date.now()
  while (Date.now() < end) {
    const now = Date.now()
    if (now > last) smallest = Math.min(smallest, now - last)
    last = now
  }
  return smallest
}

function system() {
  const cpus = os.cpus()
  return {
    label: 'Windows',
    os: `${os.version()} (${os.release()})`,
    cpu: cpus[0]?.model.trim() ?? 'unknown',
    logicalCores: cpus.length,
    ramGb: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
    freeRamGbAtStart: Math.round((os.freemem() / 2 ** 30) * 10) / 10,
    webview2: webview2Version(),
    node: process.version,
    commit: git('rev-parse', '--short', 'HEAD'),
    uncommittedChanges: git('status', '--porcelain') !== '',
    exeBuiltAt: statSync(EXE).mtime.toISOString(),
    clockResolutionMs: clockResolutionMs(),
  }
}

async function cpuIdlePercent(windowMs = 1000): Promise<number> {
  const read = () =>
    os.cpus().reduce(
      (sum, cpu) => {
        const total =
          cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
        return { idle: sum.idle + cpu.times.idle, total: sum.total + total }
      },
      { idle: 0, total: 0 },
    )
  const a = read()
  await sleep(windowMs)
  const b = read()
  return (100 * (b.idle - a.idle)) / Math.max(1, b.total - a.total)
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolvePort(address.port)
        else reject(new Error('no port'))
      })
    })
  })
}

/** WebView2 helper processes that outlived the app and still use this harness's profile. */
function killStragglers(): number {
  const script =
    'Get-CimInstance Win32_Process -Filter "Name=\'msedgewebview2.exe\'" | ' +
    "Where-Object { $_.CommandLine -like ('*' + $env:PERF_PROFILE + '*') } | " +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }'
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      env: { ...process.env, PERF_PROFILE: PROFILE },
    })
    return out.split(/\s+/).filter(Boolean).length
  } catch (error) {
    // Windows cannot start PowerShell when it is out of memory or handles. That must not throw
    // away a run that already has its result, so note it and carry on.
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
    console.log(`note: could not check for leftover WebView2 processes (${reason ?? 'unknown'})`)
    return 0
  }
}

async function launch(spec: Spec, params: PerfParams, label: string): Promise<RunData> {
  const outFile = join(RESULTS, 'tmp', `${spec.page}-${label}.json`)
  mkdirSync(join(RESULTS, 'tmp'), { recursive: true })
  rmSync(outFile, { force: true })

  const port = spec.trusted ? await freePort() : 0
  // Without the first flag Chromium pauses painting for a covered window, which would flatter
  // the paint numbers. The second opens the DevTools port, for the trusted-typing scenario only.
  const browserArgs = ['--disable-features=CalculateNativeWinOcclusion']
  if (port) browserArgs.push(`--remote-debugging-port=${String(port)}`)

  const idlePct = await cpuIdlePercent()
  const spawnMs = Date.now()
  const child = spawn(EXE, [], {
    stdio: 'ignore',
    env: {
      ...process.env,
      MDMATE_PERF_SCENARIO: spec.page,
      MDMATE_PERF_OUT: outFile,
      MDMATE_PERF_FIXTURES: join(ROOT, 'tests', 'fixtures'),
      MDMATE_PERF_PARAMS: JSON.stringify(params),
      WEBVIEW2_USER_DATA_FOLDER: PROFILE,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArgs.join(' '),
    },
  })
  const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)))
  const timer = setTimeout(() => child.kill(), spec.timeoutMs ?? RUN_TIMEOUT_MS)

  let driverError: Error | undefined
  if (port) {
    const driving =
      spec.driver === 'drag'
        ? driveDrag(port)
        : driveTyping(port, {
            total: params.warmupKeys + params.keys,
            intervalMs: params.keyIntervalMs,
          })
    driving.catch((error: unknown) => {
      driverError = error instanceof Error ? error : new Error(String(error))
      child.kill()
    })
  }

  const exitCode = await exited
  clearTimeout(timer)
  const exitMs = Date.now()
  await sleep(500)
  const stragglers = killStragglers()

  if (driverError) fail(`could not drive the app: ${driverError.message}`)
  if (!existsSync(outFile)) fail(`the app left no result (exit code ${String(exitCode)})`)
  const report = JSON.parse(readFileSync(outFile, 'utf8')) as PerfReport
  if (!report.ok) fail(`the page reported a failure: ${report.error ?? 'unknown'}`)
  return { spawnMs, exitMs, exitCode, stragglers, idlePct, report }
}

/** Two folders of small PNGs for the asset-scope check, one with a space and an accent in a name. */
function prepareAssetLab(): void {
  const png = join(ROOT, 'src-tauri', 'icons', '32x32.png')
  const lab = join(RESULTS, 'asset-lab')
  rmSync(lab, { recursive: true, force: true })
  for (const dir of ['a', join('a', 'nested'), 'b']) mkdirSync(join(lab, dir), { recursive: true })
  for (const file of [
    join('a', 'plain.png'),
    join('a', 'with space é.png'),
    join('a', 'nested', 'deep.png'),
    join('b', 'plain.png'),
  ]) {
    copyFileSync(png, join(lab, file))
  }
}

/** Runs a pass/fail scenario once and prints what the page found. */
async function runCheck(name: string, params: PerfParams, info: ReturnType<typeof system>) {
  const spec = SPECS[name]
  if (!spec) fail(`unknown scenario ${name}`)
  console.log(`
== ${name} (${spec.claim}) ==`)
  if (name === 'asset-scope') prepareAssetLab()
  if (name === 'lab') {
    console.log('A window opens. Follow the three steps in it, then press "Finish and save".')
  }
  if (name === 'lab-drag') {
    console.log('A window opens. Answer the numbered steps in order, then press "Finish and save".')
  }
  if (name === 'drag-auto') {
    console.log('A window opens and the harness drags in it by itself. Do not touch the mouse.')
  }
  const run = await launch(spec, params, 'check')
  for (const [key, value] of Object.entries(run.report.values))
    console.log(`  ${key}: ${String(value)}`)
  if (run.report.notes) console.log(JSON.stringify(run.report.notes, null, 2))
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
  const file = join(RESULTS, `${name}-${stamp}.json`)
  writeFileSync(
    file,
    JSON.stringify(
      { label: 'Windows', scenario: name, claim: spec.claim, system: info, run },
      null,
      2,
    ),
  )
  console.log(`wrote ${file}`)
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(n < 10 ? 2 : 1) : 'n/a')

async function measure(
  name: string,
  runs: number,
  warmups: number,
  params: PerfParams,
  info: ReturnType<typeof system>,
) {
  const spec = SPECS[name]
  if (!spec) fail(`unknown scenario ${name}`)
  const decorated = params.decorations === 1
  console.log(`\n== ${name} (${spec.claim})${decorated ? ', decorations on' : ''} ==`)

  const profileExisted = existsSync(PROFILE)
  const warmup: RunData[] = []
  for (let w = 1; w <= warmups; w++) {
    console.log(`warm-up launch ${String(w)}/${String(warmups)}, not counted...`)
    warmup.push(await launch(spec, params, `warmup-${String(w)}`))
  }

  const all: RunData[] = []
  for (let i = 1; i <= runs; i++) {
    process.stdout.write(`run ${String(i)}/${String(runs)}... `)
    const run = await launch(spec, params, `run-${String(i)}`)
    all.push(run)
    const headline = spec.metrics(run)[spec.headlineName] ?? Number.NaN
    console.log(`${fmt(headline)} ms (CPU ${run.idlePct.toFixed(0)}% idle before launch)`)
  }

  const perRun = all.map((run) => spec.metrics(run))
  const names = Object.keys(perRun[0] ?? {})
  const table = names.map((metric) => {
    const values = perRun.map((run) => run[metric] ?? Number.NaN)
    return { metric, ...repeatability(values), values }
  })

  const headline = table.find((row) => row.metric === spec.headlineName)
  console.log(`\n${'metric (ms)'.padEnd(30)} median     min     max   spread`)
  for (const row of table) {
    const mark = row.metric === spec.headlineName ? '*' : ' '
    console.log(
      `${mark}${row.metric.padEnd(29)} ${fmt(row.median).padStart(6)} ${fmt(row.min).padStart(7)} ${fmt(row.max).padStart(7)} ${row.worstDeviationPct.toFixed(0).padStart(5)}%`,
    )
  }
  const within = (headline?.median ?? Number.POSITIVE_INFINITY) <= spec.targetMs
  console.log(
    `\n[Windows${decorated ? ', decorations on' : ''}] ${spec.headlineName}: ${fmt(headline?.median ?? Number.NaN)} ms against a target of ${String(spec.targetMs)} ms -> ${within ? 'within target' : 'OVER target'}`,
  )
  console.log(
    `repeatable across ${String(runs)} runs (every run within ${String(REPEATABILITY_RULE.percent)}% or ${String(REPEATABILITY_RULE.floorMs)} ms of the median): ${headline?.repeatable ? 'yes' : 'NO'}`,
  )
  const idleLow = all.filter((run) => run.idlePct < 85).length
  if (idleLow > 0)
    console.log(`warning: the CPU was under 85% idle before ${String(idleLow)} run(s)`)
  const leftovers = [...warmup, ...all].reduce((sum, run) => sum + run.stragglers, 0)
  if (leftovers > 0)
    console.log(`note: ${String(leftovers)} WebView2 process(es) outlived the app and were stopped`)

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
  const file = join(RESULTS, `${name}${decorated ? '-decorated' : ''}-${stamp}.json`)
  writeFileSync(
    file,
    JSON.stringify(
      {
        label: 'Windows',
        decorations: decorated,
        scenario: name,
        claim: spec.claim,
        headline: {
          name: spec.headlineName,
          targetMs: spec.targetMs,
          withinTarget: within,
          ...headline,
        },
        repeatabilityRule: REPEATABILITY_RULE,
        metrics: table,
        params,
        profileExistedBeforeWarmup: profileExisted,
        system: info,
        warmups: warmup,
        runs: all,
      },
      null,
      2,
    ),
  )
  console.log(`wrote ${file}`)
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') fail('pnpm perf runs on Windows only for now')
  const { chosen, runs, warmups, skipBuild, freshProfile, params } = parseArgs(
    process.argv.slice(2),
  )

  if (!existsSync(join(ROOT, 'tests', 'fixtures', 'generated', 'realistic-1mb.md'))) {
    console.log('perf: generating fixtures...')
    spawnSync(process.execPath, [join(ROOT, 'scripts', 'fixtures.mjs')], { stdio: 'inherit' })
  }
  if (!skipBuild) build()
  if (!existsSync(EXE)) fail(`${EXE} is missing; run without --skip-build`)

  mkdirSync(RESULTS, { recursive: true })
  if (freshProfile) rmSync(PROFILE, { recursive: true, force: true })
  console.log(
    'perf: a window opens for each run. Leave the mouse and keyboard alone and keep it uncovered.',
  )
  const info = system()
  console.log(
    `perf: ${info.label}, ${info.cpu}, ${String(info.ramGb)} GB RAM (${String(info.freeRamGbAtStart)} GB free), WebView2 ${info.webview2}, commit ${info.commit}${info.uncommittedChanges ? ' (uncommitted changes)' : ''}`,
  )
  if (info.clockResolutionMs > 2) {
    console.log(
      `warning: the system clock only ticks every ${info.clockResolutionMs.toFixed(1)} ms; launch timings are coarse`,
    )
  }

  for (const name of chosen) {
    if (SPECS[name]?.check) await runCheck(name, params, info)
    else await measure(name, runs, warmups, params, info)
  }
}

await main()
