import type { OutlineRequest } from '@/platform'

/** What a request is made from: the parts of a document that say where its text is. */
interface Scannable {
  readonly path: string
  readonly dirty: boolean
  readonly untitled: boolean
  snapshot(): { readonly text: string }
}

/** A heading scan of a document: its text when the disk does not have it, its path when it does. */
export function outlineRequest(doc: Scannable, id: number): OutlineRequest {
  return doc.dirty || doc.untitled ? { id, text: doc.snapshot().text } : { id, path: doc.path }
}
