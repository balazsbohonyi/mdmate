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
    :data-pane-focused="focused"
    class="group relative flex min-w-24 max-w-56 shrink-0 cursor-default items-center gap-2 rounded-t-md pr-1.5 pl-3 text-chrome select-none"
    :class="[
      active
        ? 'bg-tab-active text-tab-active-foreground'
        : [
            'bg-tab-inactive text-tab-foreground hover:bg-accent/40',
            // A line on the left edge between two tabs that are not active. None before the first
            // tab or next to the active one, and none beside the tab the pointer is on.
            `before:absolute before:inset-y-2 before:left-0 before:w-px before:bg-tab-separator before:content-['']`,
            'first:before:hidden [[aria-selected=true]+&]:before:hidden',
            'hover:before:opacity-0 [:hover+&]:before:opacity-0',
          ],
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
    <!--
      One 20 px slot holds both the unsaved dot and the close button, so the dot sits exactly where
      the X appears and the label never changes width when the pointer enters the tab (ISC-250).
    -->
    <span
      data-tab-slot
      class="ml-auto grid size-5 shrink-0 place-items-center"
    >
      <span
        v-if="tab.dirty"
        data-dirty
        role="img"
        aria-label="Unsaved changes"
        class="size-2 rounded-full bg-primary group-hover:hidden"
      />
      <button
        type="button"
        aria-label="Close tab"
        tabindex="-1"
        class="flex size-5 items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground"
        :class="[
          { 'opacity-100': active && !tab.dirty },
          tab.dirty ? 'hidden group-hover:flex' : '',
        ]"
        @pointerdown.stop
        @click.stop="emit('close')"
      >
        <X
          class="size-3.5"
          :stroke-width="1.5"
        />
      </button>
    </span>
  </div>
</template>
