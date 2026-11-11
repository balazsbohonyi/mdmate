import { shallowReactive } from 'vue'
import type { ReadOnlyReason } from '@/platform'

/**
 * What the chrome shows about an open document: its name in the tab, whether it has unsaved
 * edits, and any notice. Plain data in a reactive map; the document itself (its editor state)
 * never enters Vue's reactivity.
 */
export interface DocMeta {
  readonly id: number
  readonly name: string
  readonly path: string
  /** Edited since the last save or load. */
  readonly dirty: boolean
  /** Why the document cannot be saved, or null when it can. */
  readonly readOnly: ReadOnlyReason | null
  /** How the file opens: Markdown in the live editor, anything else as plain source. */
  readonly kind: 'markdown' | 'text'
  /** Opened as plain source: not Markdown, or Markdown above the size cutoff. */
  readonly plainSource: boolean
  /** No file yet: a new tab that the first save gives one. */
  readonly untitled: boolean
  /** The file is gone from disk, as of the last time anyone looked. Revert File is off then. */
  readonly missing: boolean
  /** The last save failed with this message, or null. */
  readonly saveError: string | null
  /**
   * The file changed on disk while the document has edits the disk does not have, and the user has
   * not said which to keep. `'save'` when the app found out by refusing a save, so that keeping
   * the edits goes on to save them.
   */
  readonly conflict: 'disk' | 'save' | null
}

const metas = shallowReactive(new Map<number, DocMeta>())

export function docMeta(id: number): DocMeta | undefined {
  return metas.get(id)
}

export function setDocMeta(meta: DocMeta): void {
  metas.set(meta.id, meta)
}

export function patchDocMeta(id: number, patch: Partial<Omit<DocMeta, 'id'>>): void {
  const current = metas.get(id)
  if (current !== undefined) metas.set(id, { ...current, ...patch })
}

export function removeDocMeta(id: number): void {
  metas.delete(id)
}

export function clearDocMeta(): void {
  metas.clear()
}
