<script setup lang="ts">
import { ChevronDown, ChevronRight, File, FileText, Folder, FolderOpen } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { findFileReferences } from '@/features/references/store'
import HoverHint from '@/components/HoverHint.vue'
import { SLOW_HINT_DELAY } from '@/components/hintDelay'
import { shortcutLabel } from '@/workbench/commands'
import { COMMAND_IDS } from '@/workbench/defaultCommands'
import { detectPlatform } from '@/workbench/keybinding'
import {
  OPEN_CONTAINING_FOLDER,
  OPEN_FOLDER,
  copyPath,
  copyRelativePath,
} from '@/workbench/tabMenu'
import { setDragCursor } from './dragCursor'
import NameInput from './NameInput.vue'
import {
  FALLBACK_VIEWPORT_HEIGHT,
  ROW_HEIGHT,
  TREE_KEYS,
  isSelectable,
  keyAction,
  rowDomId,
  visibleWindow,
  type TreeRow,
} from './model'
import {
  commitNaming,
  requestDelete,
  deleteSelected,
  moveProblem,
  moveRow,
  newFileIn,
  newFolderIn,
  openFolderInFileManager,
  renameRow,
  renameSelected,
  revealInFileManager,
  TREE_DELETE_KEY,
} from './ops'
import {
  activateRow,
  cancelNaming,
  naming,
  removeRootFolder,
  samePath,
  scrollRequest,
  requestScroll,
  selectedPath,
  takeTreeFocusRequest,
  toggleFolder,
  treeFocusRequest,
  treeRows,
  type TreeFocusRequest,
} from './store'

