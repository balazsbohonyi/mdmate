import type { GitEntry, GitReport } from '@/platform'

/**
 * How git colours a name in the tree, as plain data: no Vue and no host in here, so the rules are
 * easy to test. A report from Rust (`GitReport`) is turned once into an index, and drawing a row is
 * then a few lookups.
 *
 * The rules:
 * - Untracked names are red (`untracked`), added ones green (`added`), modified and renamed ones
 *   blue (`modified`), a conflict is orange (`conflicted`), an ignored name is muted (`ignored`).
 * - Git reports an untracked or ignored folder as one entry, so everything inside it takes that
 *   status. That includes a folder entry above the root: a root inside an ignored folder is muted.
 * - A folder that holds a change (anything but ignored: untracked and added count too) is blue
 *   unless it has a status of its own, which wins. An ignored name never colors a folder above it.
 * - A root row takes only a status of its own or an inherited one; it is not blue for what is
 *   below it, as the workspace folder is not in most editors.
 * - An entry counts for a path only when its repository is the innermost one that holds the path,
 *   so an outer repository calling `projects/` untracked does not color what is in the repository
 *   at `projects/inner`.
 */

/** What a name is drawn as. A name git says nothing about has no look. */
export type GitLook = 'added' | 'untracked' | 'modified' | 'conflicted' | 'ignored'

/** What kind of row a name is on. */
export type GitRowKind = 'root' | 'folder' | 'file'

export interface GitIndex {
  /** The look of a path, or undefined. */
  look(path: string, kind: GitRowKind): GitLook | undefined
}

/** No report: nothing is colored. */
export const NO_LOOKS: GitIndex = {
  look: () => undefined,
}

function lookOf(status: GitEntry['status']): GitLook {
  switch (status) {
    case 'untracked':
      return 'untracked'
    case 'added':
      return 'added'
    case 'modified':
    case 'renamed':
      return 'modified'
    case 'conflicted':
      return 'conflicted'
    case 'ignored':
      return 'ignored'
  }
}

/** The folder a key is in, or null at the top. A key has `/` between its parts and no end slash. */
function above(key: string): string | null {
  const cut = key.lastIndexOf('/')
  return cut <= 0 ? null : key.slice(0, cut)
}

/**
 * Builds the index of a report. `keyOf` is the tree's path key (slashes alike, case folded where the
 * system folds it), so a path the tree builds and a path Rust sent meet.
 */
export function buildGitIndex(report: GitReport, keyOf: (path: string) => string): GitIndex {
  if (report.entries.length === 0) return NO_LOOKS
  const repos = new Map<string, number>()
  report.repos.forEach((repo, at) => repos.set(keyOf(repo), at))
  const entries = new Map<string, GitEntry>()
  /** The folders that hold a change, so they are blue. */
  const holders = new Set<string>()
  for (const entry of report.entries) {
    const key = keyOf(entry.path)
    if (!entries.has(key)) entries.set(key, entry)
    if (entry.status === 'ignored') continue
    for (let folder = above(key); folder !== null; folder = above(folder)) {
      if (holders.has(folder)) break
      holders.add(folder)
    }
  }

  /** The index of the innermost repository that holds a key (the key itself counts), if any. */
  const repoOf = (key: string): number | undefined => {
    for (let at: string | null = key; at !== null; at = above(at)) {
      const found = repos.get(at)
      if (found !== undefined) return found
    }
    return undefined
  }

  return {
    look(path, kind) {
      const key = keyOf(path)
      const repo = repoOf(key)
      const own = entries.get(key)
      if (own !== undefined && own.repo === repo) return lookOf(own.status)
      // Inside a folder git reported as a whole: the nearest such folder of the path's repository.
      for (let folder = above(key); folder !== null; folder = above(folder)) {
        const entry = entries.get(folder)
        if (entry?.folder === true && entry.repo === repo) return lookOf(entry.status)
      }
      if (kind === 'folder' && holders.has(key)) return 'modified'
      return undefined
    },
  }
}
