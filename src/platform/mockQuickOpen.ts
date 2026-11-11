import { fuzzyMatch } from '@/lib/fuzzy'
import type { QuickOpenAnswer, QuickOpenItem } from './quickOpen'

const slashes = (path: string): string => path.replaceAll('\\', '/').replace(/\/$/, '')

/**
 * Ctrl+P for the browser stand-in: every file under the roots, ranked with the same points as the
 * Rust index. It lists everything but `.git`, as Rust does; it is not the Rust code, which is
 * proven by its own tests.
 */
export function mockQuickOpen(
  paths: readonly string[],
  roots: readonly string[],
  query: string,
  limit: number,
): QuickOpenAnswer {
  const folders = roots.map(slashes)
  const several = folders.length > 1
  const entries: { path: string; rel: string; nameStart: number }[] = []
  for (const path of paths) {
    const at = slashes(path)
    const root = folders.find((folder) => at.startsWith(`${folder}/`))
    if (root === undefined) continue
    const inside = at.slice(root.length + 1)
    if (inside.split('/').some((part) => part.toLowerCase() === '.git')) continue
    const label = root.split('/').pop() ?? root
    const rel = several ? `${label}/${inside}` : inside
    entries.push({ path, rel, nameStart: rel.lastIndexOf('/') + 1 })
  }
  const byRel = (a: string, b: string): number => {
    const [x, y] = [a.toLowerCase(), b.toLowerCase()]
    return x < y ? -1 : x > y ? 1 : 0
  }
  const typed = query.replace(/\s+/g, '')
  let ranked: QuickOpenItem[]
  let total: number
  if (typed === '') {
    const sorted = [...entries].sort((a, b) => byRel(a.rel, b.rel))
    total = sorted.length
    ranked = sorted.slice(0, limit).map((entry) => ({ ...entry, matches: [] }))
  } else {
    const hits = entries.flatMap((entry) => {
      const hit = fuzzyMatch(typed, entry.rel, entry.nameStart)
      return hit === null ? [] : [{ entry, hit }]
    })
    hits.sort(
      (a, b) =>
        b.hit.score - a.hit.score ||
        a.entry.rel.length - b.entry.rel.length ||
        byRel(a.entry.rel, b.entry.rel),
    )
    total = hits.length
    ranked = hits.slice(0, limit).map(({ entry, hit }) => ({ ...entry, matches: hit.matches }))
  }
  return { items: ranked, total, indexed: entries.length, truncated: false }
}