const platform = detectPlatform()
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
// A request made while the tree was not drawn (Focus Sidebar with the sidebar hidden) is met here.
onMounted(() => {
  applyFocusRequest(takeTreeFocusRequest())
})
onBeforeUnmount(() => {
  observer?.disconnect()
  stopDrag()
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

// ---- bringing a row into view ----

/** Scrolls just far enough for the requested row to show, after the rows have been laid out. */
watch(scrollRequest, async (request) => {
  if (request === null) return
  await nextTick()
  const element = scroller.value
  const index = treeRows.value.findIndex((row) =>
    request.kind === 'new'
      ? row.kind === 'new' && samePath(row.path, request.path)
      : row.kind !== 'note' && row.kind !== 'new' && samePath(row.path, request.path),
  )
  if (element === null || index === -1) return
  const top = index * ROW_HEIGHT
  const height = element.clientHeight > 0 ? element.clientHeight : viewportHeight.value
  let next = element.scrollTop
  if (top < next) next = top
  else if (top + ROW_HEIGHT > next + height) next = top + ROW_HEIGHT - height
  if (next !== element.scrollTop) element.scrollTop = next
  scrollTop.value = next
})

// ---- the context menu ----

/** The row a right-click landed on, whose menu is about to open. */
const menuRow = ref<TreeRow | null>(null)

function rowAt(target: EventTarget | null): TreeRow | undefined {
  const element = target instanceof Element ? target : null
  const path = element?.closest<HTMLElement>('[data-row-path]')?.dataset.rowPath
  return treeRows.value.find(
    (candidate) => candidate.kind !== 'note' && candidate.kind !== 'new' && candidate.path === path,
  )
}

function onContextMenu(event: MouseEvent): void {
  const row = rowAt(event.target)
  if (row === undefined || naming.value !== null) {
    // Stopping here keeps the menu from opening at all.
    event.preventDefault()
    event.stopPropagation()
    menuRow.value = null
    return
  }
  selectedPath.value = row.path
  menuRow.value = row
}

const isFolderRow = computed(
  () => menuRow.value?.kind === 'root' || menuRow.value?.kind === 'folder',
)

function menuPath(): string | null {
  const row = menuRow.value
  return row === null || row.kind === 'note' || row.kind === 'new' ? null : row.path
}

function menuNewFile(): void {
  const path = menuPath()
  if (path !== null) void newFileIn(path)
}
function menuNewFolder(): void {
  const path = menuPath()
  if (path !== null) void newFolderIn(path)
}
function menuRename(): void {
  const path = menuPath()
  if (path !== null) void renameRow(path)
}
function menuDelete(): void {
  const path = menuPath()
  if (path !== null) void requestDelete(path)
}
function menuReveal(): void {
  const path = menuPath()
  if (path === null) return
  // A folder opens itself; a file is shown, selected, in the folder that holds it.
  void (isFolderRow.value ? openFolderInFileManager(path) : revealInFileManager(path))
}
function menuCopyPath(): void {
  const path = menuPath()
  if (path !== null) void copyPath(path)
}
function menuCopyRelativePath(): void {
  const path = menuPath()
  if (path !== null) void copyRelativePath(path)
}
function menuFindReferences(): void {
  const path = menuPath()
  if (path !== null) void findFileReferences(path)
}
function remove(): void {
  const path = menuPath()
  if (path !== null) void removeRootFolder(path)
}

/**
 * Where focus goes when the menu has closed. The menu holds focus until it is gone, so a name box
 * that opened from it asks again here; with no box, the tree takes it back so F2 and Delete work.
 */
function onMenuClosed(event: Event): void {
  event.preventDefault()
  const box = scroller.value?.querySelector<HTMLElement>('[data-name-input]')
  ;(box ?? scroller.value)?.focus()
}

// ---- the keyboard ----

/**
 * Moves keyboard focus to the tree when it was asked to: always for `force`, otherwise only when
 * focus was lost to the page (a name box or a dialog that closed), never from something that has it.
 * Focus Sidebar also selects the first row when nothing is selected, so the arrow keys have a place.
 */
function applyFocusRequest(request: TreeFocusRequest | null): void {
  if (request === null) return
  void nextTick(() => {
    const element = scroller.value
    if (element === null) return
    const active = document.activeElement
    if (!request.force && active !== null && active !== document.body) return
    element.focus()
    if (request.force && selectedPath.value === null) {
      const first = treeRows.value.find(isSelectable)
      if (first !== undefined) selectedPath.value = first.path
    }
  })
}
watch(treeFocusRequest, () => {
  applyFocusRequest(takeTreeFocusRequest())
})

function onKeydown(event: KeyboardEvent): void {
  // The box a name is typed in handles its own keys.
  if (naming.value !== null || event.target !== scroller.value) return
  // A key with Ctrl, Alt or Meta is a shortcut of the app (history, headings, save...) and passes.
  if (event.ctrlKey || event.altKey || event.metaKey) return
  if (!event.shiftKey && TREE_KEYS.includes(event.key)) {
    // Space and the arrows would scroll the list; the tree moves the selection itself.
    event.preventDefault()
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) return
    runKeyAction(keyAction(treeRows.value, selectedPath.value, event.key))
    return
  }
  if (event.key === 'F2') {
    event.preventDefault()
    void renameSelected()
  } else if (event.key === TREE_DELETE_KEY) {
    event.preventDefault()
    void deleteSelected()
  }
}

function runKeyAction(action: ReturnType<typeof keyAction>): void {
  if (action === null) return
  if (action.kind === 'select') {
    selectedPath.value = action.path
    requestScroll(action.path)
  } else if (action.kind === 'toggle') {
    void toggleFolder(action.path)
  } else {
    const row = treeRows.value.find(
      (candidate) => isSelectable(candidate) && candidate.path === action.path,
    )
    if (row !== undefined) void activateRow(row, { focusEditor: action.focusEditor })
  }
}

// ---- moving a row by dragging it ----

/** Pixels the pointer must travel before a press becomes a drag, so a click never moves a file. */
const DRAG_THRESHOLD = 5

const draggedPath = ref<string | null>(null)
/** The folder the dragged row would land in, or null when the pointer is somewhere it cannot. */
const dropFolder = ref<string | null>(null)
let press: { path: string; x: number; y: number } | undefined
let swallowClick = false

function folderAt(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-row-path]')
  const path = element?.dataset.rowPath
  if (element === null || element === undefined || path === undefined) return null
  if (element.dataset.kind === 'file') {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    return cut <= 0 ? null : path.slice(0, cut)
  }
  return path
}

