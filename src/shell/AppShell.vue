<script setup lang="ts">
import { computed, defineAsyncComponent, onUnmounted } from 'vue'
import { paletteMode } from '@/features/palette/state'
import { runCommand } from '@/workbench/commands'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { sidebarVisible } from '@/workbench/sidebar'
import WorkbenchView from '@/workbench/WorkbenchView.vue'
import { buildMenuEntries } from './menuEntries'
import SidebarFrame from './SidebarFrame.vue'
import StatusBar from './StatusBar.vue'
import TitleBar from './TitleBar.vue'

defineProps<{ platformName: string }>()

// The pickers are code the user may never need, so they load the first time one opens.
const PaletteHost = defineAsyncComponent(() => import('@/features/palette/PaletteHost.vue'))

// The menu and the shortcuts both run commands from the registry, through `runCommand`.
const removeCommands = registerDefaultCommands()
const removeKeybindings = installKeybindings(window)
onUnmounted(() => {
  removeKeybindings()
  removeCommands()
})

const menuEntries = computed(() => buildMenuEntries())

function runMenuEntry(id: string): void {
  runCommand(id).catch((error: unknown) => {
    console.error(`Menu command "${id}" failed`, error)
  })
}
</script>

<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
    <TitleBar
      :entries="menuEntries"
      @menu-select="runMenuEntry"
    />
    <div class="flex min-h-0 flex-1">
      <SidebarFrame v-if="sidebarVisible" />
      <main class="flex min-w-0 flex-1 flex-col">
        <WorkbenchView />
      </main>
    </div>
    <StatusBar :platform-name="platformName" />
    <PaletteHost
      v-if="paletteMode !== null"
      :key="paletteMode"
      :mode="paletteMode"
    />
  </div>
</template>
