<script setup lang="ts">
import type { EditorView } from '@codemirror/view'
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { documentById } from '@/documents/store'
import { createView } from '@/editor/create'

const { docId, active } = defineProps<{ docId: number; active: boolean }>()
const host = useTemplateRef<HTMLElement>('host')

// The view is never reactive: editor objects stay out of Vue's reactivity.
let view: EditorView | undefined
let shown: number | undefined

/** Gives the state back to its document, so a selection moved in this view is not lost. */
function park(): void {
  if (view !== undefined && shown !== undefined) documentById(shown)?.setState(view.state)
}

function show(id: number): void {
  const doc = documentById(id)
  if (doc === undefined || host.value === null) return
  if (view === undefined) {
    view = createView(host.value, doc.state)
  } else {
    park()
    view.setState(doc.state)
  }
  shown = id
  if (active) view.focus()
}

onMounted(() => {
  show(docId)
})
watch(
  () => docId,
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
  park()
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
