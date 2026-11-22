<script setup lang="ts">
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from '@lucide/vue'
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
import { findInFolder } from '@/features/search/store'
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
import FileIcon from './FileIcon.vue'
import { gitLook } from './gitStore'
import NameInput from './NameInput.vue'
import {
  FALLBACK_VIEWPORT_HEIGHT,
  ROW_HEIGHT,
  TREE_KEYS,
  isSelectable,
  keyAction,
  rowDomId,
  visibleWindow,
  type Place,
  type TreeRow,
} from './model'
import {
  commitNaming,
  requestDelete,
  deleteSelected,
  moveProblem,
  moveRow,
  dragOutOfWindow,
  moveRows,
  newFileIn,
  newFolderIn,
  openFolderInFileManager,
  renameRow,
  renameSelected,
  revealInFileManager,
  selectedTargets,
  TREE_DELETE_KEY,
} from './ops'
import {
  activateRow,
  cancelNaming,
  collapseSelection,
  isSelectedPlace,
  naming,
  removeRootFolder,
  samePath,
  scrollRequest,
  requestScroll,
  select,
  selectedPath,
  selectedPlaces,
  selectedRoot,
  selectRangeTo,
  takeTreeFocusRequest,
  toggleFolder,
  toggleSelected,
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
  const index = treeRows.value.findIndex(
    (row) =>
      (request.root === undefined || row.root === request.root) &&
      (request.kind === 'new'
        ? row.kind === 'new' && samePath(row.path, request.path)
        : row.kind !== 'note' && row.kind !== 'new' && samePath(row.path, request.path)),
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
  const { rowPath: path, rowRoot: root } =
    element?.closest<HTMLElement>('[data-row-path]')?.dataset ?? {}
  return treeRows.value.find(
    (candidate) =>
      candidate.kind !== 'note' &&
      candidate.kind !== 'new' &&
      candidate.path === path &&
      candidate.root === root,
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
  // A row inside the selection keeps it, so the menu acts on all of it; any other row is selected alone.
  if (!isSelectedPlace(row.root, row.path)) select(row.path, row.root)
  menuRow.value = row
}

/** Whether the menu is for several rows, when only Delete makes sense. */
const manyRows = computed(() => selectedPlaces.value.length > 1)

/** How git colors a row's name, or undefined for a row git has nothing to say about. */
function gitLookOf(row: TreeRow): ReturnType<typeof gitLook> {
  if (row.kind !== 'root' && row.kind !== 'folder' && row.kind !== 'file') return undefined
  return gitLook(row.root, row.path, row.kind)
}

/** The classes are written out whole, so Tailwind finds each one. */
function gitClass(row: TreeRow): string {
  switch (gitLookOf(row)) {
    case 'added':
      return 'text-git-added'
    case 'untracked':
      return 'text-git-untracked'
    case 'modified':
      return 'text-git-modified'
    case 'conflicted':
      return 'text-git-conflicted'
    case 'ignored':
      return 'text-git-ignored'
    case undefined:
      return ''
  }
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
  if (path !== null) void newFileIn(path, menuRow.value?.root)
}
function menuNewFolder(): void {
  const path = menuPath()
  if (path !== null) void newFolderIn(path, menuRow.value?.root)
}
function menuRename(): void {
  const path = menuPath()
  if (path !== null) void renameRow(path, menuRow.value?.root)
}
function menuDelete(): void {
  if (manyRows.value) {
    void deleteSelected()
    return
  }
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
/** The keys that start Find in Folder from the tree, as in VS Code. */
const FIND_IN_FOLDER_KEYS = 'Alt+Shift+F'

function menuFindInFolder(): void {
  const row = menuRow.value
  if (row !== null && (row.kind === 'root' || row.kind === 'folder'))
    findInFolder(row.path, row.root)
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
      if (first !== undefined) select(first.path, first.root)
    }
  })
}
watch(treeFocusRequest, () => {
  applyFocusRequest(takeTreeFocusRequest())
})

