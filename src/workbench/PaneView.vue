<script setup lang="ts">
import { computed } from 'vue'
import type { PaneNode } from './splitTree'
import { closeTabById, focusPane, selectTab, tabTitle } from './store'
import TabStrip from './TabStrip.vue'

const { pane, active } = defineProps<{ pane: PaneNode; active: boolean }>()

const tabs = computed(() => pane.tabs.map((id) => ({ id, title: tabTitle(id) })))
const activeTitle = computed(() => (pane.activeTab === null ? null : tabTitle(pane.activeTab)))
</script>

<template>
  <section
    class="flex h-full min-h-0 min-w-0 flex-col bg-background"
    :data-pane-id="pane.id"
    :data-active="active"
    @pointerdown.capture="focusPane(pane.id)"
  >
    <TabStrip
      :tabs="tabs"
      :active-id="pane.activeTab"
      :focused="active"
      @select="selectTab"
      @close="closeTabById"
    />
    <div class="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
      {{ activeTitle ?? 'Open a file to start writing.' }}
    </div>
  </section>
</template>