function onPointerDown(event: PointerEvent, row: TreeRow): void {
  if (event.button !== 0 || naming.value !== null) return
  if (row.kind !== 'file' && row.kind !== 'folder') return
  press = { path: row.path, x: event.clientX, y: event.clientY }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('keydown', onDragKey, true)
}

function onPointerMove(event: PointerEvent): void {
  if (press === undefined) return
  if (draggedPath.value === null) {
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD) return
    draggedPath.value = press.path
  }
  const folder = folderAt(event.clientX, event.clientY)
  dropFolder.value = folder !== null && moveProblem(press.path, folder) === null ? folder : null
  setDragCursor(dropFolder.value === null ? 'blocked' : 'move')
}

function onPointerUp(): void {
  const [path, folder] = [press?.path, dropFolder.value]
  const wasDragging = draggedPath.value !== null
  stopDrag()
  if (!wasDragging) return
  // The click that ends a drag lands on the row under the pointer and must not open it.
  swallowClick = true
  setTimeout(() => {
    swallowClick = false
  }, 0)
  if (path !== undefined && folder !== null) void moveRow(path, folder)
}

function onDragKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  stopDrag()
}

function stopDrag(): void {
  press = undefined
  draggedPath.value = null
  dropFolder.value = null
  setDragCursor(null)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('keydown', onDragKey, true)
}

function onRowClick(event: MouseEvent, row: TreeRow): void {
  if (swallowClick) return
  // The second click of a double click: the first one already did its work (a folder toggled once,
  // a file shown), and a double click on a file is the dblclick below.
  if (event.detail >= 2) return
  void activateRow(row)
}

/** A double click on a file shows it and puts the caret in it, like Enter. */
function onRowDoubleClick(row: TreeRow): void {
  if (row.kind === 'file') void activateRow(row, { focusEditor: true })
}

// ---- drawing ----

function indent(row: TreeRow): string {
  return `${String(row.depth * 12 + 6)}px`
}

function isRenaming(row: TreeRow): boolean {
  const typing = naming.value
  return (
    typing?.kind === 'rename' &&
    row.kind !== 'note' &&
    row.kind !== 'new' &&
    samePath(typing.path, row.path)
  )
}

function isDropTarget(row: TreeRow): boolean {
  return (
    (row.kind === 'root' || row.kind === 'folder') &&
    dropFolder.value !== null &&
    samePath(row.path, dropFolder.value)
  )
}

function isDragged(row: TreeRow): boolean {
  return row.kind !== 'note' && row.kind !== 'new' && row.path === draggedPath.value
}

function rowKey(row: TreeRow): string {
  return `${row.kind}:${row.path}:${row.name}`
}

