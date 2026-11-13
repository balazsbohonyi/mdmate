<script setup lang="ts">
import { computed, defineAsyncComponent, onUnmounted, watch } from 'vue'
import { refreshRecent } from '@/documents/recent'
import { activeDocument, refreshMissing } from '@/documents/store'
import { Toaster } from '@/components/ui/sonner'
import { paletteMode } from '@/features/palette/state'
import DeleteDialog from '@/features/tree/DeleteDialog.vue'
import { runCommand } from '@/workbench/commands'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { activeTabId } from '@/workbench/tabMenu'
import { sidebarVisible } from '@/workbench/sidebar'
import WorkbenchView from '@/workbench/WorkbenchView.vue'
import { buildMenuEntries, findMenuItem } from './menuEntries'
import SidebarFrame from './SidebarFrame.vue'
import StatusBar from './StatusBar.vue'
import TitleBar from './TitleBar.vue'
import { dismissAllToasts } from './toasts'

// The pickers are code the user may never need, so they load the first time one opens.
const PaletteHost = defineAsyncComponent(() => import('@/features/palette/PaletteHost.vue'))

// The menu and the shortcuts both run commands from the registry, through `runCommand`.
const removeCommands = registerDefaultCommands()
const removeKeybindings = installKeybindings(window)
onUnmounted(() => {
  removeKeybindings()
  removeCommands()
})

// A toast is about what the user just tried, so it goes when they move to another tab: a tab
// switch, another pane taking the focus, or the tab closing all change the active tab.
watch(() => activeTabId(), dismissAllToasts)

const menuEntries = computed(() => buildMenuEntries())

function runMenuEntry(id: string): void {
  // A recent file or folder runs its own action; everything else is a command.
  const own = findMenuItem(menuEntries.value, id)?.run
  const done = own === undefined ? runCommand(id) : own()
  done.catch((error: unknown) => {
    console.error(`Menu command "${id}" failed`, error)
  })
}

/** Opening the menu is the moment to look again at what it shows: recent files, and a file that may be gone. */
function menuOpened(): void {
  void refreshRecent()
  const doc = activeDocument()
  if (doc !== undefined) void refreshMissing(doc.id)
}
</script>

<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
    <TitleBar
      :entries="menuEntries"
      @menu-select="runMenuEntry"
      @menu-open="menuOpened"
    />
    <div class="flex min-h-0 flex-1">
      <SidebarFrame v-if="sidebarVisible" />
      <main class="flex min-w-0 flex-1 flex-col">
        <WorkbenchView />
      </main>
    </div>
    <StatusBar />
    <PaletteHost
      v-if="paletteMode !== null"
      :key="paletteMode"
      :mode="paletteMode"
    />
    <DeleteDialog />
    <Toaster
      position="bottom-right"
      expand
      close-button
      close-button-position="top-right"
      :visible-toasts="4"
    />
  </div>
</template>
