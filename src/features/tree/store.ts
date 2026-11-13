import { computed, shallowReactive, shallowRef, watch } from 'vue'
import { describe, openInActivePane, provideImageBoundary } from '@/documents/store'
import { watchIndexStatus } from '@/features/index/status'
import { getHost } from '@/platform'
import { focusActiveEditor, holdingEditorFocus } from '@/workbench/focus'
import {
  flatten,
  parentPath,
  pathKeyer,
  placeKey,
  withNewRow,
  type Listing,
  type Place,
  type TreeRow,
} from './model'
import { reportError } from '@/shell/toasts'

/**
 * The sidebar's state: the workspace roots, which folders are open and what each holds. Rust is the
 * authority on the roots and on what is in a folder; this keeps what is on screen. A module-level
 * store, shared by the tree, the commands and the session.
 */

let keyOf = pathKeyer(true)
const roots = shallowRef<readonly string[]>([])
/**
 * The open folders, by place: a folder shown under two roots is open under each on its own. The
 * value is the place as first written, which is what the session keeps.
 */
const expanded = shallowRef<ReadonlyMap<string, Place>>(new Map())
const listings = shallowReactive(new Map<string, Listing>())
/** Per folder, which listing request is the newest, so a slow answer never overwrites a fresh one. */
const newest = new Map<string, number>()
let subscribed = false
let stopTreeEvents: (() => void) | undefined

export const workspaceRoots = computed(() => roots.value)

/** The row the user last clicked. Not necessarily open anywhere. */
export const selectedPath = shallowRef<string | null>(null)
const selectedUnder = shallowRef<string | null>(null)

/**
 * The root the selected row sits under. A folder shown under two roots is two rows, and only the
 * one clicked is selected. A path set without a root (a test, an old caller) counts under the
 * innermost root that holds it.
 */
export const selectedRoot = computed<string | null>(() => {
  const path = selectedPath.value
  if (path === null) return null
  const under = selectedUnder.value
  if (under !== null && isInside(path, under)) return under
  return rootOf(path) ?? null
})

/** Selects a row: its path, and the root it sits under when it is known. */
export function select(path: string | null, root: string | null = null): void {
  selectedPath.value = path
  selectedUnder.value = path === null ? null : root
}

/**
 * The name being typed in the tree, or null. A new entry gets a box under its folder; a rename
 * turns the row itself into a box. `error` is why the last attempt was refused, shown under the box.
 */
export type Naming =
  | {
      readonly kind: 'new-file' | 'new-folder'
      readonly parent: string
      /** The root of the copy of the folder that shows the box; the innermost one by default. */
      readonly root?: string | undefined
      readonly error: string | null
    }
  | {
      readonly kind: 'rename'
      readonly path: string
      readonly root?: string | undefined
      readonly error: string | null
    }

export const naming = shallowRef<Naming | null>(null)

/** A row the tree should bring into view; `n` makes two requests for one row distinct. */
export interface ScrollRequest {
  readonly path: string
  /** The root of the copy to scroll to; the first copy when absent. */
  readonly root?: string | undefined
  readonly kind: 'row' | 'new'
  readonly n: number
}

export const scrollRequest = shallowRef<ScrollRequest | null>(null)
let scrollCount = 0

export function requestScroll(
  path: string,
  kind: 'row' | 'new' = 'row',
  root?: string | null,
): void {
  scrollRequest.value = { path, root: root ?? undefined, kind, n: ++scrollCount }
}

/** The rows on screen, top to bottom. */
export const treeRows = computed<TreeRow[]>(() => {
  const rows = flatten(roots.value, expanded.value, listings, keyOf)
  const typing = naming.value
  if (typing === null || typing.kind === 'rename') return rows
  return withNewRow(
    rows,
    typing.parent,
    typing.kind === 'new-file' ? 'file' : 'folder',
    keyOf,
    typing.root,
  )
})

/** The open places, as the session remembers them. */
export const expandedPlaces = computed<Place[]>(() =>
  [...expanded.value.values()].sort(
    (a, b) => a.root.localeCompare(b.root) || a.path.localeCompare(b.path),
  ),
)

/** The open folders, each path once however many roots show it. */
export const expandedFolderPaths = computed(() =>
  [...new Set([...expanded.value.values()].map((place) => place.path))].sort(),
)

/** Whether a folder is open under any root. */
function isOpenAnywhere(path: string): boolean {
  const key = keyOf(path)
  for (const place of expanded.value.values()) if (keyOf(place.path) === key) return true
  return false
}

/** Roots and the open folders below them, the ones Rust should watch for changes. */
const watchedFolders = computed(() => {
  const found = new Map<string, string>()
  for (const row of treeRows.value) {
    if ((row.kind === 'root' || row.kind === 'folder') && row.expanded) {
      found.set(keyOf(row.path), row.path)
    }
  }
  return [...found.values()]
})

