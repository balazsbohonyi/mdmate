<script setup lang="ts">
import { PanelLeft, PanelLeftDashed, Settings } from '@lucide/vue'
import { computed } from 'vue'
import HoverHint from '@/components/HoverHint.vue'
import { runCommand, shortcutLabel } from '@/workbench/commands'
import { COMMAND_IDS } from '@/workbench/defaultCommands'
import { detectPlatform } from '@/workbench/keybinding'
import { sidebarVisible } from '@/workbench/sidebar'
import { activeFileLabel } from './activeFile'
import type { MenuEntry } from './menuEntries'
import TitleBarControls from './TitleBarControls.vue'
import TitleBarMenu from './TitleBarMenu.vue'

defineProps<{ entries: readonly MenuEntry[] }>()
const emit = defineEmits<{ menuSelect: [id: string]; menuOpen: [] }>()

/** The gear opens the same Settings tab as the shortcut and the menu (ISC-348). */
const gearHint = computed(() => {
  const shortcut = shortcutLabel(COMMAND_IDS.openSettings, detectPlatform())
  return shortcut === undefined ? 'Settings' : `Settings (${shortcut})`
})

/** The sidebar button runs the same command as the shortcut and the menu; its hint says what a click does now. */
const sidebarHint = computed(() => {
  const action = sidebarVisible.value ? 'Hide Sidebar' : 'Show Sidebar'
  const shortcut = shortcutLabel(COMMAND_IDS.toggleSidebar, detectPlatform())
  return shortcut === undefined ? action : `${action} (${shortcut})`
})

function toggleSidebarFromBar(): void {
  runCommand(COMMAND_IDS.toggleSidebar).catch((error: unknown) => {
    console.error('Toggle Sidebar failed', error)
  })
}

function openSettings(): void {
  runCommand(COMMAND_IDS.openSettings).catch((error: unknown) => {
    console.error('Open Settings failed', error)
  })
}
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
    <HoverHint
      :text="sidebarHint"
      side="bottom"
    >
      <button
        type="button"
        aria-label="Toggle Sidebar"
        :aria-pressed="sidebarVisible"
        data-sidebar-toggle
        tabindex="-1"
        class="flex w-titlebar shrink-0 items-center justify-center text-titlebar-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
        @click="toggleSidebarFromBar"
      >
        <PanelLeft
          v-if="sidebarVisible"
          class="size-4"
          :stroke-width="1.5"
        />
        <PanelLeftDashed
          v-else
          class="size-4"
          :stroke-width="1.5"
        />
      </button>
    </HoverHint>
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
    <HoverHint
      :text="gearHint"
      side="bottom"
    >
      <button
        type="button"
        aria-label="Settings"
        data-settings-gear
        tabindex="-1"
        class="flex w-titlebar shrink-0 items-center justify-center text-titlebar-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
        @click="openSettings"
      >
        <Settings
          class="size-4"
          :stroke-width="1.5"
        />
      </button>
    </HoverHint>
    <TitleBarControls />
  </header>
</template>
