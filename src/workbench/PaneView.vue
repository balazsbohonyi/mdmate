<script setup lang="ts">
import { computed } from 'vue'
import type { PaneNode } from './splitTree'
import { closeTabById, focusPane, selectTab, tabTitle } from './store'
import { beginTabDrag, tabDrag } from './tabDrag'
import TabStrip from './TabStrip.vue'

const { pane, active } = defineProps<{ pane: PaneNode; active: boolean }>()

const tabs = computed(() => pane.tabs.map((id) => ({ id, title: tabTitle(id) })))
const activeTitle = computed(() => (pane.activeTab === null ? null : tabTitle(pane.activeTab)))

function startDrag(id: string, event: PointerEvent): void {
  beginTabDrag(event, {
    id,
    title: tabTitle(id),
    paneId: pane.id,
    paneTabCount: pane.tabs.length,
  })
}
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
      :dragging-id="tabDrag?.tabId ?? null"
      @select="selectTab"
      @close="closeTabById"
      @press="startDrag"
    />
    <div
      data-pane-body
      class="flex min-h-0 flex-1 items-center justify-center text-muted-foreground"
    >
      {{ activeTitle ?? 'Open a file to start writing.' }}
    </div>
  </section>
</template>
