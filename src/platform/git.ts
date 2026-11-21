/** What git says about the files under a workspace root, as Rust sends it (`git/command.rs`). */

/** What git says about a path. A deletion arrives as `modified`. */
export type GitStatusName =
  'untracked' | 'added' | 'modified' | 'renamed' | 'conflicted' | 'ignored'

/** One path git reports. */
export interface GitEntry {
  /** The index of the repository that reported it in `GitReport.repos`. */
  readonly repo: number
  /** The full path, with `/` between the parts. */
  readonly path: string
  readonly status: GitStatusName
  /** A folder git reports as a whole: everything below it has `status`. */
  readonly folder: boolean
}

/**
 * The repositories found under a root (folders, with `/`) and what each reports. A path takes its
 * status from the innermost repository that holds it, so an entry counts for a path only when its
 * `repo` is that path's innermost repository.
 */
export interface GitReport {
  readonly repos: readonly string[]
  readonly entries: readonly GitEntry[]
}

/** Nothing known: git is off or missing, or the root is in no repository. */
export const NO_GIT: GitReport = { repos: [], entries: [] }

const STATUS_NAMES: ReadonlySet<string> = new Set([
  'untracked',
  'added',
  'modified',
  'renamed',
  'conflicted',
  'ignored',
])

/** Reads what Rust sent, so a malformed report fails here and not while a row is drawn. */
export function parseGitReport(value: unknown): GitReport {
  if (typeof value !== 'object' || value === null) throw new Error('git report: not an object')
  const raw = value as Record<string, unknown>
  const repos = raw.repos
  const entries = raw.entries
  if (!Array.isArray(repos) || !repos.every((repo) => typeof repo === 'string'))
    throw new Error('git report: repos is not a list of paths')
  if (!Array.isArray(entries)) throw new Error('git report: entries is not a list')
  const checked = entries.map((entry: unknown): GitEntry => {
    if (typeof entry !== 'object' || entry === null) throw new Error('git report: bad entry')
    const item = entry as Record<string, unknown>
    const { repo, path, status, folder } = item
    if (typeof repo !== 'number' || !Number.isInteger(repo) || repo < 0 || repo >= repos.length)
      throw new Error('git report: an entry names no repository')
    if (typeof path !== 'string' || path === '') throw new Error('git report: an entry has no path')
    if (typeof status !== 'string' || !STATUS_NAMES.has(status))
      throw new Error('git report: an entry has an unknown status')
    if (typeof folder !== 'boolean') throw new Error('git report: folder is not a boolean')
    return { repo, path, status: status as GitStatusName, folder }
  })
  return { repos, entries: checked }
}
