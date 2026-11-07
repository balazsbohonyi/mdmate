<script setup lang="ts">
import { computed } from 'vue'
import { requestCloseTab } from '@/documents/store'
import EditorHost from './EditorHost.vue'
import PaneNotice from './PaneNotice.vue'
import type { PaneNode } from './splitTree'
import { focusPane, selectTab, tabInfo, tabRecord, tabTitle } from './store'
import { beginTabDrag, tabDrag } from './tabDrag'
import TabStrip from './TabStrip.vue'

const { pane, active } = defineProps<{ pane: PaneNode; active: boolean }>()

const tabs = computed(() => pane.tabs.map(tabInfo))
/** The document the pane's active tab shows, if it has a tab. */
const activeDocId = computed(() =>
  pane.activeTab === null ? null : (tabRecord(pane.activeTab)?.docId ?? null),
)

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
      @close="requestCloseTab"
      @press="startDrag"
    />
    <div
      data-pane-body
      class="flex min-h-0 flex-1 flex-col"
    >
      <template v-if="activeDocId !== null && pane.activeTab !== null">
        <PaneNotice
          :doc-id="activeDocId"
          :tab-id="pane.activeTab"
        />
        <div class="min-h-0 flex-1">
          <EditorHost
            :tab-id="pane.activeTab"
            :active="active"
          />
        </div>
      </template>
      <div
        v-else
        class="flex flex-1 items-center justify-center text-muted-foreground"
      >
        Open a file to start writing.
      </div>
    </div>
  </section>
</template>
