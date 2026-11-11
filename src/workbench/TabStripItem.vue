<script setup lang="ts">
import { X } from '@lucide/vue'
import HoverHint from '@/components/HoverHint.vue'
import { SLOW_HINT_DELAY } from '@/components/hintDelay'
import type { TabInfo } from './tabs'

const {
  tab,
  active,
  focused = true,
  dragging = false,
} = defineProps<{
  tab: TabInfo
  active: boolean
  focused?: boolean
  dragging?: boolean
}>()
const emit = defineEmits<{ select: []; close: []; press: [event: PointerEvent] }>()

/** Only a plain primary-button press by mouse or pen can start a drag. */
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || event.pointerType === 'touch') return
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
  emit('press', event)
}
</script>

<template>
  <div
    role="tab"
    :aria-selected="active"
    :data-tab-id="tab.id"
    class="group flex min-w-24 max-w-56 shrink-0 cursor-default items-center gap-2 border-t-2 pr-1.5 pl-3 text-chrome select-none"
    :class="[
      active
        ? [
            'bg-tab-active text-tab-active-foreground',
            focused ? 'border-primary' : 'border-muted-foreground/40',
          ]
        : 'border-transparent text-tab-foreground hover:bg-accent/40',
      dragging ? 'opacity-50' : '',
    ]"
    @pointerdown="onPointerDown"
    @mousedown.prevent
    @dragstart.prevent
    @click="emit('select')"
  >
    <!-- The hint is on the label, not on the tab, so the tab's context menu never meets it (ISC-223). -->
    <HoverHint
      :text="tab.title"
      side="bottom"
      when-truncated
      :delay-duration="SLOW_HINT_DELAY"
    >
      <span
        data-tab-label
        class="truncate"
      >
        {{ tab.title }}
      </span>
    </HoverHint>
    <span
      v-if="tab.dirty"
      data-dirty
      role="img"
      aria-label="Unsaved changes"
      class="ml-auto size-2 shrink-0 rounded-full bg-primary group-hover:hidden"
    />
    <button
      type="button"
      aria-label="Close tab"
      tabindex="-1"
      class="flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 hover:bg-accent"
      :class="[
        { 'opacity-100': active && !tab.dirty },
        tab.dirty ? 'hidden group-hover:flex' : 'ml-auto',
      ]"
      @pointerdown.stop
      @click.stop="emit('close')"
    >
      <X
        class="size-3.5"
        :stroke-width="1.5"
      />
    </button>
  </div>
</template>
