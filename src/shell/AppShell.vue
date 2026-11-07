<script setup lang="ts">
import { getHost } from '@/platform'
import { seedDemoWorkbench } from '@/workbench/devSeed'
import { sidebarVisible, toggleSidebar } from '@/workbench/sidebar'
import WorkbenchView from '@/workbench/WorkbenchView.vue'
import type { MenuEntry } from './menuEntries'
import SidebarFrame from './SidebarFrame.vue'
import StatusBar from './StatusBar.vue'
import TitleBar from './TitleBar.vue'

defineProps<{ platformName: string }>()

const menuEntries: readonly MenuEntry[] = [
  { kind: 'item', id: 'toggle-sidebar', label: 'Toggle Sidebar' },
  { kind: 'separator' },
  { kind: 'item', id: 'exit', label: 'Exit' },
]

// A layout to try splitting and dragging on, until Phase 2 opens real files. The branch is removed
// from release builds, which start with one empty pane.
if (import.meta.env.DEV) seedDemoWorkbench()

async function runMenuEntry(id: string): Promise<void> {
  if (id === 'toggle-sidebar') toggleSidebar()
  else if (id === 'exit') await (await getHost()).windowControls.close()
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
  </div>
</template>
