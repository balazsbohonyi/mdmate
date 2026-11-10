<script setup lang="ts">
import RewriteBanner from '@/features/links/RewriteBanner.vue'
import CopyBanner from '@/features/tree/CopyBanner.vue'
import FileTree from '@/features/tree/FileTree.vue'
import { workspaceRoots } from '@/features/tree/store'
</script>

<template>
  <aside
    aria-label="Sidebar"
    class="flex w-sidebar shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
  >
    <div
      class="flex h-tabstrip shrink-0 items-center border-b border-sidebar-border px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase select-none"
    >
      Folders
    </div>
    <CopyBanner />
    <RewriteBanner />
    <FileTree v-if="workspaceRoots.length > 0" />
    <div
      v-else
      class="flex flex-1 items-center justify-center p-4 text-center text-muted-foreground"
    >
      Open a folder to browse its files.
    </div>
  </aside>
</template>
