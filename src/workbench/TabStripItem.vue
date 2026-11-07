<script setup lang="ts">
import { X } from '@lucide/vue'
import type { TabInfo } from './tabs'

const { tab, active } = defineProps<{ tab: TabInfo; active: boolean }>()
const emit = defineEmits<{ select: []; close: [] }>()
</script>

<template>
  <div
    role="tab"
    :aria-selected="active"
    :title="tab.title"
    class="group flex min-w-24 max-w-56 cursor-default items-center gap-2 border-t-2 pr-1.5 pl-3 text-chrome"
    :class="
      active
        ? 'border-primary bg-tab-active text-tab-active-foreground'
        : 'border-transparent text-tab-foreground hover:bg-accent/40'
    "
    @click="emit('select')"
  >
    <span class="truncate">{{ tab.title }}</span>
    <button
      type="button"
      aria-label="Close tab"
      tabindex="-1"
      class="ml-auto flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 hover:bg-accent"
      :class="{ 'opacity-100': active }"
      @click.stop="emit('close')"
    >
      <X
        class="size-3.5"
        :stroke-width="1.5"
      />
    </button>
  </div>
</template>
