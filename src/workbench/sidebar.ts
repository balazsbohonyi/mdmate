import { computed, ref } from 'vue'

const visible = ref(true)

/** Which list the sidebar shows: the folders, the search in them, or the files that link to one file. */
export type SidebarPanel = 'folders' | 'search' | 'outline' | 'references'

const shown = ref<SidebarPanel>('folders')

/** Whether a value read from a file is one of the panels. */
export function isSidebarPanel(value: unknown): value is SidebarPanel {
  return value === 'folders' || value === 'search' || value === 'outline' || value === 'references'
}

/** Whether the sidebar is on screen. A module-level store, shared by the shell and the commands. */
export const sidebarVisible = computed(() => visible.value)

/** The list the sidebar shows. */
export const sidebarPanel = computed(() => shown.value)

/**
 * The narrowest the sidebar is until its tab strip has been measured, in px: 12rem at the default
 * root size. Once the frame measures the strip, the minimum is what the tabs need (`sidebarMinimum`).
 */
export const SIDEBAR_MIN = 192

/** How wide the sidebar starts and after a double click on its edge, in px: 15rem (`--spacing-sidebar`). */
export const SIDEBAR_DEFAULT = 240

/** The widest the sidebar can be dragged, as a share of the window. */
export const SIDEBAR_MAX_SHARE = 0.5

/** The dragged width in px, or null while the sidebar is at the width the stylesheet gives it. */
const dragged = ref<number | null>(null)

export const sidebarWidth = computed(() => dragged.value)

/** What the tab strip needs, in px, as the frame last measured it; null while nothing measures it. */
const measured = ref<number | null>(null)

/**
 * The narrowest the sidebar can be, in px: the width its tab strip needs, so that no label leaves
 * the sidebar (P9.1-T23). It follows the font, the zoom and the References tab. Until the frame has
 * measured the strip it is `SIDEBAR_MIN`.
 */
export const sidebarMinimum = computed(() => measured.value ?? SIDEBAR_MIN)

/** The window's width in px. A tool with no window (the unit tests in Node) gets a wide one. */
export function currentWindowWidth(): number {
  return typeof window === 'undefined' ? 1920 : window.innerWidth
}

/** The widest the sidebar may be in a window this wide. Never below the narrowest. */
export function sidebarMax(windowWidth: number): number {
  return Math.max(sidebarMinimum.value, Math.floor(windowWidth * SIDEBAR_MAX_SHARE))
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
  dragged.value = Math.round(
    Math.min(sidebarMax(windowWidth), Math.max(sidebarMinimum.value, width)),
  )
}

/**
 * Tells the store what the tab strip needs, in px (rounded up, so its last pixel is never cut), or
 * null when there is no strip to measure or it reads nothing. A width already set that is now below
 * the minimum is raised to it, which is also how a width restored before the strip was measured
 * reaches it. The default width has nothing to raise: the page holds it up with the same minimum.
 */
export function setSidebarMinimum(width: number | null): void {
  measured.value = width !== null && Number.isFinite(width) && width > 0 ? Math.ceil(width) : null
  if (dragged.value !== null && dragged.value < sidebarMinimum.value) {
    dragged.value = sidebarMinimum.value
  }
}

export function toggleSidebar(): void {
  visible.value = !visible.value
}

/** Brings the sidebar on screen, and with a panel switches to it. */
export function showSidebar(panel?: SidebarPanel): void {
  visible.value = true
  if (panel !== undefined) shown.value = panel
}

/**
 * Puts the sidebar as the last run left it (P9.1-T18). The References list is a result that is not
 * kept, so a session never names it and it would have nothing to show; it comes back as Folders.
 */
export function restoreSidebar(isVisible: boolean, panel: SidebarPanel): void {
  visible.value = isVisible
  shown.value = panel === 'references' ? 'folders' : panel
}

/** Puts the sidebar back as it starts: on screen, showing the folders. For tests. */
export function resetSidebar(): void {
  visible.value = true
  shown.value = 'folders'
  dragged.value = null
  measured.value = null
}
