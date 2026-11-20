<script setup lang="ts">
import { Pin, PinOff, X } from '@lucide/vue'
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
const emit = defineEmits<{
  select: []
  close: []
  /** The pin icon of a pinned tab was clicked. */
  unpin: []
  press: [event: PointerEvent]
}>()

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
    :data-tab-pinned="tab.pinned === true"
    class="group relative flex min-w-24 max-w-56 shrink-0 cursor-default items-center gap-2 rounded-t-md pr-1.5 pl-3 text-chrome select-none"
    :class="[
      active
        ? 'bg-tab-active text-tab-active-foreground'
        : [
            'text-tab-foreground hover:bg-accent hover:text-accent-foreground',
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
      <!--
        A pinned tab has the pin here and no close button. A click on the pin unpins the tab, also
        when it has unsaved changes; the dot sits on the pin's corner and gives way to the unpin
        icon while the pointer is on the pin, to show that a click unpins.
      -->
      <button
        v-if="tab.pinned === true"
        type="button"
        aria-label="Unpin tab"
        data-tab-pin
        tabindex="-1"
        class="group/pin relative flex size-5 items-center justify-center rounded-sm hover:bg-accent hover:text-accent-foreground"
        @pointerdown.stop
        @click.stop="emit('unpin')"
      >
        <Pin
          class="size-3.5 group-hover/pin:hidden"
          :stroke-width="1.5"
        />
        <PinOff
          class="hidden size-3.5 group-hover/pin:block"
          :stroke-width="1.5"
        />
        <span
          v-if="tab.dirty"
          data-dirty
          role="img"
          aria-label="Unsaved changes"
          class="absolute right-0 bottom-0 size-1.5 rounded-full bg-primary group-hover/pin:hidden"
        />
      </button>
      <template v-else>
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
      </template>
    </span>
  </div>
</template>
