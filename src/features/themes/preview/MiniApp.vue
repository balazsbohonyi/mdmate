<script setup lang="ts">
import { File, FileText, Folder, FolderOpen, Minus, Settings, Square, X } from '@lucide/vue'
import TabStripItem from '@/workbench/TabStripItem.vue'
import type { TabInfo } from '@/workbench/tabs'
import PreviewEditor from './PreviewEditor.vue'

/**
 * A small copy of the app drawn with the app's own token classes: the title bar, the sidebar with a
 * file tree, the tab strip, the editor and the status bar. The chrome is plain markup, not the live
 * components (those read the open files, drag the window and start tab drags), and the tab strip
 * item is the real presentational one with no handler attached. Everything is inert: a click does
 * nothing. The editor in the middle is the real one (PreviewEditor).
 */

const tabs: TabInfo[] = [
  { id: 'preview-readme', kind: 'markdown', title: 'README.md', dirty: false },
  { id: 'preview-roadmap', kind: 'markdown', title: 'roadmap.md', dirty: false },
  { id: 'preview-notes', kind: 'markdown', title: 'notes.md', dirty: true },
]

interface Row {
  name: string
  depth: number
  kind: 'folder' | 'folder-closed' | 'markdown' | 'file'
  selected?: boolean
  hovered?: boolean
}

const rows: Row[] = [
  { name: 'tidewatch', depth: 0, kind: 'folder' },
  { name: 'notes', depth: 1, kind: 'folder' },
  { name: 'roadmap.md', depth: 2, kind: 'markdown', hovered: true },
  { name: 'ideas.md', depth: 2, kind: 'markdown' },
  { name: 'assets', depth: 1, kind: 'folder-closed' },
  { name: 'README.md', depth: 1, kind: 'markdown', selected: true },
  { name: 'changelog.md', depth: 1, kind: 'markdown' },
  { name: 'chart.png', depth: 1, kind: 'file' },
]
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
    data-mini-app
    aria-hidden="true"
  >
    <header
      class="flex h-titlebar shrink-0 items-stretch bg-titlebar text-titlebar-foreground select-none"
    >
      <div class="flex items-center gap-3 px-3 text-xs">
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
      </div>
      <div class="flex min-w-0 flex-1 items-center px-3">
        <span class="truncate text-xs">D:\tidewatch\README.md</span>
      </div>
      <span class="flex w-titlebar items-center justify-center text-titlebar-foreground">
        <Settings
          class="size-4"
          :stroke-width="1.5"
        />
      </span>
      <span class="flex w-11 items-center justify-center hover:bg-accent">
        <Minus
          class="size-4"
          :stroke-width="1.5"
        />
      </span>
      <span class="flex w-11 items-center justify-center">
        <Square
          class="size-3"
          :stroke-width="1.5"
        />
      </span>
      <span class="flex w-11 items-center justify-center">
        <X
          class="size-4"
          :stroke-width="1.5"
        />
      </span>
    </header>
    <div class="flex min-h-0 flex-1">
      <aside
        class="relative hidden w-44 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground @lg:flex"
        data-mini-sidebar
      >
        <div
          class="flex h-tabstrip shrink-0 items-center gap-3 border-b border-sidebar-border px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase select-none"
        >
          <span class="text-foreground">Folders</span>
          <span>Search</span>
        </div>
        <div class="min-h-0 flex-1 overflow-hidden text-chrome select-none">
          <div
            v-for="row in rows"
            :key="row.name"
            class="flex h-6 items-center gap-1 pr-2"
            :class="[
              row.selected
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : row.hovered
                  ? 'bg-sidebar-accent/50'
                  : '',
              row.kind === 'file' ? 'text-muted-foreground' : '',
              row.depth === 0 ? 'font-medium' : '',
            ]"
            :style="{ paddingLeft: `${String(row.depth * 12 + 8)}px` }"
            :data-mini-row="row.name"
          >
            <FolderOpen
              v-if="row.kind === 'folder'"
              class="size-4 shrink-0 text-muted-foreground"
              :stroke-width="1.5"
            />
            <Folder
              v-else-if="row.kind === 'folder-closed'"
              class="size-4 shrink-0 text-muted-foreground"
              :stroke-width="1.5"
            />
            <FileText
              v-else-if="row.kind === 'markdown'"
              class="size-4 shrink-0"
              :stroke-width="1.5"
            />
            <File
              v-else
              class="size-4 shrink-0 opacity-60"
              :stroke-width="1.5"
            />
            <span class="truncate">{{ row.name }}</span>
          </div>
        </div>
        <div class="absolute inset-y-0 -right-0.5 z-10 w-1 bg-handle" />
      </aside>
      <main class="flex min-w-0 flex-1 flex-col">
        <div
          class="flex h-tabstrip shrink-0 items-stretch border-b border-border bg-tabstrip select-none"
        >
          <TabStripItem
            v-for="(tab, at) in tabs"
            :key="tab.id"
            :tab="tab"
            :active="at === 0"
          />
        </div>
        <div class="min-h-0 flex-1">
          <PreviewEditor />
        </div>
      </main>
    </div>
    <footer
      class="flex h-statusbar shrink-0 items-center gap-4 bg-statusbar px-3 text-xs text-statusbar-foreground select-none"
    >
      <span>3 of 9</span>
    </footer>
  </div>
</template>
