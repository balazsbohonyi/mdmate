import type { PerfHost } from '@/platform'
import type { ScenarioContext, ScenarioOutput } from './params'

const WAIT_MS = 5000

/** `loaded` means the image arrived through the asset protocol; `blocked` means it did not. */
function load(url: string): Promise<'loaded' | 'blocked'> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const timer = setTimeout(
      () => reject(new Error(`no answer for ${url} in ${WAIT_MS} ms`)),
      WAIT_MS,
    )
    image.onload = () => {
      clearTimeout(timer)
      resolve('loaded')
    }
    image.onerror = () => {
      clearTimeout(timer)
      resolve('blocked')
    }
    image.src = url
  })
}

/**
 * P0 lab, automatic: can the asset protocol's scope grow while the app runs?
 *
 * The harness makes two folders of small PNGs, one with a space and an accent in a file name and
 * one with a nested folder. The page loads each through the asset protocol before and after Rust
 * allows the folder. A file that is blocked before and loaded after, with the same URL, proves the
 * scope was the cause and the plumbing (CSP, URL form) is fine. Files in the other folder must
 * stay blocked until that folder is allowed too.
 */
export async function assetScope(ctx: ScenarioContext): Promise<ScenarioOutput> {
  const perf: PerfHost | undefined = ctx.host.perf
  if (!perf) throw new Error('this scenario needs the perf bridge')

  const root = ctx.config.fixturesDir.replace(/[\\/]tests[\\/]fixtures[\\/]?$/, '')
  const a = `${root}\\perf-results\\asset-lab\\a`
  const b = `${root}\\perf-results\\asset-lab\\b`
  const files = {
    aPlain: `${a}\\plain.png`,
    aSpaced: `${a}\\with space é.png`,
    aDeep: `${a}\\nested\\deep.png`,
    bPlain: `${b}\\plain.png`,
  }
  let n = 0
  // The counter keeps a cached failure from answering for a later try.
  const probe = (path: string) => load(`${perf.assetUrl(path)}?try=${String(n++)}`)
  const flag = (result: 'loaded' | 'blocked') => (result === 'loaded' ? 1 : 0)

  const values: Record<string, number> = {}
  values.beforeAllow_aPlain = flag(await probe(files.aPlain))
  values.beforeAllow_bPlain = flag(await probe(files.bPlain))

  await perf.allowAssetDirectory(a)
  values.afterAllowA_aPlain = flag(await probe(files.aPlain))
  values.afterAllowA_aSpacedAccent = flag(await probe(files.aSpaced))
  values.afterAllowA_aNested = flag(await probe(files.aDeep))
  values.afterAllowA_bStillBlocked = flag(await probe(files.bPlain))

  await perf.allowAssetDirectory(b)
  values.afterAllowB_bPlain = flag(await probe(files.bPlain))
  values.afterAllowB_aStillLoads = flag(await probe(files.aPlain))

  return { samples: {}, values }
}