function onKeydown(event: KeyboardEvent): void {
  // The box a name is typed in handles its own keys.
  if (naming.value !== null || event.target !== scroller.value) return
  // Alt+Shift+F searches the selected folder. Other keys with Alt, Ctrl or Meta are shortcuts of
  // the app (history, headings, save...) and pass.
  if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyF') {
    const row = treeRows.value.find(
      (candidate) =>
        (candidate.kind === 'root' || candidate.kind === 'folder') &&
        candidate.path === selectedPath.value &&
        candidate.root === selectedRoot.value,
    )
    if (row !== undefined) {
      event.preventDefault()
      findInFolder(row.path, row.root)
    }
    return
  }
  if (event.ctrlKey || event.altKey || event.metaKey) return
  // Shift with Up or Down grows the selection from where it started; Escape goes back to one row.
  if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault()
    const action = keyAction(treeRows.value, selectedPath.value, event.key, selectedRoot.value)
    if (action?.kind === 'select') {
      selectRangeTo(treeRows.value, action.path, action.root)
      requestScroll(action.path, 'row', action.root)
    }
    return
  }
  if (event.key === 'Escape' && manyRows.value) {
    event.preventDefault()
    collapseSelection()
    return
  }
  if (!event.shiftKey && TREE_KEYS.includes(event.key)) {
    // Space and the arrows would scroll the list; the tree moves the selection itself.
    event.preventDefault()
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) return
    runKeyAction(keyAction(treeRows.value, selectedPath.value, event.key, selectedRoot.value))
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
    select(action.path, action.root)
    requestScroll(action.path, 'row', action.root)
  } else if (action.kind === 'toggle') {
    void toggleFolder(action.path, action.root)
  } else {
    const row = treeRows.value.find(
      (candidate) =>
        isSelectable(candidate) && candidate.path === action.path && candidate.root === action.root,
    )
    if (row !== undefined) void activateRow(row, { focusEditor: action.focusEditor })
  }
}

// ---- moving a row by dragging it ----

/** Pixels the pointer must travel before a press becomes a drag, so a click never moves a file. */
const DRAG_THRESHOLD = 5

/** The rows being dragged: the selection, which a press on an unselected row replaces by that row. */
const dragged = ref<readonly Place[]>([])
/** What the drag moves, fixed when it starts. */
let dragPaths: string[] = []
/** The folder the dragged row would land in, or null when the pointer is somewhere it cannot. */
const dropFolder = ref<Place | null>(null)
let press: { root: string; path: string; x: number; y: number } | undefined
let swallowClick = false

function folderAt(x: number, y: number): Place | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-row-path]')
  const { rowPath: path, rowRoot: root } = element?.dataset ?? {}
  if (element === null || element === undefined || path === undefined || root === undefined) {
    return null
  }
  if (element.dataset.kind === 'file') {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    return cut <= 0 ? null : { root, path: path.slice(0, cut) }
  }
  return { root, path }
}

function onPointerDown(event: PointerEvent, row: TreeRow): void {
  if (event.button !== 0 || naming.value !== null) return
  if (row.kind !== 'file' && row.kind !== 'folder') return
  press = { root: row.root, path: row.path, x: event.clientX, y: event.clientY }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('keydown', onDragKey, true)
}

function onPointerMove(event: PointerEvent): void {
  if (press === undefined) return
  if (dragged.value.length === 0) {
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD) return
    // Dragging a row that is not selected takes that row alone; dragging a selected one takes them all.
    if (!isSelectedPlace(press.root, press.path)) select(press.path, press.root)
    dragged.value = selectedPlaces.value
    dragPaths = selectedTargets().paths
    if (dragPaths.length === 0) dragPaths = [press.path]
  }
  // Past the edge of the window the drag is no longer ours: the OS takes it, to copy the rows
  // wherever they are dropped, and the pointer events stop until it ends.
  if (isOutsideWindow(event.clientX, event.clientY)) {
    handOver()
    return
  }
  const folder = folderAt(event.clientX, event.clientY)
  // The folder takes the drag when at least one of the rows can go there; the others are skipped.
  dropFolder.value =
    folder !== null && dragPaths.some((path) => moveProblem(path, folder.path) === null)
      ? folder
      : null
  setDragCursor(dropFolder.value === null ? 'blocked' : 'move')
}

function isOutsideWindow(x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight
}

/** Ends the drag in the page and gives what it carries to the OS. */
function handOver(): void {
  const paths = dragPaths
  // The OS takes the button release, so no click follows and there is nothing to swallow.
  stopDrag()
  void dragOutOfWindow(paths)
}

function onPointerUp(): void {
  const [paths, folder] = [dragPaths, dropFolder.value]
  const wasDragging = dragged.value.length > 0
  stopDrag()
  if (!wasDragging) return
  // The click that ends a drag lands on the row under the pointer and must not open it.
  swallowClick = true
  setTimeout(() => {
    swallowClick = false
  }, 0)
  const [only] = paths
  if (folder === null || only === undefined) return
  void (paths.length === 1 ? moveRow(only, folder.path) : moveRows(paths, folder.path))
}

function onDragKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  stopDrag()
}

function stopDrag(): void {
  press = undefined
  dragged.value = []
  dragPaths = []
  dropFolder.value = null
  setDragCursor(null)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('keydown', onDragKey, true)
}

