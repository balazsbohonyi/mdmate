import { computed, shallowReactive, shallowRef, watch } from 'vue'
import { describe, openPath, problem, provideImageBoundary } from '@/documents/store'
import { getHost } from '@/platform'
import { flatten, parentPath, pathKeyer, withNewRow, type Listing, type TreeRow } from './model'

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

/**
 * The name being typed in the tree, or null. A new entry gets a box under its folder; a rename
 * turns the row itself into a box. `error` is why the last attempt was refused, shown under the box.
 */
export type Naming =
  | {
      readonly kind: 'new-file' | 'new-folder'
      readonly parent: string
      readonly error: string | null
    }
  | { readonly kind: 'rename'; readonly path: string; readonly error: string | null }

export const naming = shallowRef<Naming | null>(null)

/** A row the tree should bring into view; `n` makes two requests for one row distinct. */
export interface ScrollRequest {
  readonly path: string
  readonly kind: 'row' | 'new'
  readonly n: number
}

export const scrollRequest = shallowRef<ScrollRequest | null>(null)
let scrollCount = 0

export function requestScroll(path: string, kind: 'row' | 'new' = 'row'): void {
  scrollRequest.value = { path, kind, n: ++scrollCount }
}

/** The rows on screen, top to bottom. */
export const treeRows = computed<TreeRow[]>(() => {
  const rows = flatten(roots.value, expanded.value, listings, keyOf)
  const typing = naming.value
  if (typing === null || typing.kind === 'rename') return rows
  return withNewRow(rows, typing.parent, typing.kind === 'new-file' ? 'file' : 'folder', keyOf)
})

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

/** True when two paths are the same place, whatever their spelling. */
export function samePath(a: string, b: string): boolean {
  return keyOf(a) === keyOf(b)
}

/** True when `path` is `folder` or lies below it. */
export function isUnder(path: string, folder: string): boolean {
  return isInside(path, folder)
}

/** The workspace root that holds a path (the innermost, when roots lie inside each other), or undefined for a path in none. */
export function rootOf(path: string): string | undefined {
  let best: string | undefined
  for (const root of roots.value) {
    if (isInside(path, root) && (best === undefined || root.length > best.length)) best = root
  }
  return best
}

// An image in a document may climb up to the workspace folder the document is in (ISC-232).
provideImageBoundary((path) => rootOf(path) ?? null)

/** Opens a folder if it is closed, and lists it. Leaves an open folder as it is. */
export async function openFolderRow(path: string): Promise<void> {
  if (expanded.value.has(keyOf(path))) return
  setExpanded(path, true)
  await loadFolder(path)
}

/**
 * Selects a file or folder and brings its row into view, opening the folders above it first. Does
 * nothing for a path outside every root.
 */
export async function revealPath(path: string): Promise<void> {
  const root = rootOf(path)
  if (root === undefined) return
  const parent = parentPath(path)
  const trail: string[] = []
  for (
    let folder = parent;
    folder !== null && !samePath(folder, root);
    folder = parentPath(folder)
  ) {
    trail.unshift(folder)
    if (!isInside(folder, root)) return
  }
  await openFolderRow(root)
  for (const folder of trail) await openFolderRow(folder)
  selectedPath.value = path
  requestScroll(path)
}

/**
 * Keeps the tree in step after a file or folder moved from `from` to `to`: open folders below it
 * stay open at the new place, the old listings go, and the selection follows. The folders it was in
 * and went to are listed again by the caller.
 */
export function remapPaths(from: string, to: string): void {
  const kept = new Map<string, string>()
  const reopened: string[] = []
  for (const [key, written] of expanded.value) {
    if (!isInside(written, from)) {
      kept.set(key, written)
      continue
    }
    const now = to + written.slice(from.length)
    kept.set(keyOf(now), now)
    reopened.push(now)
  }
  expanded.value = kept
  for (const key of [...listings.keys()]) {
    if (isInside(key, from)) {
      listings.delete(key)
      newest.delete(key)
    }
  }
  const selected = selectedPath.value
  if (selected !== null && isInside(selected, from))
    selectedPath.value = to + selected.slice(from.length)
  for (const folder of reopened) void loadFolder(folder)
}

/** Forgets a file or folder that is gone: its listings, its open state and its selection. */
export function forgetPath(path: string): void {
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

/** Starts typing a name in the tree. A new entry's folder is opened first so its box shows. */
export async function startNaming(next: Naming): Promise<void> {
  if (next.kind !== 'rename') await openFolderRow(next.parent)
  naming.value = next
  if (next.kind === 'rename') requestScroll(next.path)
  else requestScroll(next.parent, 'new')
}

/** Stops typing a name without doing anything. */
export function cancelNaming(): void {
  naming.value = null
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

/** Makes a folder from the Open Recent list a workspace root again. Rust refuses a path not on the list. */
export async function openRecentFolder(path: string): Promise<void> {
  const host = await getHost()
  addRoot(await host.recentOpenFolder(path))
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
  forgetPath(path)
}

/** What a click on a row does: select it, open or close a folder, open a file in a tab. */
export async function activateRow(row: TreeRow): Promise<void> {
  if (row.kind === 'note' || row.kind === 'new') return
  selectedPath.value = row.path
  if (row.kind === 'file') {
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
  naming.value = null
  scrollRequest.value = null
}
