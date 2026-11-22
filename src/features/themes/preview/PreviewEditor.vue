<script setup lang="ts">
import { EditorState, Prec, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import { brokenLinks, LinkStatus, linkStatus } from '@/editor/brokenLinks'
import { createFollowerState, createView, drawnSelection } from '@/editor/create'
import { EMPTY_FIND, FIND_COUNT_EVENT, findEffect } from '@/editor/find'
import { PREVIEW_FIND, PREVIEW_MISSING, PREVIEW_NOTE, previewSelection } from './previewNote'

/**
 * The editor of the Theme preview: the app's own editor (the same extensions a document's tab gets,
 * live preview on) showing the sample note, read-only and unfocusable, so nothing typed, pasted or
 * dropped can reach it. It has three selection ranges, a find query and a link status of its own,
 * answered here, so the selection, the find matches, the caret and a broken link are all on screen
 * with no folder open and no host call. It reads no store: its colors are the tokens on the root.
 */

const host = useTemplateRef<HTMLElement>('host')
let view: EditorView | undefined

/** A target is missing when its name says so: the preview has no folder to look in. */
const status = new LinkStatus((hrefs) =>
  Promise.resolve(hrefs.map((href) => href === PREVIEW_MISSING)),
)

/**
 * The find count of this editor is the preview's own business: the event it sends bubbles, and the
 * status bar listens for it per pane, so it is stopped here and never reaches the app.
 */
function keepFindCount(event: Event): void {
  event.stopPropagation()
}

onMounted(() => {
  const parent = host.value
  if (parent === null) return
  parent.addEventListener(FIND_COUNT_EVENT, keepFindCount)
  const state = createFollowerState({
    doc: Text.of(PREVIEW_NOTE.split('\n')),
    selection: previewSelection(),
    extensions: [
      drawnSelection,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      // A read-only view still moves its selection on a click or a key; the preview's three ranges
      // are the sample, so the pointer and the keys are answered here and go no further.
      Prec.highest(
        EditorView.domEventHandlers({
          mousedown: (event) => {
            event.preventDefault()
            return true
          },
          touchstart: () => true,
          dragstart: (event) => {
            event.preventDefault()
            return true
          },
          keydown: () => true,
        }),
      ),
      EditorState.allowMultipleSelections.of(true),
      linkStatus.of(status),
      brokenLinks(),
    ],
  })
  view = createView(parent, state)
  view.dispatch({ effects: findEffect({ ...EMPTY_FIND, search: PREVIEW_FIND }) })
})

onBeforeUnmount(() => {
  host.value?.removeEventListener(FIND_COUNT_EVENT, keepFindCount)
  view?.destroy()
  view = undefined
})
</script>

<template>
  <div
    ref="host"
    class="preview-editor h-full min-h-0 min-w-0"
    data-preview-editor
  />
</template>

<style scoped>
/* The view is never focused, and an unfocused editor draws no caret; the preview shows it anyway. */
.preview-editor :deep(.cm-cursor) {
  display: block !important;
}
</style>