function onRowClick(event: MouseEvent, row: TreeRow): void {
  if (swallowClick) return
  // Ctrl adds the row to the selection or takes it out, Shift selects the rows up to it. Neither
  // opens a file or a folder. These come before the double-click test: two quick Ctrl clicks on
  // one row are two toggles.
  if (isSelectable(row) && (event.ctrlKey || event.metaKey)) {
    toggleSelected(row.path, row.root)
    return
  }
  if (isSelectable(row) && event.shiftKey) {
    selectRangeTo(treeRows.value, row.path, row.root)
    return
  }
  // The second click of a double click: the first one already did its work (a folder toggled once,
  // a file shown), and a double click on a file is the dblclick below.
  if (event.detail >= 2) return
  void activateRow(row)
}

/** A double click on a file shows it and puts the caret in it, like Enter. */
function onRowDoubleClick(event: MouseEvent, row: TreeRow): void {
  if (event.ctrlKey || event.metaKey || event.shiftKey) return
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
    samePath(typing.path, row.path) &&
    (typing.root === undefined || row.root === typing.root)
  )
}

function isDropTarget(row: TreeRow): boolean {
  return (
    (row.kind === 'root' || row.kind === 'folder') &&
    dropFolder.value !== null &&
    row.root === dropFolder.value.root &&
    samePath(row.path, dropFolder.value.path)
  )
}

function isDragged(row: TreeRow): boolean {
  return (
    row.kind !== 'note' &&
    row.kind !== 'new' &&
    dragged.value.some((place) => place.path === row.path && place.root === row.root)
  )
}

/**
 * One key per row. A folder can lie under two roots (a root inside another root), and then its
 * rows appear twice; the root a row sits under keeps their keys apart. Two rows with one key
 * leave rows behind in the page when the list changes.
 */
function rowKey(row: TreeRow): string {
  return `${row.root}|${row.kind}:${row.path}:${row.name}`
}

function isSelectedRow(row: TreeRow): boolean {
  return row.kind !== 'note' && row.kind !== 'new' && isSelectedPlace(row.root, row.path)
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
        aria-multiselectable="true"
        data-file-tree
        tabindex="0"
        :aria-activedescendant="
          selectedPath === null ? undefined : rowDomId(selectedPath, selectedRoot)
        "
        class="group/tree min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none text-chrome outline-none select-none"
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
              :id="
                row.kind === 'note' || row.kind === 'new' ? undefined : rowDomId(row.path, row.root)
              "
              :role="row.kind === 'note' || row.kind === 'new' ? 'none' : 'treeitem'"
              :aria-level="row.depth + 1"
              :aria-expanded="
                row.kind === 'root' || row.kind === 'folder' ? row.expanded : undefined
              "
              :aria-selected="row.kind !== 'note' && row.kind !== 'new' && isSelectedRow(row)"
              :data-row-path="row.kind === 'note' || row.kind === 'new' ? undefined : row.path"
              :data-row-root="row.kind === 'note' || row.kind === 'new' ? undefined : row.root"
              :data-kind="row.kind"
              :data-drop-target="isDropTarget(row) ? '' : undefined"
              :data-dragging="isDragged(row) ? '' : undefined"
              class="absolute right-0 left-0 flex cursor-default items-center gap-1 pr-2"
              :class="[
                isSelectedRow(row)
                  ? 'bg-sidebar-accent/60 text-sidebar-accent-foreground group-focus-within/tree:bg-sidebar-accent'
                  : 'hover:bg-sidebar-accent/50',
                isDropTarget(row)
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-ring ring-inset'
                  : '',
                isDragged(row) ? 'opacity-50' : '',
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
              @dblclick="onRowDoubleClick($event, row)"
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
                <FileIcon :name="row.name" />
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
                :class="gitClass(row)"
                :data-git="gitLookOf(row)"
                >{{ row.name }}</span
              >
            </div>
          </HoverHint>
        </div>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent @close-auto-focus="onMenuClosed">
      <template v-if="manyRows">
        <ContextMenuItem @select="menuDelete">
          Delete {{ selectedPlaces.length }} items
          <ContextMenuShortcut>{{ TREE_DELETE_KEY }}</ContextMenuShortcut>
        </ContextMenuItem>
      </template>
      <template v-else>
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
        <ContextMenuItem
          v-if="isFolderRow"
          @select="menuFindInFolder"
        >
          Find in Folder...
          <ContextMenuShortcut>{{ FIND_IN_FOLDER_KEYS }}</ContextMenuShortcut>
        </ContextMenuItem>
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
      </template>
    </ContextMenuContent>
  </ContextMenu>
</template>
