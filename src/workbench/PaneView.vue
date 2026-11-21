<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { requestCloseTab } from '@/documents/store'
import { newUntitledTab } from '@/documents/untitled'
import EditorHost from './EditorHost.vue'
import FindBar from './FindBar.vue'
import { findBars } from './find'
import { focusActiveEditor } from './focus'
import ImageView from './ImageView.vue'
import PaneNotice from './PaneNotice.vue'
import { pinnedCount, type PaneNode } from './splitTree'
import { isRaw } from './rawMode'
import { focusPane, selectTab, tabInfo, tabRecord, tabTitle, unpinTabById } from './store'
import { docIdOf } from './tabs'
import { beginTabDrag, tabDrag } from './tabDrag'
import { cancelCycle, markedTab, tabCycle } from './tabCycle'
import TabStrip from './TabStrip.vue'

// The Settings screen loads the first time its tab is shown (check-arch: settings-lazy), so a
// window that never opens it never pays for it.
const SettingsView = defineAsyncComponent(() => import('@/features/settings/SettingsView.vue'))
// The Theme preview loads the same way: the first time its tab is shown (theme-preview-lazy).
const ThemePreview = defineAsyncComponent(
  () => import('@/features/themes/preview/ThemePreview.vue'),
)

const { pane, active } = defineProps<{ pane: PaneNode; active: boolean }>()

const tabs = computed(() =>
  pane.tabs.map((id, at) =>
    at < pinnedCount(pane) ? { ...tabInfo(id), pinned: true } : tabInfo(id),
  ),
)
const activeRecord = computed(() =>
  pane.activeTab === null ? undefined : tabRecord(pane.activeTab),
)
/** The tab Ctrl+Tab has marked in this pane, or null when no cycle is open here. */
const cycleMark = computed(() => {
  const cycle = tabCycle.value
  return cycle !== null && cycle.paneId === pane.id ? markedTab(cycle) : null
})
/** The document the pane's active tab shows, if it shows one. */
const activeDocId = computed(() => docIdOf(activeRecord.value) ?? null)
/** The image the pane's active tab shows, if it shows one. */
const activeImage = computed(() => {
  const record = activeRecord.value
  return record?.kind === 'image' ? record : null
})

/** True while the pane's active tab is the Settings tab. */
const activeSettings = computed(() => activeRecord.value?.kind === 'settings')

/** True while the pane's active tab is the Theme preview. */
const activePreview = computed(() => activeRecord.value?.kind === 'themePreview')

/** A click on a tab puts the caret in its editor, also when that tab was already the one shown (ISC-255). */
function onSelect(id: string): void {
  selectTab(id)
  focusActiveEditor()
}

function startDrag(id: string, event: PointerEvent): void {
  beginTabDrag(event, {
    id,
    title: tabTitle(id),
    paneId: pane.id,
    paneTabCount: pane.tabs.length,
    pinned: pane.tabs.indexOf(id) < pinnedCount(pane),
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
      :cycle-mark="cycleMark"
      @select="onSelect"
      @close="requestCloseTab"
      @unpin="unpinTabById"
      @press="startDrag"
      @new="void newUntitledTab(pane.id)"
      @cycle-cancel="cancelCycle"
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
            :raw="isRaw(pane.id)"
          />
        </div>
        <FindBar
          v-if="findBars.has(pane.id)"
          :pane-id="pane.id"
          :tab-id="pane.activeTab"
          :doc-id="activeDocId"
        />
      </template>
      <ImageView
        v-else-if="activeImage !== null"
        :key="pane.activeTab ?? ''"
        :tab-id="pane.activeTab ?? ''"
        :path="activeImage.path"
        :size="activeImage.size"
      />
      <SettingsView
        v-else-if="activeSettings"
        :key="pane.activeTab ?? ''"
        :tab-id="pane.activeTab ?? ''"
      />
      <ThemePreview
        v-else-if="activePreview"
        :key="pane.activeTab ?? ''"
      />
      <div
        v-else
        class="flex flex-1 items-center justify-center text-muted-foreground"
      >
        Open a file to start writing.
      </div>
    </div>
  </section>
</template>
