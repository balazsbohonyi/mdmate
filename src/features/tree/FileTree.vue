<script setup lang="ts">
import { ChevronDown, ChevronRight, File, FileText, Folder, FolderOpen } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { FALLBACK_VIEWPORT_HEIGHT, ROW_HEIGHT, visibleWindow, type TreeRow } from './model'
import { activateRow, removeRootFolder, selectedPath, treeRows } from './store'

const scroller = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(FALLBACK_VIEWPORT_HEIGHT)
let observer: ResizeObserver | undefined

onMounted(() => {
  const element = scroller.value
  if (element === null || typeof ResizeObserver === 'undefined') return
  const measure = (): void => {
    // Nothing has a size in a test DOM; keep the fallback there.
    if (element.clientHeight > 0) viewportHeight.value = element.clientHeight
  }
  measure()
  observer = new ResizeObserver(measure)
  observer.observe(element)
})
onBeforeUnmount(() => {
  observer?.disconnect()
})

const range = computed(() =>
  visibleWindow(scrollTop.value, viewportHeight.value, treeRows.value.length),
)
const shown = computed(() =>
  treeRows.value.slice(range.value.start, range.value.end).map((row, offset) => ({
    row,
    top: (range.value.start + offset) * ROW_HEIGHT,
  })),
)

function onScroll(): void {
  scrollTop.value = scroller.value?.scrollTop ?? 0
}

/** The root a right-click landed on, whose menu is about to open. */
const menuRoot = ref<string | null>(null)

function onContextMenu(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null
  const path = target?.closest<HTMLElement>('[data-row-path]')?.dataset.rowPath
  const row = treeRows.value.find((candidate) => candidate.path === path)
  if (row?.kind !== 'root') {
    // Only a root has a menu so far. Stopping here keeps the menu from opening at all.
    event.preventDefault()
    event.stopPropagation()
    menuRoot.value = null
    return
  }
  selectedPath.value = row.path
  menuRoot.value = row.path
}

function remove(): void {
  const path = menuRoot.value
  if (path !== null) void removeRootFolder(path)
}

function indent(row: TreeRow): string {
  return `${String(row.depth * 12 + 6)}px`
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        ref="scroller"
        role="tree"
        aria-label="Workspace files"
        data-file-tree
        class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto text-chrome select-none"
        @scroll.passive="onScroll"
        @contextmenu.capture="onContextMenu"
      >
        <div
          class="relative w-full"
          :style="{ height: `${String(treeRows.length * ROW_HEIGHT)}px` }"
        >
          <div
            v-for="{ row, top } in shown"
            :key="`${row.kind}:${row.path}:${row.name}`"
            :role="row.kind === 'note' ? 'none' : 'treeitem'"
            :aria-level="row.depth + 1"
            :aria-expanded="row.kind === 'root' || row.kind === 'folder' ? row.expanded : undefined"
            :aria-selected="row.kind !== 'note' && row.path === selectedPath"
            :data-row-path="row.kind === 'note' ? undefined : row.path"
            :data-kind="row.kind"
            :title="row.kind === 'note' ? row.name : row.path"
            class="absolute right-0 left-0 flex cursor-default items-center gap-1 pr-2"
            :class="[
              row.kind !== 'note' && row.path === selectedPath
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'hover:bg-sidebar-accent/50',
              row.kind === 'file' && !row.markdown ? 'text-muted-foreground' : '',
              row.kind === 'note'
                ? row.tone === 'error'
                  ? 'text-destructive'
                  : 'text-muted-foreground'
                : '',
              row.kind === 'root' ? 'font-medium' : '',
            ]"
            :style="{
              top: `${String(top)}px`,
              height: `${String(ROW_HEIGHT)}px`,
              paddingLeft: indent(row),
            }"
            @click="activateRow(row)"
          >
            <template v-if="row.kind === 'root' || row.kind === 'folder'">
              <component
                :is="row.expanded ? ChevronDown : ChevronRight"
                class="size-3.5 shrink-0 text-muted-foreground"
                :stroke-width="1.5"
              />
              <component
                :is="row.expanded ? FolderOpen : Folder"
                class="size-4 shrink-0 text-muted-foreground"
                :stroke-width="1.5"
              />
            </template>
            <template v-else-if="row.kind === 'file'">
              <span class="size-3.5 shrink-0" />
              <component
                :is="row.markdown ? FileText : File"
                class="size-4 shrink-0"
                :class="row.markdown ? '' : 'opacity-60'"
                :stroke-width="1.5"
              />
            </template>
            <span
              v-else
              class="size-3.5 shrink-0"
            />
            <span class="truncate">{{ row.name }}</span>
          </div>
        </div>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem @select="remove">Remove Folder from Workspace</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
