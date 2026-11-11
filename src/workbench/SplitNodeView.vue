<script setup lang="ts">
import { computed } from 'vue'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import PaneView from './PaneView.vue'
import type { SplitNode } from './splitTree'
import { resizeSplit } from './store'

const { node, activePane } = defineProps<{ node: SplitNode; activePane: string }>()

/**
 * A group is rebuilt whenever its children change, so it always starts from the sizes in the
 * model. Resizing alone changes no key: sizes are written back when the drag ends, and the live
 * group already shows them, so nothing jumps.
 */
const groupKey = computed(() =>
  node.kind === 'split' ? `${node.id}:${node.children.map((child) => child.id).join(',')}` : '',
)

let latest: number[] = []
let dragging = false

/** True when the group reports what the model already holds, as it does once on mount. */
function sameSizes(sizes: readonly number[]): boolean {
  if (node.kind !== 'split' || sizes.length !== node.sizes.length) return false
  return sizes.every((size, index) => Math.abs(size - (node.sizes[index] ?? 0)) < 0.01)
}

function onLayout(sizes: number[]): void {
  if (node.kind !== 'split') return
  latest = sizes
  // A keyboard resize emits with no drag, so it is saved at once.
  if (!dragging && !sameSizes(sizes)) resizeSplit(node.id, sizes)
}

/**
 * The splitter listens for the press on the whole page, so the press lands on the editor next to
 * the handle, and its own focus is cancelled. The handle is focused when a drag starts instead, so
 * the arrow keys, which resize a focused handle, do not go to the editor's caret.
 */
function onDragging(isDragging: boolean, handleId: string): void {
  if (isDragging) document.getElementById(handleId)?.focus()
  dragging = isDragging
  if (!isDragging && node.kind === 'split') resizeSplit(node.id, latest)
}
</script>

<template>
  <PaneView
    v-if="node.kind === 'pane'"
    :pane="node"
    :active="node.id === activePane"
  />
  <ResizablePanelGroup
    v-else
    :id="node.id"
    :key="groupKey"
    :direction="node.direction === 'row' ? 'horizontal' : 'vertical'"
    @layout="onLayout"
  >
    <template
      v-for="(child, index) in node.children"
      :key="child.id"
    >
      <ResizableHandle
        v-if="index > 0"
        :id="`${node.id}-handle-${index}`"
        class="after:min-w-1.5 hover:bg-handle-active data-[state=drag]:bg-handle-active"
        @dragging="(isDragging: boolean) => onDragging(isDragging, `${node.id}-handle-${index}`)"
      />
      <ResizablePanel
        :id="child.id"
        :order="index"
        :default-size="node.sizes[index] ?? 50"
        :min-size="6"
        class="min-h-0 min-w-0"
      >
        <SplitNodeView
          :node="child"
          :active-pane="activePane"
        />
      </ResizablePanel>
    </template>
  </ResizablePanelGroup>
</template>
