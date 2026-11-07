<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { followerOfTab } from '@/documents/store'
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
  editor.show(follower, active)
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
watch(
  () => active,
  (isActive) => {
    if (isActive) editor?.focus()
  },
)
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
