<script setup lang="ts">
import { computed } from 'vue'
import { tabDrag } from './tabDrag'

/** The drop preview, as inline geometry. An insertion bar in a strip is solid, a pane preview is a tint. */
const preview = computed(() => {
  const target = tabDrag.value?.target
  if (!target) return null
  const { left, top, right, bottom } = target.preview
  return {
    solid: target.kind === 'strip',
    style: {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    },
  }
})

/** Room the label needs beside the pointer: its widest size plus a gap. */
const LABEL_ROOM_PX = 240

/** The label sits right of and below the pointer, and flips to its left near the window's right edge. */
const labelStyle = computed(() => {
  const drag = tabDrag.value
  if (!drag) return {}
  const top = `${drag.y + 12}px`
  return drag.x > window.innerWidth - LABEL_ROOM_PX
    ? { right: `${window.innerWidth - drag.x + 12}px`, top }
    : { left: `${drag.x + 12}px`, top }
})
</script>

<template>
  <div
    v-if="tabDrag"
    class="fixed inset-0 z-50 cursor-grabbing select-none"
    data-tab-drag-layer
  >
    <div
      v-if="preview"
      class="pointer-events-none fixed"
      :class="preview.solid ? 'bg-primary' : 'border border-primary bg-drop-preview'"
      :style="preview.style"
      data-drop-preview
    />
    <div
      class="pointer-events-none fixed max-w-56 truncate rounded-sm border border-border bg-popover px-3 py-1 text-chrome text-popover-foreground shadow-md"
      :style="labelStyle"
      data-drag-label
    >
      {{ tabDrag.title }}
    </div>
  </div>
</template>
