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
  /** The last save failed with this message, or null. */
  readonly saveError: string | null
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
