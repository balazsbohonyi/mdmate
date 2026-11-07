<script setup lang="ts">
import type { EditorView } from '@codemirror/view'
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import type { Follower } from '@/documents/follower'
import { followerOfTab } from '@/documents/store'
import { createView } from '@/editor/create'

const { tabId, active } = defineProps<{ tabId: string; active: boolean }>()
const host = useTemplateRef<HTMLElement>('host')

// The view is never reactive: editor objects stay out of Vue's reactivity. It stays for the life
// of the pane, and each tab's state is swapped in with `setState`, which keeps a tab switch cheap.
let view: EditorView | undefined
let shown: Follower | undefined

function show(id: string): void {
  const follower = followerOfTab(id)
  if (follower === undefined || host.value === null) return
  if (follower === shown) return
  shown?.park()
  view ??= createView(host.value, follower.state)
  follower.show(view)
  shown = follower
  if (active) view.focus()
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
    if (isActive) view?.focus()
  },
)
onBeforeUnmount(() => {
  shown?.park()
  shown = undefined
  view?.destroy()
  view = undefined
})
</script>

<template>
  <div
    ref="host"
    class="h-full min-h-0 w-full min-w-0"
  />
</template>
