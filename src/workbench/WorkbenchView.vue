<script setup lang="ts">
import SplitNodeView from './SplitNodeView.vue'
import { workbenchLayout } from './store'
import TabDragLayer from './TabDragLayer.vue'
</script>

<template>
  <div class="h-full min-h-0 w-full min-w-0 flex-1">
    <SplitNodeView
      :node="workbenchLayout.root"
      :active-pane="workbenchLayout.activePane"
    />
    <TabDragLayer />
  </div>
</template>
