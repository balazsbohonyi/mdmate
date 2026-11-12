import { computed } from 'vue'
import { docMeta } from '@/documents/meta'
import { activeDocument } from '@/documents/store'
import { findPane } from '@/workbench/splitTree'
import { tabRecord, workbenchLayout } from '@/workbench/store'

/**
 * The shown file as the title bar names it: its path, or for a new file the name its tab carries
 * (Untitled-1). Depends on the layout so it follows the focused tab; the document itself is not
 * reactive.
 */
export const activeFileLabel = computed(() => {
  const layout = workbenchLayout.value
  const doc = activeDocument()
  if (doc !== undefined) {
    const meta = docMeta(doc.id)
    // A new file has no path yet, so its name stands in.
    const path = meta?.path ?? doc.path
    return path === '' ? (meta?.name ?? doc.name) : path
  }
  const tab = findPane(layout, layout.activePane)?.activeTab
  const record = tab === null || tab === undefined ? undefined : tabRecord(tab)
  return record?.kind === 'image' ? record.path : 'No file open'
})
