<script setup lang="ts">
import { computed } from 'vue'
import { problem } from '@/documents/store'
import { indexCutNote, indexStatus } from '@/features/index/status'
import { findCounts } from '@/workbench/find'
import { workbenchLayout } from '@/workbench/store'

// A message wins; else the match count of the find bar in the focused pane, when one is open; else
// the note about a folder too big to index whole.
const text = computed(
  () =>
    problem.value ?? findCounts.get(workbenchLayout.value.activePane) ?? (indexCutNote.value || ''),
)
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
    <!-- Only while a folder is being read: the label and a thin bar of how far along. -->
    <span
      v-if="indexStatus.indexing"
      class="ml-auto flex shrink-0 items-center gap-2"
      data-index-status
    >
      <span>Indexing</span>
      <span
        class="block h-1 w-24 overflow-hidden rounded-full bg-statusbar-foreground/20"
        role="progressbar"
        aria-label="Indexing"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="indexStatus.percent"
      >
        <span
          class="block h-full bg-statusbar-foreground"
          :style="{ width: `${indexStatus.percent}%` }"
          data-index-bar
        />
      </span>
    </span>
  </footer>
</template>
