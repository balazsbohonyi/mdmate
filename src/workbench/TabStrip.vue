<script setup lang="ts">
import TabStripItem from './TabStripItem.vue'
import type { TabInfo } from './tabs'

/** `focused` is true when this strip's pane is the active pane; `draggingId` is the tab being dragged. */
const { focused = true, draggingId = null } = defineProps<{
  tabs: readonly TabInfo[]
  activeId: string | null
  focused?: boolean
  draggingId?: string | null
}>()
const emit = defineEmits<{
  select: [id: string]
  close: [id: string]
  press: [id: string, event: PointerEvent]
}>()
</script>

<template>
  <div
    role="tablist"
    class="flex h-tabstrip shrink-0 items-stretch overflow-x-auto border-b border-border bg-tabstrip [scrollbar-color:var(--handle)_transparent] [scrollbar-width:thin] select-none"
  >
    <TabStripItem
      v-for="tab in tabs"
      :key="tab.id"
      :tab="tab"
      :active="tab.id === activeId"
      :focused="focused"
      :dragging="tab.id === draggingId"
      @select="emit('select', tab.id)"
      @close="emit('close', tab.id)"
      @press="(event) => emit('press', tab.id, event)"
    />
  </div>
</template>
