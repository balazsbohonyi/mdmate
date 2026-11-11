import { setDocMeta } from '@/documents/meta'
import { openTabFor } from '@/workbench/store'
import type { TabId } from '@/workbench/splitTree'
import type { TabRecord } from '@/workbench/tabs'

let nextDoc = 1000

/** A document the chrome knows by name, with no editor behind it. For layout tests. */
export function namedDoc(name: string): TabRecord {
  const id = ++nextDoc
  setDocMeta({
    id,
    name,
    path: `/test/${name}`,
    dirty: false,
    readOnly: null,
    kind: 'markdown',
    plainSource: false,
    untitled: false,
    missing: false,
    saveError: null,
    conflict: null,
  })
  return { kind: 'markdown', docId: id }
}

/** Opens a tab titled `name` in the active pane. */
export function openNewTab(name: string): TabId {
  return openTabFor(namedDoc(name))
}
