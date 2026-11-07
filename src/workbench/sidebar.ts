import { computed, ref } from 'vue'

const visible = ref(true)

/** Whether the sidebar is on screen. A module-level store, shared by the shell and the commands. */
export const sidebarVisible = computed(() => visible.value)

export function toggleSidebar(): void {
  visible.value = !visible.value
}
