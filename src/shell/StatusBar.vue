<script setup lang="ts">
import { computed } from 'vue'
import { docMeta } from '@/documents/meta'
import { activeDocument, problem } from '@/documents/store'
import { findPane } from '@/workbench/splitTree'
import { tabRecord, workbenchLayout } from '@/workbench/store'

// Depends on the layout so the label follows the focused tab; the document itself is not reactive.
const label = computed(() => {
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
</script>

<template>
  <footer
    class="flex h-statusbar shrink-0 items-center gap-4 bg-statusbar px-3 text-xs text-statusbar-foreground select-none"
  >
    <span class="min-w-0 truncate">{{ problem ?? label }}</span>
  </footer>
</template>
