import { computed, ref } from 'vue'

const visible = ref(true)

/** Which list the sidebar shows: the folders, or the files that link to one file. */
export type SidebarPanel = 'folders' | 'references'

const shown = ref<SidebarPanel>('folders')

/** Whether the sidebar is on screen. A module-level store, shared by the shell and the commands. */
export const sidebarVisible = computed(() => visible.value)

/** The list the sidebar shows. */
export const sidebarPanel = computed(() => shown.value)

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
}
