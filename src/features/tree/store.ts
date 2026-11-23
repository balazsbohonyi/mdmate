import { computed, shallowReactive, shallowRef, watch } from 'vue'
import { describe, openInActivePane, provideImageBoundary } from '@/documents/store'
import { watchIndexStatus } from '@/features/index/status'
import { settings } from '@/lib/settings'
import { getHost } from '@/platform'
import { focusActiveEditor, holdingEditorFocus } from '@/workbench/focus'
import {
  flatten,
  parentPath,
  pathKeyer,
  placeKey,
  rangeBetween,
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

/** Selects a row on its own: its path, and the root it sits under when it is known. */
export function select(path: string | null, root: string | null = null): void {
  selectedPath.value = path
  selectedUnder.value = path === null ? null : root
  selection.value = new Map()
  anchor = path === null ? null : { root: root ?? rootOf(path) ?? path, path }
}

// ---- selecting several rows ----

/**
 * The rows selected together, by place. Empty, or a set that does not hold the lead row (a test or
 * an old caller set `selectedPath` alone), means the lead row is the whole selection. The lead is
 * the row last clicked or moved to, and the one the keyboard continues from.
 */
const selection = shallowRef<ReadonlyMap<string, Place>>(new Map())
/** Where a Shift range starts: the row last selected on its own or toggled with Ctrl. */
let anchor: Place | null = null

/** A place as the selection tells places apart. */
function placeId(root: string, path: string): string {
  return placeKey(keyOf, root, path)
}

/** Every selected place, the lead row last. A single selection is one place. */
export const selectedPlaces = computed<Place[]>(() => {
  const path = selectedPath.value
  if (path === null) return []
  const root = selectedRoot.value ?? path
  const set = selection.value
  if (!set.has(placeId(root, path))) return [{ root, path }]
  const others = [...set.values()].filter((place) => !(place.root === root && place.path === path))
  return [...others, { root, path }]
})

const selectedKeys = computed(
  () => new Set(selectedPlaces.value.map((place) => placeId(place.root, place.path))),
)

/** Whether a row is one of the selected ones. */
export function isSelectedPlace(root: string, path: string): boolean {
  return selectedKeys.value.has(placeId(root, path))
}

function applySelection(places: readonly Place[], lead: Place): void {
  selectedPath.value = lead.path
  selectedUnder.value = lead.root
  selection.value = new Map(places.map((place) => [placeId(place.root, place.path), place]))
}

/** Ctrl+click: adds the row to the selection, or takes it out when it is in. */
export function toggleSelected(path: string, root: string): void {
  const key = placeId(root, path)
  const current = selectedPlaces.value
  anchor = { root, path }
  if (current.some((place) => placeId(place.root, place.path) === key)) {
    const rest = current.filter((place) => placeId(place.root, place.path) !== key)
    const lead = rest.at(-1)
    if (lead === undefined) select(null)
    else applySelection(rest, lead)
    return
  }
  applySelection([...current, { root, path }], { root, path })
}

/**
 * Shift+click, and Shift with Up or Down: selects the rows from the anchor to this one, in the
 * order they are on screen, and makes this one the lead. The anchor stays where it was.
 */
export function selectRangeTo(rows: readonly TreeRow[], path: string, root: string): void {
  const from = anchor ?? selectedPlaces.value.at(-1) ?? { root, path }
  applySelection(rangeBetween(rows, from, { root, path }, keyOf), { root, path })
}

/** Goes back to the lead row alone (Escape, or a click on a selected row with no key held). */
export function collapseSelection(): void {
  const lead = selectedPlaces.value.at(-1)
  if (lead !== undefined && selectedPlaces.value.length > 1) select(lead.path, lead.root)
}

/** Selects these places together, the last one the lead. */
export function setSelection(places: readonly Place[]): void {
  const lead = places.at(-1)
  if (lead === undefined) {
    select(null)
    return
  }
  applySelection(places, lead)
  anchor = lead
}

/** Takes the places `gone` picks out of the selection, and the lead with them if it is one. */
function dropSelected(gone: (place: Place) => boolean): void {
  const all = selectedPlaces.value
  const rest = all.filter((place) => !gone(place))
  if (rest.length === all.length) return
  setSelection(rest)
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

/**
 * The names the tree hides (`workspace.hiddenNames`), lower case. Read here and not when a folder
 * is listed, so a change to the setting reaches the rows at once with no new listing, and the
 * listings keep every entry for what else reads them.
 */
const hiddenNames = computed(
  () => new Set(settings.workspace.hiddenNames.map((name) => name.toLowerCase())),
)

/**
 * Whether a path is a name the tree hides, or lies inside a folder it hides, counting only what is
 * below its root (a root is drawn whatever its name). `root` is the innermost one by default.
 */
export function isHiddenByName(path: string, root: string | undefined = rootOf(path)): boolean {
  if (root === undefined || !isInside(path, root)) return false
  const rest = path.slice(root.replace(/[\\/]+$/, '').length)
  return rest
    .split(/[\\/]/)
    .some((part) => part !== '' && hiddenNames.value.has(part.toLowerCase()))
}

// A row that becomes hidden must not stay selected: Delete and F2 would act on a row nobody sees.
watch(hiddenNames, () => {
  dropSelected((place) => isHiddenByName(place.path, place.root))
})

/** The rows on screen, top to bottom. */
export const treeRows = computed<TreeRow[]>(() => {
  const rows = flatten(roots.value, expanded.value, listings, keyOf, hiddenNames.value)
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
 * nothing for a path outside every root, or one the tree hides by name.
 */
export async function revealPath(path: string): Promise<void> {
  const root = rootOf(path)
  if (root === undefined) return
  // A row the tree hides has nothing to select or scroll to.
  if (isHiddenByName(path, root)) return
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
  const places = selectedPlaces.value
  if (places.length > 1) {
    // Several rows selected: each one that moved follows it, the others stay.
    const follow = (place: Place): Place =>
      isInside(place.path, from)
        ? { root: place.root, path: to + place.path.slice(from.length) }
        : place
    setSelection(places.map(follow))
  } else if (selected !== null && isInside(selected, from)) {
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
  dropSelected((place) => isInside(place.path, path))
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
  // The selection goes first: once the root is out of the list its rows no longer name a root.
  dropSelected((place) => samePath(place.root, path))
  roots.value = roots.value.filter((root) => keyOf(root) !== keyOf(path))
  forgetRoot(path)
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

/**
 * The selected files, in the order the tree shows them and each path once: what Open All opens.
 * Folders and workspace roots take no part, and a file selected under two roots is one file.
 */
export const selectedFiles = computed<string[]>(() => {
  const seen = new Set<string>()
  const files: string[] = []
  for (const row of treeRows.value) {
    if (row.kind !== 'file' || !isSelectedPlace(row.root, row.path)) continue
    const key = keyOf(row.path)
    if (seen.has(key)) continue
    seen.add(key)
    files.push(row.path)
  }
  return files
})

/**
 * Open All: shows the selected files, in the active pane and in tree order, and ends with the first
 * of them as the active tab (a file that is already open just takes the focus of its tab). A file
 * that cannot be opened is reported and the others still open. Like `activateRow`, it keeps focus
 * in the tree unless `focusEditor` is set (Enter), and it runs after any open still in progress.
 */
export function openAllSelected(how: { focusEditor?: boolean } = {}): Promise<void> {
  const paths = selectedFiles.value
  if (paths.length < 2) return Promise.resolve()
  const focusEditor = how.focusEditor === true
  const run = async (): Promise<void> => {
    const opened: string[] = []
    for (const path of paths) {
      try {
        await openInActivePane(path)
        opened.push(path)
      } catch (error) {
        reportError(`Could not open ${path}: ${describe(error)}`)
      }
    }
    const first = opened[0]
    if (first === undefined || opened.length < 2) return
    try {
      await openInActivePane(first)
    } catch (error) {
      reportError(`Could not open ${first}: ${describe(error)}`)
    }
  }
  opening = opening.then(async () => {
    if (focusEditor) {
      await run()
      focusActiveEditor()
    } else {
      await holdingEditorFocus(run)
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

const changeListeners = new Set<() => void>()
const resetListeners = new Set<() => void>()

/**
 * Calls `listener` whenever Rust says a folder the tree watches changed. The host holds one
 * listener for that, so anything else that wants to hear it goes through here. Returns the function
 * that stops it.
 */
export function onTreeChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

/** Calls `listener` when the tree is forgotten (`resetTree`), so state kept beside it goes too. */
export function onTreeReset(listener: () => void): () => void {
  resetListeners.add(listener)
  return () => {
    resetListeners.delete(listener)
  }
}

/** Listens for changes Rust sees in the open folders and lists those folders again. */
async function subscribe(): Promise<void> {
  if (subscribed) return
  const host = await getHost()
  stopTreeEvents?.()
  stopTreeEvents = await host.watchTree((folder) => {
    if (isOpenAnywhere(folder)) void loadFolder(folder)
    for (const listener of changeListeners) listener()
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
 * Lists a folder the session had open. One that cannot be read now (it is gone) is closed again
 * without a word; a root stays, with the reason under it, as it always has.
 */
async function loadRestored(path: string): Promise<void> {
  await loadFolder(path)
  const key = keyOf(path)
  const listing = listings.get(key)
  if (listing === undefined || listing.error === null) return
  const next = new Map(expanded.value)
  for (const [at, place] of next) {
    if (keyOf(place.path) === key && keyOf(place.root) !== key) next.delete(at)
  }
  if (next.size === expanded.value.size) return
  expanded.value = next
  listings.delete(key)
}

/**
 * Brings the workspace back at startup. Rust says which folders are roots (it kept the list
 * itself and granted them again); the session only says which folders were open, and a folder
 * outside every root is ignored. Listings run in the background so the window does not wait.
 *
 * `places` is the saved state when it is there: exactly those places are open, so a root the
 * owner collapsed stays collapsed, and an empty list means everything was collapsed. Without it
 * (a first start, or a session from before places) every root opens one level, as it always did.
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
  if (places === undefined) for (const root of found) add(root, root)
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
  for (const path of new Set([...next.values()].map((place) => place.path))) void loadRestored(path)
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
  for (const listener of resetListeners) listener()
}
