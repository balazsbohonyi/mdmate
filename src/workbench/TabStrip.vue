<script setup lang="ts">
import TabStripItem from './TabStripItem.vue'
import type { TabInfo } from './tabs'

defineProps<{ tabs: readonly TabInfo[]; activeId: string | null }>()
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
      @select="emit('select', tab.id)"
      @close="emit('close', tab.id)"
    />
  </div>
</template>
