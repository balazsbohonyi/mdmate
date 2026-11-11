<script setup lang="ts">
import { Check, ChevronDown, Plus } from '@lucide/vue'
import { nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import HoverHint from '@/components/HoverHint.vue'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shortcutLabel } from './commands'
import { COMMAND_IDS } from './defaultCommands'
import { detectPlatform } from './keybinding'
import TabStripItem from './TabStripItem.vue'
import {
  closeEveryTab,
  closeOtherTabs,
  closeTab,
  copyTabPath,
  copyTabRelativePath,
  findTabReferences,
  keepNameBoxFocus,
  renameTab,
  OPEN_CONTAINING_FOLDER,
  revealTabInExplorer,
  revealTabInSidebar,
  tabMenuState,
} from './tabMenu'
import type { TabInfo } from './tabs'

/** `focused` is true when this strip's pane is the active pane; `draggingId` is the tab being dragged. */
const {
  tabs,
  activeId,
  focused = true,
  draggingId = null,
} = defineProps<{
  tabs: readonly TabInfo[]
  activeId: string | null
  focused?: boolean
  draggingId?: string | null
}>()
const emit = defineEmits<{
  select: [id: string]
  close: [id: string]
  press: [id: string, event: PointerEvent]
  /** The + button: a new file in this pane. */
  new: []
}>()

const scroller = useTemplateRef<HTMLElement>('scroller')

/**
 * Scrolls the strip just far enough to show a tab, with no effect on any other scroller (a plain
 * `scrollIntoView` would move every ancestor too).
 */
function showTab(id: string): void {
  const strip = scroller.value
  const tab = [...(strip?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])].find(
    (element) => element.dataset.tabId === id,
  )
  if (!strip || !tab) return
  const bar = strip.getBoundingClientRect()
  const box = tab.getBoundingClientRect()
  if (box.left < bar.left) strip.scrollLeft += box.left - bar.left
  else if (box.right > bar.right) strip.scrollLeft += box.right - bar.right
}

/** The active tab is brought into view when it changes, and when a tab is added or removed. */
watch(
  () => [activeId, tabs.length] as const,
  async () => {
    await nextTick()
    if (activeId !== null) showTab(activeId)
  },
  { flush: 'post' },
)

/** A mouse wheel turns the strip sideways, as a mouse has no horizontal wheel. */
function onWheel(event: WheelEvent): void {
  const strip = scroller.value
  if (!strip || event.ctrlKey || strip.scrollWidth <= strip.clientWidth) return
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
  event.preventDefault()
  strip.scrollLeft += event.deltaY
}

onMounted(() => {
  // Not through `@wheel`: a listener Vue adds is passive, and a passive one cannot cancel the scroll.
  scroller.value?.addEventListener('wheel', onWheel, { passive: false })
  if (activeId !== null) showTab(activeId)
})
onBeforeUnmount(() => {
  scroller.value?.removeEventListener('wheel', onWheel)
})

const platform = detectPlatform()
const shortcut = (id: string): string | undefined => shortcutLabel(id, platform)

/** Each menu item runs for the tab that was right-clicked. A failure shows in the status bar. */
function run(action: () => Promise<unknown> | void): void {
  void Promise.resolve(action()).catch((error: unknown) => {
    console.error('Tab menu command failed', error)
  })
}
</script>

