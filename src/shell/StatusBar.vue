<script setup lang="ts">
import { computed } from 'vue'
import { docMeta } from '@/documents/meta'
import { activeDocument, problem } from '@/documents/store'
import { workbenchLayout } from '@/workbench/store'

defineProps<{ platformName: string }>()

// Depends on the layout so the label follows the focused tab; the document itself is not reactive.
const label = computed(() => {
  void workbenchLayout.value
  const doc = activeDocument()
  return doc === undefined ? 'No file open' : (docMeta(doc.id)?.path ?? doc.path)
})
</script>

<template>
  <footer
    class="flex h-statusbar shrink-0 items-center justify-between gap-4 bg-statusbar px-3 text-xs text-statusbar-foreground select-none"
  >
    <span class="min-w-0 truncate">{{ problem ?? label }}</span>
    <span class="shrink-0">{{ platformName }}</span>
  </footer>
</template>
