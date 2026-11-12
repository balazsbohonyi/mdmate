import type { TreeEntry } from '@/platform'

/**
 * The tree as plain data: which rows are on screen for a set of roots, which folders are open and
 * what each folder holds. No Vue and no host in here, so the rules are easy to test.
 */

/** Row height in CSS pixels. The window math below needs the exact number, so rows set it inline. */
export const ROW_HEIGHT = 24

/** Rows drawn beyond the visible ones on each side, so a fast scroll never shows blank. */
export const OVERSCAN = 8

/** Used before the container has been measured (and in tests, where nothing has a size). */
export const FALLBACK_VIEWPORT_HEIGHT = 600

/** What a folder's last listing gave. */
export interface Listing {
  /** The entries, or null until the first listing arrives. */
  readonly entries: readonly TreeEntry[] | null
  /** Why the last listing failed, or null. A failed listing keeps the entries it had. */
  readonly error: string | null
}

/**
 * A place in the tree: a path as shown under one root. A folder that is a root and also lies
 * inside another root is two places, and each keeps its own open state and selection.
 */
export interface Place {
  readonly root: string
  readonly path: string
}

/** What a place is called in the open-folder map: the root and the path, case folded as the OS does. */
export function placeKey(keyOf: (path: string) => string, root: string, path: string): string {
  return `${keyOf(root)}|${keyOf(path)}`
}

export type TreeRow =
  | {
      readonly kind: 'root' | 'folder'
      /** The root this row sits under; a root row names itself. */
      readonly root: string
      readonly path: string
      readonly name: string
      readonly depth: number
      readonly expanded: boolean
    }
  | {
      readonly kind: 'file'
      readonly root: string
      readonly path: string
      readonly name: string
      readonly depth: number
      /** False for anything that is not Markdown; the tree draws those dimmed. */
      readonly markdown: boolean
    }
  | {
      /** The box where a new file or folder is named, first under the folder it is made in. */
      readonly kind: 'new'
      readonly root: string
      /** The folder the new entry goes in. */
      readonly path: string
      readonly name: string
      readonly depth: number
      readonly creates: 'file' | 'folder'
    }
  | {
      /** A line of text under a folder: it could not be read, or it is still loading. */
      readonly kind: 'note'
      readonly root: string
      readonly path: string
      readonly name: string
      readonly depth: number
      readonly tone: 'error' | 'muted'
    }

/** Extensions the app edits as Markdown. The open dialog's first filter lists the same ones. */
const MARKDOWN = new Set(['md', 'markdown', 'mdown', 'mkd', 'mdx'])

export function isMarkdownName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && MARKDOWN.has(name.slice(dot + 1).toLowerCase())
}

/** The last part of a path. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}

/** The folder a path is in, or null for a path with no folder part. */
export function parentPath(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut <= 0 ? null : trimmed.slice(0, cut)
}

/** The part of a rename that stays when a file is renamed: its name without the extension. */
export function stemLength(name: string): number {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? dot : name.length
}

/**
 * Puts `inserted` into the rows right after the row of `folder`, which is where a new entry's
 * naming box goes. `root` picks the copy when the folder is on screen under two roots. Rows come
 * back unchanged when the folder is not on screen or is closed.
 */
export function withNewRow(
  rows: readonly TreeRow[],
  folder: string,
  creates: 'file' | 'folder',
  keyOf: (path: string) => string,
  root?: string,
): TreeRow[] {
  const index = rows.findIndex(
    (row) =>
      (row.kind === 'root' || row.kind === 'folder') &&
      keyOf(row.path) === keyOf(folder) &&
      (root === undefined || keyOf(row.root) === keyOf(root)),
  )
  const parent = rows[index]
  if (parent === undefined || (parent.kind !== 'root' && parent.kind !== 'folder')) {
    return [...rows]
  }
  if (!parent.expanded) return [...rows]
  const row: TreeRow = {
    kind: 'new',
    root: parent.root,
    path: parent.path,
    name: '',
    depth: parent.depth + 1,
    creates,
  }
  return [...rows.slice(0, index + 1), row, ...rows.slice(index + 1)]
}

/**
 * The separator a path is written with: a backslash for a path that has backslashes and no forward
 * slash (a Windows path as Rust gives it), a forward slash for everything else.
 */
export function separatorOf(path: string): '\\' | '/' {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/'
}

/** `parent` and `name` as one path, with the separator the parent already uses. */
export function joinPath(parent: string, name: string): string {
  const separator = separatorOf(parent)
  return parent.endsWith('/') || parent.endsWith('\\')
    ? `${parent}${name}`
    : `${parent}${separator}${name}`
}

/**
 * How folders are told apart: by path, with case ignored where the file system ignores it. The
 * tree builds child paths from the names Rust listed, so two spellings only differ when Rust and
 * the OS disagree about case, which this makes harmless.
 */
export function pathKeyer(ignoreCase: boolean): (path: string) => string {
  return (path) => {
    const slashes = path.replaceAll('\\', '/').replace(/\/+$/, '')
    return ignoreCase ? slashes.toLowerCase() : slashes
  }
}

/**
 * The rows on screen, top to bottom. A root or folder shows its children when its place (see
 * `placeKey`) is in `expanded`; a folder that is open but not listed yet shows a loading line,
 * and one whose listing failed shows the reason. Listings are by path alone: both copies of a
 * folder show the same files.
 */
