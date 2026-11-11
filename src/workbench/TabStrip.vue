<script setup lang="ts">
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
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
const { focused = true, draggingId = null } = defineProps<{
  tabs: readonly TabInfo[]
  activeId: string | null
  focused?: boolean
  draggingId?: string | null
}>()
const emit = defineEmits<{
  select: [id: string]
  close: [id: string]
  press: [id: string, event: PointerEvent]
}>()

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
    role="tablist"
    class="flex h-tabstrip shrink-0 items-stretch overflow-x-auto border-b border-border bg-tabstrip [scrollbar-color:var(--handle)_transparent] [scrollbar-width:thin] select-none"
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
</template>
