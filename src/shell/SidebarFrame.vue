<script setup lang="ts">
import { X } from '@lucide/vue'
import { defineAsyncComponent, ref } from 'vue'
import RewriteBanner from '@/features/links/RewriteBanner.vue'
import ReferencesPanel from '@/features/references/ReferencesPanel.vue'
import { closeReferences, referencesState } from '@/features/references/store'
import CopyBanner from '@/features/tree/CopyBanner.vue'
import FileTree from '@/features/tree/FileTree.vue'
import { workspaceRoots } from '@/features/tree/store'
import {
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
  setSidebarWidth,
  showSidebar,
  sidebarMax,
  sidebarPanel,
  sidebarWidth,
} from '@/workbench/sidebar'

// Search loads the first time it is shown (check-arch: search-lazy), so a window that never searches
// never pays for it.
const SearchPanel = defineAsyncComponent(() => import('@/features/search/SearchPanel.vue'))
// The outline loads the first time it is shown too (check-arch: outline-lazy).
const OutlinePanel = defineAsyncComponent(() => import('@/features/outline/OutlinePanel.vue'))

const frame = ref<HTMLElement | null>(null)
const windowWidth = window.innerWidth
const STEP = 16
/** The drag in progress: where the pointer and the edge were when it began. */
let drag: { readonly x: number; readonly width: number } | null = null

const shownWidth = (): number => frame.value?.getBoundingClientRect().width ?? SIDEBAR_DEFAULT

function startDrag(event: PointerEvent): void {
  if (event.button !== 0) return
  drag = { x: event.clientX, width: shownWidth() }
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  // Stops the text selection a drag would start, which also stops the click from focusing the
  // handle; so it takes focus here, and the arrow keys then move it instead of the editor's caret.
  event.preventDefault()
  handle.focus()
}

function moveDrag(event: PointerEvent): void {
  if (drag === null) return
  setSidebarWidth(drag.width + event.clientX - drag.x, window.innerWidth)
}

function endDrag(): void {
  drag = null
}

function resetWidth(): void {
  setSidebarWidth(null, window.innerWidth)
}

function onKeydown(event: KeyboardEvent): void {
  const move = event.key === 'ArrowLeft' ? -STEP : event.key === 'ArrowRight' ? STEP : 0
  if (move === 0) return
  event.preventDefault()
  setSidebarWidth(shownWidth() + move, window.innerWidth)
}
</script>

<template>
  <aside
    ref="frame"
    aria-label="Sidebar"
    class="relative flex w-sidebar max-w-[50vw] min-w-48 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    :style="sidebarWidth === null ? undefined : { width: `${String(sidebarWidth)}px` }"
  >
    <div
      class="flex h-tabstrip shrink-0 items-center gap-3 border-b border-sidebar-border px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase select-none"
    >
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
        data-sidebar-tab="search"
        :aria-pressed="sidebarPanel === 'search'"
        class="cursor-default uppercase hover:text-foreground"
        :class="sidebarPanel === 'search' ? 'text-foreground' : ''"
        @click="showSidebar('search')"
      >
        Search
      </button>
      <button
        type="button"
        data-sidebar-tab="outline"
        :aria-pressed="sidebarPanel === 'outline'"
        class="cursor-default uppercase hover:text-foreground"
        :class="sidebarPanel === 'outline' ? 'text-foreground' : ''"
        @click="showSidebar('outline')"
      >
        Outline
      </button>
      <template v-if="referencesState !== null">
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
    </div>
    <CopyBanner />
    <RewriteBanner />
    <SearchPanel v-if="sidebarPanel === 'search'" />
    <OutlinePanel v-else-if="sidebarPanel === 'outline'" />
    <ReferencesPanel v-else-if="sidebarPanel === 'references' && referencesState !== null" />
    <FileTree v-else-if="workspaceRoots.length > 0" />
    <div
      v-else
      class="flex flex-1 items-center justify-center p-4 text-center text-muted-foreground"
    >
      Open a folder to browse its files.
    </div>
    <!-- The edge is the handle, like VS Code's: drag it, press the arrow keys on it, or double click to reset. -->
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      :aria-valuemin="SIDEBAR_MIN"
      :aria-valuemax="sidebarMax(windowWidth)"
      :aria-valuenow="sidebarWidth ?? SIDEBAR_DEFAULT"
      tabindex="0"
      data-sidebar-handle
      class="absolute inset-y-0 -right-0.5 z-10 w-1 cursor-col-resize touch-none outline-none hover:bg-ring/40 focus-visible:bg-ring/60 active:bg-ring/60"
      @pointerdown="startDrag"
      @pointermove="moveDrag"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @dblclick="resetWidth"
      @keydown="onKeydown"
    />
  </aside>
</template>
