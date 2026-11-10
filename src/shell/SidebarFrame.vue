<script setup lang="ts">
import { X } from '@lucide/vue'
import RewriteBanner from '@/features/links/RewriteBanner.vue'
import ReferencesPanel from '@/features/references/ReferencesPanel.vue'
import { closeReferences, referencesState } from '@/features/references/store'
import CopyBanner from '@/features/tree/CopyBanner.vue'
import FileTree from '@/features/tree/FileTree.vue'
import { workspaceRoots } from '@/features/tree/store'
import { showSidebar, sidebarPanel } from '@/workbench/sidebar'
</script>

<template>
  <aside
    aria-label="Sidebar"
    class="flex w-sidebar shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
  >
    <div
      class="flex h-tabstrip shrink-0 items-center gap-3 border-b border-sidebar-border px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase select-none"
    >
      <template v-if="referencesState !== null">
        <button
          type="button"
          data-sidebar-tab="folders"
          :aria-pressed="sidebarPanel === 'folders'"
          class="cursor-default uppercase hover:text-foreground"
          :class="sidebarPanel === 'folders' ? 'text-foreground' : ''"
          @click="showSidebar('folders')"
        >
          Folders
        </button>
        <button
          type="button"
          data-sidebar-tab="references"
          :aria-pressed="sidebarPanel === 'references'"
          class="cursor-default uppercase hover:text-foreground"
          :class="sidebarPanel === 'references' ? 'text-foreground' : ''"
          @click="showSidebar('references')"
        >
          References
        </button>
        <button
          type="button"
          aria-label="Close references"
          class="ml-auto flex size-5 cursor-default items-center justify-center rounded-sm hover:bg-accent"
          @click="closeReferences"
        >
          <X
            class="size-3.5"
            :stroke-width="1.5"
          />
        </button>
      </template>
      <template v-else>Folders</template>
    </div>
    <CopyBanner />
    <RewriteBanner />
    <ReferencesPanel v-if="sidebarPanel === 'references' && referencesState !== null" />
    <FileTree v-else-if="workspaceRoots.length > 0" />
    <div
      v-else
      class="flex flex-1 items-center justify-center p-4 text-center text-muted-foreground"
    >
      Open a folder to browse its files.
    </div>
  </aside>
</template>
