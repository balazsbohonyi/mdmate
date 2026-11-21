import { shallowRef, watch } from 'vue'
import { onDocumentSaved } from '@/documents/store'
import { settledRuntime } from '@/features/settings/store'
import { settings } from '@/lib/settings'
import { getHost } from '@/platform'
import { buildGitIndex, NO_LOOKS, type GitIndex, type GitLook, type GitRowKind } from './gitModel'
import { expandedPlaces, onTreeChanged, onTreeReset, pathKey, workspaceRoots } from './store'

/**
 * What git says about the files under each workspace root, kept beside the tree (`git_status` in
 * Rust). A question per root is asked when a root opens or goes, when the window gets the focus
 * back, when mdmate saves, creates, renames, deletes or moves a file, and when Rust says an open
 * folder changed. Questions that arrive close together are one, a reply older than a newer question
 * is dropped, and a root that was removed meanwhile is dropped too.
 *
 * With `git.enabled` off the host is not asked at all and nothing is colored. A call that fails is
 * the same as git saying nothing: no row is colored and nothing is shown. `.git/` is not watched,
 * so a commit made in a terminal shows at the next trigger, which is usually the window coming back
 * to the front.
 */

/** How long a burst of triggers waits, in milliseconds, before the question is asked. */
export const GIT_DEBOUNCE_MS = 250

/** The index of each root's report, by the root's key. */
const indexes = shallowRef<ReadonlyMap<string, GitIndex>>(new Map())
/** Per root, which question is the newest. */
const newest = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | undefined

/**
 * The look of a name under a root, or undefined for a name git has nothing to say about. Reads the
 * reactive index of that root, so a row redraws when its root's report changes.
 */
export function gitLook(root: string, path: string, kind: GitRowKind): GitLook | undefined {
  return (indexes.value.get(pathKey(root)) ?? NO_LOOKS).look(path, kind)
}

function setIndex(key: string, index: GitIndex | undefined): void {
  const next = new Map(indexes.value)
  if (index === undefined) next.delete(key)
  else next.set(key, index)
  indexes.value = next
}

/** Asks for the status of one root, and shows the answer unless a newer question went out. */
async function ask(root: string): Promise<void> {
  const key = pathKey(root)
  const mine = (newest.get(key) ?? 0) + 1
  newest.set(key, mine)
  const folders = [
    ...new Set(
      expandedPlaces.value
        .filter((place) => pathKey(place.root) === key)
        .map((place) => place.path),
    ),
  ]
  let index: GitIndex | undefined
  try {
    const host = await getHost()
    index = buildGitIndex(await host.gitStatus(root, folders), pathKey)
  } catch {
    // Git has nothing to say, or the root went away. Either way the names stay plain, with no note.
    index = undefined
  }
  if (newest.get(key) !== mine) return
  if (!workspaceRoots.value.some((open) => pathKey(open) === key)) return
  setIndex(key, index)
}

/** Asks now for every root, or clears everything when git is off. */
async function refreshNow(): Promise<void> {
  // The page tells Rust the settings first, so a question never meets the old `git.enabled`.
  await settledRuntime()
  const roots = workspaceRoots.value
  const open = new Set(roots.map(pathKey))
  for (const key of [...newest.keys()]) {
    if (open.has(key)) continue
    // A root that is gone: its report goes, and an answer still on its way is dropped.
    newest.set(key, (newest.get(key) ?? 0) + 1)
    setIndex(key, undefined)
  }
  if (!settings.git.enabled) {
    for (const key of open) newest.set(key, (newest.get(key) ?? 0) + 1)
    if (indexes.value.size > 0) indexes.value = new Map()
    return
  }
  await Promise.all(roots.map(ask))
}

/** Asks for the status of every root soon: bursts of triggers become one question. */
export function requestGitRefresh(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    void refreshNow()
  }, GIT_DEBOUNCE_MS)
}

/** Forgets every report and cancels what is waiting. */
function resetGit(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  newest.clear()
  indexes.value = new Map()
}

// The roots opening, restoring and closing; git turned on or off, or pointed somewhere else.
watch(workspaceRoots, requestGitRefresh, { immediate: true })
watch(() => [settings.git.enabled, settings.git.path], requestGitRefresh)

onTreeChanged(requestGitRefresh)
onTreeReset(resetGit)
onDocumentSaved(requestGitRefresh)
if (typeof window !== 'undefined') window.addEventListener('focus', requestGitRefresh)