/** The tooltip of a row: its path (a note shows its text). Nothing while the row is a name box. */
function rowHint(row: TreeRow): string | null {
  if (row.kind === 'new' || isRenaming(row)) return null
  return row.kind === 'note' ? row.name : row.path
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
        tabindex="0"
        :aria-activedescendant="selectedPath === null ? undefined : rowDomId(selectedPath)"
        class="group/tree min-h-0 flex-1 overflow-x-hidden overflow-y-auto text-chrome outline-none select-none"
        @scroll.passive="onScroll"
        @contextmenu.capture="onContextMenu"
        @keydown="onKeydown"
      >
        <div
          class="relative w-full"
          :style="{ height: `${String(treeRows.length * ROW_HEIGHT)}px` }"
        >
          <HoverHint
            v-for="{ row, top } in shown"
            :key="rowKey(row)"
            :text="rowHint(row)"
            side="right"
            :delay-duration="SLOW_HINT_DELAY"
          >
            <div
              :id="row.kind === 'note' || row.kind === 'new' ? undefined : rowDomId(row.path)"
              :role="row.kind === 'note' || row.kind === 'new' ? 'none' : 'treeitem'"
              :aria-level="row.depth + 1"
              :aria-expanded="
                row.kind === 'root' || row.kind === 'folder' ? row.expanded : undefined
              "
              :aria-selected="
                row.kind !== 'note' && row.kind !== 'new' && row.path === selectedPath
              "
              :data-row-path="row.kind === 'note' || row.kind === 'new' ? undefined : row.path"
              :data-kind="row.kind"
              :data-drop-target="isDropTarget(row) ? '' : undefined"
              :data-dragging="isDragged(row) ? '' : undefined"
              class="absolute right-0 left-0 flex cursor-default items-center gap-1 pr-2"
              :class="[
                row.kind !== 'note' && row.kind !== 'new' && row.path === selectedPath
                  ? 'bg-sidebar-accent/60 text-sidebar-accent-foreground group-focus-within/tree:bg-sidebar-accent'
                  : 'hover:bg-sidebar-accent/50',
                isDropTarget(row) ? 'bg-sidebar-accent ring-1 ring-ring ring-inset' : '',
                isDragged(row) ? 'opacity-50' : '',
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
              @pointerdown="onPointerDown($event, row)"
              @click="onRowClick($event, row)"
              @dblclick="onRowDoubleClick(row)"
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
              <template v-else-if="row.kind === 'new'">
                <span class="size-3.5 shrink-0" />
                <component
                  :is="row.creates === 'folder' ? Folder : FileText"
                  class="size-4 shrink-0 text-muted-foreground"
                  :stroke-width="1.5"
                />
              </template>
              <span
                v-else
                class="size-3.5 shrink-0"
              />
              <NameInput
                v-if="row.kind === 'new'"
                :initial="''"
                :stem="false"
                :error="naming?.error ?? null"
                :label="row.creates === 'folder' ? 'New folder name' : 'New file name'"
                @commit="commitNaming"
                @cancel="cancelNaming"
              />
              <NameInput
                v-else-if="isRenaming(row)"
                :initial="row.name"
                :stem="row.kind === 'file'"
                :error="naming?.error ?? null"
                :label="`Rename ${row.name}`"
                @commit="commitNaming"
                @cancel="cancelNaming"
              />
              <span
                v-else
                class="truncate"
                >{{ row.name }}</span
              >
            </div>
          </HoverHint>
        </div>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent @close-auto-focus="onMenuClosed">
      <template v-if="isFolderRow">
        <ContextMenuItem @select="menuNewFile">New File</ContextMenuItem>
        <ContextMenuItem @select="menuNewFolder">New Folder</ContextMenuItem>
        <ContextMenuSeparator />
      </template>
      <template v-if="menuRow?.kind !== 'root'">
        <ContextMenuItem @select="menuRename">
          Rename...
          <ContextMenuShortcut>{{
            shortcutLabel(COMMAND_IDS.rename, platform)
          }}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem @select="menuDelete">
          Delete
          <ContextMenuShortcut>{{ TREE_DELETE_KEY }}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
      </template>
      <ContextMenuItem @select="menuCopyPath">Copy Path</ContextMenuItem>
      <template v-if="menuRow?.kind !== 'root'">
        <ContextMenuItem @select="menuCopyRelativePath">Copy Relative Path</ContextMenuItem>
      </template>
      <ContextMenuSeparator />
      <ContextMenuItem @select="menuReveal">{{
        isFolderRow ? OPEN_FOLDER : OPEN_CONTAINING_FOLDER
      }}</ContextMenuItem>
      <ContextMenuItem
        v-if="menuRow?.kind === 'file'"
        @select="menuFindReferences"
      >
        Find File References
        <ContextMenuShortcut>{{
          shortcutLabel(COMMAND_IDS.findReferences, platform)
        }}</ContextMenuShortcut>
      </ContextMenuItem>
      <template v-if="menuRow?.kind === 'root'">
        <ContextMenuSeparator />
        <ContextMenuItem @select="remove">Remove Folder from Workspace</ContextMenuItem>
      </template>
    </ContextMenuContent>
  </ContextMenu>
</template>
