/** How the workspace index is doing, as Rust reports it. */
export interface IndexStatus {
  /** A folder is being read, for the first time or again to check it against the disk. */
  readonly indexing: boolean
  /** How far along, 0 to 99 while indexing and 0 otherwise. */
  readonly percent: number
  /** The names of the folders cut at the file limit. */
  readonly cut: readonly string[]
}

/** What the page shows before Rust has said anything. */
export const IDLE_INDEX: IndexStatus = { indexing: false, percent: 0, cut: [] }

/** Reads what Rust sent, so a malformed status fails here and not in the status bar. */
export function parseIndexStatus(value: unknown): IndexStatus {
  if (typeof value !== 'object' || value === null) throw new Error('index status: not an object')
  const raw = value as Record<string, unknown>
  if (typeof raw.indexing !== 'boolean') throw new Error('index status: indexing is not a boolean')
  const percent = raw.percent
  if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 0 || percent > 100)
    throw new Error('index status: percent is not a whole number from 0 to 100')
  const cut = Array.isArray(raw.cut) ? raw.cut : []
  if (!cut.every((name): name is string => typeof name === 'string'))
    throw new Error('index status: cut holds something that is not a name')
  return { indexing: raw.indexing, percent, cut: [...cut] }
}
