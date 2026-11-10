/** What the file index answers for Ctrl+P, as the page reads it. */
export interface QuickOpenItem {
  /** The file as people read paths; the page opens it the way a tree row does. */
  readonly path: string
  /** The path as shown: relative to its folder, led by the folder's name when several are open. */
  readonly rel: string
  /** Where the file's own name starts in `rel`, in UTF-16 units like `matches`. */
  readonly nameStart: number
  /** The letters of `rel` that matched what was typed. */
  readonly matches: readonly number[]
}

export interface QuickOpenAnswer {
  readonly items: readonly QuickOpenItem[]
  /** How many files matched, of which `items` holds the best. */
  readonly total: number
  /** How many files the index holds. */
  readonly indexed: number
  /** True when the open folders hold more files than are indexed. */
  readonly truncated: boolean
}

function numbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === 'number')
    : []
}

/** Reads what Rust sent, so a malformed answer fails here and not in the list. */
export function parseQuickOpenAnswer(value: unknown): QuickOpenAnswer {
  if (typeof value !== 'object' || value === null) throw new Error('quick open: not an object')
  const raw = value as Record<string, unknown>
  const rows = Array.isArray(raw.items) ? raw.items : []
  const items = rows.flatMap((row: unknown): QuickOpenItem[] => {
    if (typeof row !== 'object' || row === null) return []
    const item = row as Record<string, unknown>
    if (typeof item.path !== 'string' || typeof item.rel !== 'string') return []
    return [
      {
        path: item.path,
        rel: item.rel,
        nameStart: typeof item.nameStart === 'number' ? item.nameStart : 0,
        matches: numbers(item.matches),
      },
    ]
  })
  return {
    items,
    total: typeof raw.total === 'number' ? raw.total : items.length,
    indexed: typeof raw.indexed === 'number' ? raw.indexed : items.length,
    truncated: raw.truncated === true,
  }
}
