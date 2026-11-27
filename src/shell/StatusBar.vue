<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { indexCutNote, indexStatus } from '@/features/index/status'
import { zoomNote } from '@/features/settings/zoom'
import { fileStatus, watchFileStatus } from '@/features/status/fileStatus'
import { runCommand } from '@/workbench/commands'
import { COMMAND_IDS } from '@/workbench/defaultCommands'
import { findCounts } from '@/workbench/find'
import { workbenchLayout } from '@/workbench/store'

// The zoom level for a moment after it changes; else the match count of the find bar in the
// focused pane, when one is open; else the note about a folder too big to index whole. Things that
// went wrong are toasts (shell/toasts.ts).
const text = computed(
  () =>
    (zoomNote.value || undefined) ??
    findCounts.get(workbenchLayout.value.activePane) ??
    (indexCutNote.value || ''),
)

onBeforeUnmount(watchFileStatus())

const counted = (count: number, one: string): string =>
  `${count.toLocaleString('en-US')} ${one}${count === 1 ? '' : 's'}`

const position = computed(() => {
  const file = fileStatus.value
  if (file === null) return ''
  const at = `Ln ${String(file.line)}, Col ${String(file.column)}`
  const picked = file.selection
  if (picked === null) return at
  return `${at} (${counted(picked.chars, 'char')}, ${counted(picked.lines, 'line')})`
})

/** The items after the position, in the order they show; those with nothing to say are left out. */
const facts = computed(() => {
  const file = fileStatus.value
  if (file === null) return []
  return [
    { name: 'words', text: file.words === null ? '' : counted(file.words, 'word') },
    { name: 'eol', text: file.eol },
    { name: 'encoding', text: file.encoding },
    { name: 'language', text: file.language },
  ].filter((fact) => fact.text !== '')
})
</script>

<template>
  <footer
    class="flex h-statusbar shrink-0 items-center gap-4 overflow-hidden bg-statusbar px-3 text-xs text-statusbar-foreground select-none"
  >
    <!-- Takes the room the rest leaves, so in a narrow window the message is what is cut. -->
    <span
      class="min-w-0 flex-1 truncate"
      aria-live="polite"
      data-status-text
    >
      {{ text }}
    </span>
    <!-- Only while a folder is being read: the label and a thin bar of how far along. -->
    <span
      v-if="indexStatus.indexing"
      class="flex shrink-0 items-center gap-2"
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
          class="block h-full bg-primary"
          :style="{ width: `${indexStatus.percent}%` }"
          data-index-bar
        />
      </span>
    </span>
    <!-- About the file in the focused tab; absent for any other tab. With the message gone and
         still too little room, the position is cut, so the rest is never pushed out of sight. -->
    <span
      v-if="fileStatus"
      class="flex min-w-0 items-center gap-4 whitespace-nowrap"
      data-status-file
    >
      <button
        type="button"
        class="min-w-0 cursor-pointer truncate rounded-sm tabular-nums outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
        data-status-item="position"
        @mousedown.prevent
        @click="runCommand(COMMAND_IDS.goToLine)"
      >
        {{ position }}
      </button>
      <span
        v-for="fact in facts"
        :key="fact.name"
        class="shrink-0"
        :data-status-item="fact.name"
      >
        {{ fact.text }}
      </span>
    </span>
  </footer>
</template>
