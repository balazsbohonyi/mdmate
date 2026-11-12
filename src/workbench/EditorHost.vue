<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { followerOfTab } from '@/documents/store'
import { rowsVersion } from '@/features/search/store'
import { syncSearchTicks } from '@/features/search/ticks'
import { editorFocusRequest, isEditorFocusHeld } from './focus'
import { PaneEditor } from './paneEditor'

const { tabId, active, raw } = defineProps<{ tabId: string; active: boolean; raw: boolean }>()
const host = useTemplateRef<HTMLElement>('host')

// The editor is never reactive: editor objects stay out of Vue's reactivity. It stays for the life
// of the pane, and each tab's state is swapped in with `setState`, which keeps a tab switch cheap.
let editor: PaneEditor | undefined

function show(id: string): void {
  const follower = followerOfTab(id)
  if (follower === undefined || host.value === null) return
  if (editor === undefined) {
    editor = new PaneEditor(host.value)
    editor.setRaw(raw)
  }
  // A tree click shows a file without taking focus away from the tree (ISC-255).
  editor.show(follower, active && !isEditorFocusHeld())
  syncSearchTicks(id)
}

onMounted(() => {
  show(tabId)
})
watch(
  () => tabId,
  (id) => {
    show(id)
  },
)
// The folder search's hits in the shown file are ticks along its scrollbar; they follow the list.
watch(rowsVersion, () => {
  syncSearchTicks(tabId)
})
watch(
  () => active,
  (isActive) => {
    if (isActive && !isEditorFocusHeld()) editor?.focus()
  },
)
// Enter or a double click on a file in the tree asks for the caret, even when the tab did not change.
watch(editorFocusRequest, () => {
  if (active) editor?.focus()
})
watch(
  () => raw,
  (isRaw) => {
    editor?.setRaw(isRaw)
  },
)
onBeforeUnmount(() => {
  editor?.destroy()
  editor = undefined
})
</script>

<template>
  <div
    ref="host"
    class="h-full min-h-0 w-full min-w-0"
  />
</template>
