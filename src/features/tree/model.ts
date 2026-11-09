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

export type TreeRow =
  | {
      readonly kind: 'root' | 'folder'
      readonly path: string
      readonly name: string
      readonly depth: number
      readonly expanded: boolean
    }
  | {
      readonly kind: 'file'
      readonly path: string
      readonly name: string
      readonly depth: number
      /** False for anything that is not Markdown; the tree draws those dimmed. */
      readonly markdown: boolean
    }
  | {
      /** A line of text under a folder: it could not be read, or it is still loading. */
      readonly kind: 'note'
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

/** `parent` and `name` as one path, with the separator the parent already uses. */
export function joinPath(parent: string, name: string): string {
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
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
 * The rows on screen, top to bottom. A root or folder shows its children when its key is in
 * `expanded`; a folder that is open but not listed yet shows a loading line, and one whose
 * listing failed shows the reason.
 */
export function flatten(
  roots: readonly string[],
  expanded: { has(key: string): boolean },
  listings: ReadonlyMap<string, Listing>,
  keyOf: (path: string) => string,
): TreeRow[] {
  const rows: TreeRow[] = []
  const add = (path: string, kind: 'root' | 'folder', depth: number): void => {
    const key = keyOf(path)
    const open = expanded.has(key)
    rows.push({ kind, path, name: baseName(path), depth, expanded: open })
    if (!open) return
    const listing = listings.get(key)
    if (listing?.error != null) {
      rows.push({ kind: 'note', path, name: listing.error, depth: depth + 1, tone: 'error' })
    }
    if (listing?.entries == null) {
      if (listing === undefined) {
        rows.push({ kind: 'note', path, name: 'Loading…', depth: depth + 1, tone: 'muted' })
      }
      return
    }
    for (const entry of listing.entries) {
      const child = joinPath(path, entry.name)
      if (entry.kind === 'folder') add(child, 'folder', depth + 1)
      else {
        rows.push({
          kind: 'file',
          path: child,
          name: entry.name,
          depth: depth + 1,
          markdown: isMarkdownName(entry.name),
        })
      }
    }
  }
  for (const root of roots) add(root, 'root', 0)
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