function isInside(path: string, root: string): boolean {
  const [key, rootKey] = [keyOf(path), keyOf(root)]
  return key === rootKey || key.startsWith(`${rootKey}/`)
}

/** The root a folder is opened under when the caller does not say: the innermost one that holds it. */
function underRoot(path: string, root?: string | null): string {
  return root ?? rootOf(path) ?? path
}

function isOpen(root: string, path: string): boolean {
  return expanded.value.has(placeKey(keyOf, root, path))
}

function setExpanded(root: string, path: string, open: boolean): void {
  const next = new Map(expanded.value)
  const key = placeKey(keyOf, root, path)
  if (open) next.set(key, { root, path })
  else next.delete(key)
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

/** A path as the tree tells places apart: slashes alike, and case ignored where the system ignores it. */
export function pathKey(path: string): string {
  return keyOf(path)
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

/**
 * Opens a folder if it is closed, and lists it. Leaves an open folder as it is. `root` names the
 * copy when the folder is shown under two roots; it is the innermost root otherwise.
 */
export async function openFolderRow(path: string, root?: string | null): Promise<void> {
  const under = underRoot(path, root)
  if (isOpen(under, path)) return
  setExpanded(under, path, true)
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
  await openFolderRow(root, root)
  for (const folder of trail) await openFolderRow(folder, root)
  select(path, root)
  requestScroll(path, 'row', root)
}

/**
 * Keeps the tree in step after a file or folder moved from `from` to `to`: open folders below it
 * stay open at the new place, the old listings go, and the selection follows. The folders it was in
 * and went to are listed again by the caller.
 */
export function remapPaths(from: string, to: string): void {
  const kept = new Map<string, Place>()
  const reopened: string[] = []
  for (const [key, place] of expanded.value) {
    if (!isInside(place.path, from)) {
      kept.set(key, place)
      continue
    }
    const now = to + place.path.slice(from.length)
    kept.set(placeKey(keyOf, place.root, now), { root: place.root, path: now })
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
  if (selected !== null && isInside(selected, from)) {
    select(to + selected.slice(from.length), selectedUnder.value)
  }
  for (const folder of reopened) void loadFolder(folder)
}

/** Forgets a file or folder that is gone: its listings, its open state and its selection. */
export function forgetPath(path: string): void {
  const kept = new Map<string, Place>()
  for (const [key, place] of expanded.value) {
    if (!isInside(place.path, path)) kept.set(key, place)
  }
  expanded.value = kept
  for (const key of [...listings.keys()]) {
    if (isInside(key, path)) {
      listings.delete(key)
      newest.delete(key)
    }
  }
  if (selectedPath.value !== null && isInside(selectedPath.value, path)) select(null)
}

/**
 * Forgets a root that left the workspace: what is open and selected under it. A root that lies
 * inside it keeps its own state, and so do the listings of everything another root still shows.
 */
function forgetRoot(root: string): void {
  const kept = new Map<string, Place>()
  for (const [key, place] of expanded.value) {
    if (keyOf(place.root) !== keyOf(root)) kept.set(key, place)
  }
  expanded.value = kept
  for (const key of [...listings.keys()]) {
    if (!roots.value.some((remaining) => isInside(key, remaining))) {
      listings.delete(key)
      newest.delete(key)
    }
  }
}

/** Starts typing a name in the tree. A new entry's folder is opened first so its box shows. */
export async function startNaming(next: Naming): Promise<void> {
  const root = next.root ?? rootOf(next.kind === 'rename' ? next.path : next.parent)
  if (next.kind !== 'rename') await openFolderRow(next.parent, root)
  naming.value = { ...next, root }
  if (next.kind === 'rename') requestScroll(next.path, 'row', root)
  else requestScroll(next.parent, 'new', root)
}

/** Stops typing a name without doing anything. */
export function cancelNaming(): void {
  naming.value = null
  restoreTreeFocus()
}

/**
 * Opens a folder, or closes it when it is open. `root` names the copy when the folder is shown
 * under two roots; it is the innermost root otherwise.
 */
export async function toggleFolder(path: string, root?: string | null): Promise<void> {
  const under = underRoot(path, root)
  if (isOpen(under, path)) {
    setExpanded(under, path, false)
    return
  }
  setExpanded(under, path, true)
  // Listed again on every open, so what the tree shows is what the disk holds right now.
  await loadFolder(path)
}

function addRoot(path: string): void {
  if (!roots.value.some((root) => keyOf(root) === keyOf(path))) {
    roots.value = [...roots.value, path]
  }
  setExpanded(path, path, true)
  void loadFolder(path)
}

/** Shows the folder dialog and adds the chosen folder as a workspace root. */
export async function openFolderDialog(): Promise<void> {
  try {
    const host = await getHost()
    const path = await host.openFolder()
    if (path !== null) addRoot(path)
  } catch (error) {
    reportError(`Could not open the folder: ${describe(error)}`)
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
    reportError(`Could not add the folder: ${describe(error)}`)
  }
}

/** Takes a root out of the workspace. Open tabs stay open: their files are still the user's. */
export async function removeRootFolder(path: string): Promise<void> {
  try {
    const host = await getHost()
    await host.removeRoot(path)
  } catch (error) {
    reportError(`Could not remove the folder: ${describe(error)}`)
    return
  }
  const wasSelectedHere = selectedRoot.value !== null && samePath(selectedRoot.value, path)
  roots.value = roots.value.filter((root) => keyOf(root) !== keyOf(path))
  forgetRoot(path)
  if (wasSelectedHere) select(null)
}

/** The newest file the tree asked to open, so a double click waits for the click before it. */
let opening: Promise<void> = Promise.resolve()

/**
 * What a click or a key on a row does: select it, open or close a folder, open a file in a tab.
 * A file opens without taking focus from the tree, like a click in the sidebar of VS Code, unless
 * `focusEditor` is set (Enter, a double click), which puts the caret in the file (ISC-255). The
 * opens run one after another, so a double click focuses the editor only once the click has shown
 * the file.
 */
export function activateRow(row: TreeRow, how: { focusEditor?: boolean } = {}): Promise<void> {
  if (row.kind === 'note' || row.kind === 'new') return Promise.resolve()
  select(row.path, row.root)
  if (row.kind !== 'file') return toggleFolder(row.path, row.root)
  const { path } = row
  const focusEditor = how.focusEditor === true
  opening = opening.then(async () => {
    try {
      if (focusEditor) {
        await openInActivePane(path)
        focusActiveEditor()
      } else {
        await holdingEditorFocus(() => openInActivePane(path))
      }
    } catch (error) {
      reportError(`Could not open ${path}: ${describe(error)}`)
    }
  })
  return opening
}

// ---- keeping the keyboard in the tree ----

/** A request for the tree to take keyboard focus. `force` takes it from whatever has it. */
export interface TreeFocusRequest {
  readonly force: boolean
  readonly n: number
}

const focusRequest = shallowRef<TreeFocusRequest | null>(null)
let focusCount = 0

/** The pending request, for the tree to watch. */
export const treeFocusRequest = computed(() => focusRequest.value)

/**
 * Asks for focus to come back to the tree when it was lost to the page (a box or a dialog that
 * closed). Focus that sits somewhere else on purpose is left alone.
 */
export function restoreTreeFocus(): void {
  focusRequest.value = { force: false, n: ++focusCount }
}

/** Asks for focus to move to the tree whatever has it now (the Focus Sidebar command). */
export function focusTree(): void {
  focusRequest.value = { force: true, n: ++focusCount }
}

/** Takes the pending request, so a tree that is drawn later still hears one made before. */
export function takeTreeFocusRequest(): TreeFocusRequest | null {
  const pending = focusRequest.value
  focusRequest.value = null
  return pending
}

/** Listens for changes Rust sees in the open folders and lists those folders again. */
async function subscribe(): Promise<void> {
  if (subscribed) return
  const host = await getHost()
  stopTreeEvents?.()
  stopTreeEvents = await host.watchTree((folder) => {
    if (isOpenAnywhere(folder)) void loadFolder(folder)
  })
  subscribed = true
  await host.watchFolders(watchedFolders.value)
  // The status bar's Indexing label comes from the same startup path as the tree's own changes.
  await watchIndexStatus().catch((error: unknown) => {
    console.error('Could not watch the index', error)
  })
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
export async function restoreWorkspace(
  open: readonly string[],
  places?: readonly Place[],
): Promise<void> {
  const host = await getHost()
  keyOf = pathKeyer((await host.platformName()) !== 'linux')
  const found = await host.loadWorkspace()
  roots.value = found
  const next = new Map<string, Place>()
  const add = (root: string, path: string): void => {
    next.set(placeKey(keyOf, root, path), { root, path })
  }
  for (const root of found) add(root, root)
  if (places !== undefined) {
    for (const place of places) {
      const root = found.find((candidate) => keyOf(candidate) === keyOf(place.root))
      if (root !== undefined && isInside(place.path, root)) add(root, place.path)
    }
  } else {
    // A session from before places: a bare path opens under every root that holds it, which is
    // what was on screen then.
    for (const path of open) {
      for (const root of found) if (isInside(path, root)) add(root, path)
    }
  }
  expanded.value = next
  for (const path of new Set([...next.values()].map((place) => place.path))) void loadFolder(path)
  await subscribe().catch((error: unknown) => {
    reportError(`Could not watch the folders for changes: ${describe(error)}`)
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
  select(null)
  naming.value = null
  scrollRequest.value = null
  focusRequest.value = null
  opening = Promise.resolve()
}
