<script setup lang="ts">
import { computed } from 'vue'
import { problem } from '@/documents/store'
import { findCounts } from '@/workbench/find'
import { workbenchLayout } from '@/workbench/store'

// A message wins; else the match count of the find bar in the focused pane, when one is open.
const text = computed(() => problem.value ?? findCounts.get(workbenchLayout.value.activePane) ?? '')
</script>

<template>
  <footer
    class="flex h-statusbar shrink-0 items-center gap-4 bg-statusbar px-3 text-xs text-statusbar-foreground select-none"
  >
    <span
      class="min-w-0 truncate"
      aria-live="polite"
      data-status-text
    >
      {{ text }}
    </span>
  </footer>
</template>