export function flatten(
  roots: readonly string[],
  expanded: { has(key: string): boolean },
  listings: ReadonlyMap<string, Listing>,
  keyOf: (path: string) => string,
): TreeRow[] {
  const rows: TreeRow[] = []
  const add = (root: string, path: string, kind: 'root' | 'folder', depth: number): void => {
    const open = expanded.has(placeKey(keyOf, root, path))
    rows.push({ kind, root, path, name: baseName(path), depth, expanded: open })
    if (!open) return
    const listing = listings.get(keyOf(path))
    if (listing?.error != null) {
      rows.push({ kind: 'note', root, path, name: listing.error, depth: depth + 1, tone: 'error' })
    }
    if (listing?.entries == null) {
      if (listing === undefined) {
        rows.push({ kind: 'note', root, path, name: 'Loading…', depth: depth + 1, tone: 'muted' })
      }
      return
    }
    for (const entry of listing.entries) {
      const child = joinPath(path, entry.name)
      if (entry.kind === 'folder') add(root, child, 'folder', depth + 1)
      else {
        rows.push({
          kind: 'file',
          root,
          path: child,
          name: entry.name,
          depth: depth + 1,
          markdown: isMarkdownName(entry.name),
        })
      }
    }
  }
  for (const root of roots) add(root, root, 'root', 0)
  return rows
}

/** Which rows to draw for a scroll position: `[start, end)`, with some beyond the edges. */
export function visibleWindow(
  scrollTop: number,
  viewportHeight: number,
  total: number,
): { readonly start: number; readonly end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / ROW_HEIGHT)
  const count = Math.ceil(Math.max(0, viewportHeight) / ROW_HEIGHT) + 1
  return {
    start: Math.max(0, first - OVERSCAN),
    end: Math.min(total, first + count + OVERSCAN),
  }
}

// ---- the keyboard ----

/** A row the user can select: not a note and not the box a new name is typed in. */
export type SelectableRow = Exclude<TreeRow, { readonly kind: 'note' | 'new' }>

export function isSelectable(row: TreeRow): row is SelectableRow {
  return row.kind !== 'note' && row.kind !== 'new'
}

/**
 * The id of a row's element, for `aria-activedescendant`. Percent-escaped, so it never holds a
 * space; the root is part of it, so a folder shown under two roots gets two ids.
 */
export function rowDomId(path: string, root?: string | null): string {
  return root == null
    ? `tree-row-${encodeURIComponent(path)}`
    : `tree-row-${encodeURIComponent(root)}:${encodeURIComponent(path)}`
}

/** What a key does to the tree. `open` shows a file; `focusEditor` also puts the caret in it. */
export type KeyAction =
  | { readonly kind: 'select'; readonly root: string; readonly path: string }
  | { readonly kind: 'toggle'; readonly root: string; readonly path: string }
  | {
      readonly kind: 'open'
      readonly root: string
      readonly path: string
      readonly focusEditor: boolean
    }

/** The keys the tree reads, with no modifier held. */
export const TREE_KEYS: readonly string[] = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'Enter',
  ' ',
]

/**
 * Where the selection is among the rows. A selected row that is hidden (inside a folder that was
 * closed since) counts as its nearest ancestor that is on screen, under the same root; with no
 * selection, or none of its ancestors on screen, there is no current row. With no `root` the
 * first row that has the path counts.
 */
function currentIndex(
  rows: readonly TreeRow[],
  selected: string | null,
  root: string | null,
): number {
  let path: string | null = selected
  while (path !== null) {
    const found = rows.findIndex(
      (row) => isSelectable(row) && row.path === path && (root === null || row.root === root),
    )
    if (found !== -1) return found
    path = parentPath(path)
  }
  return -1
}

/**
 * What `key` does to the tree, given the rows on screen and the selected place, or null when it
 * does nothing. Up and Down only move the selection: opening a file takes Enter, Space or a click.
 * Right opens a folder, then steps into it; Left closes it, then steps out to its parent. Enter and
 * Space open or close a folder; on a file Enter opens it and takes focus, Space opens it and keeps
 * focus in the tree.
 */
export function keyAction(
  rows: readonly TreeRow[],
  selected: string | null,
  key: string,
  selectedRoot: string | null = null,
): KeyAction | null {
  const selectable = rows.filter(isSelectable)
  const first = selectable[0]
  const last = selectable.at(-1)
  if (first === undefined || last === undefined) return null
  const index = currentIndex(rows, selected, selectedRoot)
  const current = index === -1 ? undefined : rows[index]
  const select = (row: SelectableRow): KeyAction => ({
    kind: 'select',
    root: row.root,
    path: row.path,
  })
  if (key === 'Home') return select(first)
  if (key === 'End') return select(last)
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (current === undefined || !isSelectable(current)) return select(first)
    const among = selectable.indexOf(current)
    const next = selectable[key === 'ArrowDown' ? among + 1 : among - 1]
    return next === undefined ? null : select(next)
  }
  if (current === undefined || !isSelectable(current)) return null
  const folder = current.kind === 'root' || current.kind === 'folder'
  if (key === 'ArrowRight') {
    if (!folder) return null
    if (!current.expanded) return { kind: 'toggle', root: current.root, path: current.path }
    const child = rows[index + 1]
    return child !== undefined && isSelectable(child) && child.depth > current.depth
      ? select(child)
      : null
  }
  if (key === 'ArrowLeft') {
    if (folder && current.expanded) {
      return { kind: 'toggle', root: current.root, path: current.path }
    }
    for (let at = index - 1; at >= 0; at--) {
      const row = rows[at]
      if (row !== undefined && isSelectable(row) && row.depth < current.depth) return select(row)
    }
    return null
  }
  if (key === 'Enter' || key === ' ') {
    return folder
      ? { kind: 'toggle', root: current.root, path: current.path }
      : { kind: 'open', root: current.root, path: current.path, focusEditor: key === 'Enter' }
  }
  return null
}
