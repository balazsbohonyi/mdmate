<script setup lang="ts">
import TabStripItem from './TabStripItem.vue'
import type { TabInfo } from './tabs'

/** `focused` is true when this strip's pane is the active pane. */
const { focused = true } = defineProps<{
  tabs: readonly TabInfo[]
  activeId: string | null
  focused?: boolean
}>()
const emit = defineEmits<{ select: [id: string]; close: [id: string] }>()
</script>

<template>
  <div
    role="tablist"
    class="flex h-tabstrip shrink-0 items-stretch overflow-x-auto border-b border-border bg-tabstrip select-none"
  >
    <TabStripItem
      v-for="tab in tabs"
      :key="tab.id"
      :tab="tab"
      :active="tab.id === activeId"
      :focused="focused"
      @select="emit('select', tab.id)"
      @close="emit('close', tab.id)"
    />
  </div>
</template>