<template>
  <div
    data-tab-strip
    class="flex h-tabstrip shrink-0 items-stretch border-b border-border bg-tabstrip select-none"
  >
    <div
      ref="scroller"
      role="tablist"
      class="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ContextMenu
        v-for="tab in tabs"
        :key="tab.id"
      >
        <ContextMenuTrigger as-child>
          <TabStripItem
            :tab="tab"
            :active="tab.id === activeId"
            :focused="focused"
            :dragging="tab.id === draggingId"
            @select="emit('select', tab.id)"
            @close="emit('close', tab.id)"
            @press="(event) => emit('press', tab.id, event)"
          />
        </ContextMenuTrigger>
        <ContextMenuContent
          data-tab-menu
          @close-auto-focus="keepNameBoxFocus"
        >
          <ContextMenuItem @select="run(() => closeTab(tab.id))">
            Close
            <ContextMenuShortcut>{{ shortcut(COMMAND_IDS.closeTab) }}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            :disabled="!tabMenuState(tab.id).canCloseOthers"
            @select="run(() => closeOtherTabs(tab.id))"
          >
            Close Others
          </ContextMenuItem>
          <ContextMenuItem @select="run(closeEveryTab)">
            Close All
            <ContextMenuShortcut>{{ shortcut(COMMAND_IDS.closeAll) }}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            :disabled="!tabMenuState(tab.id).hasPath"
            @select="run(() => copyTabPath(tab.id))"
          >
            Copy Path
          </ContextMenuItem>
          <ContextMenuItem
            :disabled="!tabMenuState(tab.id).hasPath"
            @select="run(() => copyTabRelativePath(tab.id))"
          >
            Copy Relative Path
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            :disabled="!tabMenuState(tab.id).hasPath"
            @select="run(() => revealTabInExplorer(tab.id))"
          >
            {{ OPEN_CONTAINING_FOLDER }}
          </ContextMenuItem>
          <ContextMenuItem
            :disabled="!tabMenuState(tab.id).canRevealInSidebar"
            @select="run(() => revealTabInSidebar(tab.id))"
          >
            Reveal in Sidebar
          </ContextMenuItem>
          <ContextMenuSeparator />
          <!-- A disabled item takes no pointer events, so the tooltip sits on a wrapper. -->
          <Tooltip :disabled="tabMenuState(tab.id).renameWhyNot === null">
            <TooltipTrigger as-child>
              <div data-rename-item>
                <ContextMenuItem
                  :disabled="!tabMenuState(tab.id).canRename"
                  @select="run(() => renameTab(tab.id))"
                >
                  Rename...
                  <ContextMenuShortcut>{{ shortcut(COMMAND_IDS.rename) }}</ContextMenuShortcut>
                </ContextMenuItem>
              </div>
            </TooltipTrigger>
            <TooltipContent
              data-rename-why
              side="right"
            >
              {{ tabMenuState(tab.id).renameWhyNot }}
            </TooltipContent>
          </Tooltip>
          <ContextMenuItem
            :disabled="!tabMenuState(tab.id).hasPath"
            @select="run(() => findTabReferences(tab.id))"
          >
            Find File References
            <ContextMenuShortcut>{{ shortcut(COMMAND_IDS.findReferences) }}</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
    <div
      data-tab-actions
      class="flex shrink-0 items-center gap-0.5 px-1"
    >
      <HoverHint
        text="New File"
        side="bottom"
      >
        <button
          type="button"
          aria-label="New file"
          data-new-tab
          tabindex="-1"
          class="flex size-6 items-center justify-center rounded-sm text-tab-foreground hover:bg-accent hover:text-foreground"
          @click="emit('new')"
        >
          <Plus class="size-4" />
        </button>
      </HoverHint>
      <!--
        The hint is on a wrapper around the whole menu. A tooltip and a menu each anchor to the
        nearest popper root, so a trigger inside a tooltip's trigger leaves the menu with no anchor
        and it never leaves the corner of the window.
      -->
      <HoverHint
        text="Open Tabs"
        side="bottom"
      >
        <span class="flex">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                aria-label="Open tabs"
                data-tab-list
                tabindex="-1"
                class="flex size-6 items-center justify-center rounded-sm text-tab-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
              >
                <ChevronDown class="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              class="w-auto max-w-96 min-w-56"
              data-tab-list-menu
            >
              <DropdownMenuItem
                v-for="tab in tabs"
                :key="tab.id"
                class="whitespace-nowrap"
                :data-tab-list-item="tab.id"
                @select="emit('select', tab.id)"
              >
                <Check
                  class="size-4 shrink-0"
                  :class="tab.id === activeId ? 'opacity-100' : 'opacity-0'"
                />
                <span class="truncate">{{ tab.title }}</span>
                <span
                  v-if="tab.dirty"
                  role="img"
                  aria-label="Unsaved changes"
                  class="ml-auto size-2 shrink-0 rounded-full bg-primary"
                />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </HoverHint>
    </div>
  </div>
</template>
