<script setup lang="ts">
import { getHost } from '@/platform'
import { sidebarVisible, toggleSidebar } from '@/workbench/sidebar'
import type { TabInfo } from '@/workbench/tabs'
import TabStrip from '@/workbench/TabStrip.vue'
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

// A stand-in until P1-T4 renders real panes from the split tree.
const placeholderTabs: readonly TabInfo[] = [{ id: 'welcome', title: 'Welcome' }]

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
        <TabStrip
          :tabs="placeholderTabs"
          active-id="welcome"
        />
        <div class="flex flex-1 items-center justify-center text-muted-foreground">
          Open a file to start writing.
        </div>
      </main>
    </div>
    <StatusBar :platform-name="platformName" />
  </div>
</template>
