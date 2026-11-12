import { computed, ref } from 'vue'

const visible = ref(true)

/** Which list the sidebar shows: the folders, the search in them, or the files that link to one file. */
export type SidebarPanel = 'folders' | 'search' | 'outline' | 'references'

const shown = ref<SidebarPanel>('folders')

/** Whether the sidebar is on screen. A module-level store, shared by the shell and the commands. */
export const sidebarVisible = computed(() => visible.value)

/** The list the sidebar shows. */
export const sidebarPanel = computed(() => shown.value)

/** The narrowest the sidebar can be dragged, in px: 12rem at the default root size. */
export const SIDEBAR_MIN = 192

/** How wide the sidebar starts and after a double click on its edge, in px: 15rem (`--spacing-sidebar`). */
export const SIDEBAR_DEFAULT = 240

/** The widest the sidebar can be dragged, as a share of the window. */
export const SIDEBAR_MAX_SHARE = 0.5

/** The dragged width in px, or null while the sidebar is at the width the stylesheet gives it. */
const dragged = ref<number | null>(null)

export const sidebarWidth = computed(() => dragged.value)

/** The window's width in px. A tool with no window (the unit tests in Node) gets a wide one. */
export function currentWindowWidth(): number {
  return typeof window === 'undefined' ? 1920 : window.innerWidth
}

/** The widest the sidebar may be in a window this wide. Never below the narrowest. */
export function sidebarMax(windowWidth: number): number {
  return Math.max(SIDEBAR_MIN, Math.floor(windowWidth * SIDEBAR_MAX_SHARE))
}

/**
 * Sets the width, held between the narrowest and half the window. Null, or a width that is not a
 * number, puts the sidebar back to the default. Hiding and showing the sidebar leaves it alone.
 */
export function setSidebarWidth(width: number | null, windowWidth: number): void {
  if (width === null || !Number.isFinite(width)) {
    dragged.value = null
    return
  }
  dragged.value = Math.round(Math.min(sidebarMax(windowWidth), Math.max(SIDEBAR_MIN, width)))
}

export function toggleSidebar(): void {
  visible.value = !visible.value
}

/** Brings the sidebar on screen, and with a panel switches to it. */
export function showSidebar(panel?: SidebarPanel): void {
  visible.value = true
  if (panel !== undefined) shown.value = panel
}

/** Puts the sidebar back as it starts: on screen, showing the folders. For tests. */
export function resetSidebar(): void {
  visible.value = true
  shown.value = 'folders'
  dragged.value = null
}
