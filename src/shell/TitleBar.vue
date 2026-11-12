<script setup lang="ts">
import { activeFileLabel } from './activeFile'
import type { MenuEntry } from './menuEntries'
import TitleBarControls from './TitleBarControls.vue'
import TitleBarMenu from './TitleBarMenu.vue'

defineProps<{ entries: readonly MenuEntry[] }>()
const emit = defineEmits<{ menuSelect: [id: string]; menuOpen: [] }>()
</script>

<template>
  <header
    class="flex h-titlebar shrink-0 items-stretch bg-titlebar text-titlebar-foreground select-none"
  >
    <TitleBarMenu
      :entries="entries"
      @select="emit('menuSelect', $event)"
      @open="emit('menuOpen')"
    />
    <!-- Only an element that carries the attribute starts a window drag, so the label ignores the pointer. -->
    <div
      data-tauri-drag-region
      class="flex min-w-0 flex-1 items-center justify-start px-3"
    >
      <span
        class="pointer-events-none truncate text-xs"
        data-title-file
      >
        {{ activeFileLabel }}
      </span>
    </div>
    <TitleBarControls />
  </header>
</template>
