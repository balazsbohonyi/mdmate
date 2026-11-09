import { computed, shallowReactive, shallowRef, watch } from 'vue'
import { describe, openPath, problem } from '@/documents/store'
import { getHost } from '@/platform'
import { flatten, isMarkdownName, pathKeyer, type Listing, type TreeRow } from './model'

/**
 * The sidebar's state: the workspace roots, which folders are open and what each holds. Rust is the
 * authority on the roots and on what is in a folder; this keeps what is on screen. A module-level
 * store, shared by the tree, the commands and the session.
 */

let keyOf = pathKeyer(true)
const roots = shallowRef<readonly string[]>([])
/** The open folders: key to the path as first written, which is what the session keeps. */
const expanded = shallowRef<ReadonlyMap<string, string>>(new Map())
const listings = shallowReactive(new Map<string, Listing>())
/** Per folder, which listing request is the newest, so a slow answer never overwrites a fresh one. */
const newest = new Map<string, number>()
let subscribed = false
let stopTreeEvents: (() => void) | undefined

export const workspaceRoots = computed(() => roots.value)

/** The row the user last clicked. Not necessarily open anywhere. */
export const selectedPath = shallowRef<string | null>(null)

/** The rows on screen, top to bottom. */
export const treeRows = computed<TreeRow[]>(() =>
  flatten(roots.value, expanded.value, listings, keyOf),
)

/** The open folders, as the session remembers them. */
export const expandedFolderPaths = computed(() => [...expanded.value.values()].sort())

/** Roots and the open folders below them, the ones Rust should watch for changes. */
const watchedFolders = computed(() =>
  treeRows.value
    .filter((row) => (row.kind === 'root' || row.kind === 'folder') && row.expanded)
    .map((row) => row.path),
)

function isInside(path: string, root: string): boolean {
  const [key, rootKey] = [keyOf(path), keyOf(root)]
  return key === rootKey || key.startsWith(`${rootKey}/`)
}

function setExpanded(path: string, open: boolean): void {
  const next = new Map(expanded.value)
  if (open) next.set(keyOf(path), path)
  else next.delete(keyOf(path))
  expanded.value = next
}

/** Lists a folder again and shows the answer. The newest request wins. */
export async function loadFolder(path: string): Promise<void> {
  const key = keyOf(path)
  const mine = (newest.get(key) ?? 0) + 1
  newest.set(key, mine)
  try {
    const host = await getHost()
    const entries = await host.listDir(path)
    if (newest.get(key) !== mine) return
    listings.set(key, { entries, error: null })
  } catch (error) {
    if (newest.get(key) !== mine) return
    // A folder that could not be read keeps what it showed, with the reason under it.
    listings.set(key, { entries: listings.get(key)?.entries ?? null, error: describe(error) })
  }
}

/** Opens a folder, or closes it when it is open. */
export async function toggleFolder(path: string): Promise<void> {
  if (expanded.value.has(keyOf(path))) {
    setExpanded(path, false)
    return
  }
  setExpanded(path, true)
  // Listed again on every open, so what the tree shows is what the disk holds right now.
  await loadFolder(path)
}

function addRoot(path: string): void {
  if (!roots.value.some((root) => keyOf(root) === keyOf(path))) {
    roots.value = [...roots.value, path]
  }
  setExpanded(path, true)
  void loadFolder(path)
}

/** Shows the folder dialog and adds the chosen folder as a workspace root. */
export async function openFolderDialog(): Promise<void> {
  problem.value = null
  try {
    const host = await getHost()
    const path = await host.openFolder()
    if (path !== null) addRoot(path)
  } catch (error) {
    problem.value = `Could not open the folder: ${describe(error)}`
  }
}

/** Makes a folder from a native drop a workspace root. Rust checks that a drop delivered it. */
export async function addRootFromDrop(path: string): Promise<void> {
  try {
    const host = await getHost()
    addRoot(await host.addDroppedRoot(path))
  } catch (error) {
    problem.value = `Could not add the folder: ${describe(error)}`
  }
}

/** Takes a root out of the workspace. Open tabs stay open: their files are still the user's. */
export async function removeRootFolder(path: string): Promise<void> {
  try {
    const host = await getHost()
    await host.removeRoot(path)
  } catch (error) {
    problem.value = `Could not remove the folder: ${describe(error)}`
    return
  }
  roots.value = roots.value.filter((root) => keyOf(root) !== keyOf(path))
  const kept = new Map<string, string>()
  for (const [key, written] of expanded.value) if (!isInside(written, path)) kept.set(key, written)
  expanded.value = kept
  for (const key of [...listings.keys()]) {
    if (isInside(key, path)) {
      listings.delete(key)
      newest.delete(key)
    }
  }
  if (selectedPath.value !== null && isInside(selectedPath.value, path)) selectedPath.value = null
}

/** What a click on a row does: select it, open or close a folder, open a Markdown file. */
export async function activateRow(row: TreeRow): Promise<void> {
  if (row.kind === 'note') return
  selectedPath.value = row.path
  if (row.kind === 'file') {
    if (!isMarkdownName(row.name)) return
    try {
      await openPath(row.path)
    } catch (error) {
      problem.value = `Could not open ${row.path}: ${describe(error)}`
    }
    return
  }
  await toggleFolder(row.path)
}

/** Listens for changes Rust sees in the open folders and lists those folders again. */
async function subscribe(): Promise<void> {
  if (subscribed) return
  const host = await getHost()
  stopTreeEvents?.()
  stopTreeEvents = await host.watchTree((folder) => {
    if (expanded.value.has(keyOf(folder))) void loadFolder(folder)
  })
  subscribed = true
  await host.watchFolders(watchedFolders.value)
}

watch(
  watchedFolders,
  (folders) => {
    if (!subscribed) return
    getHost()
      .then((host) => host.watchFolders(folders))
      .catch((error: unknown) => {
        console.error('Could not watch the open folders', error)
      })
  },
  { flush: 'post' },
)

/**
 * Brings the workspace back at startup. Rust says which folders are roots (it kept the list
 * itself and granted them again); the session only says which folders were open, and a folder
 * outside every root is ignored. Listings run in the background so the window does not wait.
 */
export async function restoreWorkspace(open: readonly string[]): Promise<void> {
  const host = await getHost()
  keyOf = pathKeyer((await host.platformName()) !== 'linux')
  const found = await host.loadWorkspace()
  roots.value = found
  const next = new Map<string, string>()
  for (const root of found) next.set(keyOf(root), root)
  for (const path of open) {
    if (found.some((root) => isInside(path, root))) next.set(keyOf(path), path)
  }
  expanded.value = next
  for (const path of next.values()) void loadFolder(path)
  await subscribe().catch((error: unknown) => {
    problem.value = `Could not watch the folders for changes: ${describe(error)}`
  })
}

/** Forgets the workspace. Tests use it. */
export function resetTree(): void {
  stopTreeEvents?.()
  stopTreeEvents = undefined
  subscribed = false
  keyOf = pathKeyer(true)
  roots.value = []
  expanded.value = new Map()
  listings.clear()
  newest.clear()
  selectedPath.value = null
}
