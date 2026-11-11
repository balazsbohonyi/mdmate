<script setup lang="ts">
import { computed, watch } from 'vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cancelDelete, confirmDelete, deletePrompt, type DeletePrompt } from './ops'

/**
 * The question before a file or folder is deleted from the tree (ISC-227): what goes, where it
 * goes, and what happens to the tabs that show it (ISC-228). Cancel has the focus, so a stray
 * Enter never deletes.
 */
const bin = navigator.userAgent.includes('Windows') ? 'the Recycle Bin' : 'the Trash'

const lines = computed<string[]>(() => {
  const asked = deletePrompt.value
  if (asked === null) return []
  const out = [
    asked.folder ? `The folder and everything in it moves to ${bin}.` : `The file moves to ${bin}.`,
  ]
  if (asked.tabs > 0) {
    out.push(asked.tabs === 1 ? '1 open tab closes.' : `${String(asked.tabs)} open tabs close.`)
  }
  if (asked.unsaved > 0) {
    out.push(
      asked.unsaved === 1
        ? 'It has unsaved changes, and they are lost.'
        : `${String(asked.unsaved)} files have unsaved changes, and they are lost.`,
    )
  }
  return out
})

/**
 * The Delete button also closes the dialog, and that close runs before its own click handler
 * does, so the question is kept here for the click to answer.
 */
let shown: DeletePrompt | null = null
watch(
  deletePrompt,
  (asked) => {
    if (asked !== null) shown = asked
  },
  { flush: 'sync' },
)
function confirm(): void {
  void confirmDelete(shown)
}

function onOpenChange(open: boolean): void {
  if (!open) cancelDelete()
}
</script>

<template>
  <AlertDialog
    :open="deletePrompt !== null"
    @update:open="onOpenChange"
  >
    <AlertDialogContent
      data-delete-dialog
      class="sm:max-w-sm"
    >
      <AlertDialogHeader>
        <AlertDialogTitle class="break-all">
          Delete {{ deletePrompt?.folder ? 'the folder ' : '' }}"{{ deletePrompt?.name }}"?
        </AlertDialogTitle>
        <AlertDialogDescription as-child>
          <div class="grid gap-1">
            <p
              v-for="line in lines"
              :key="line"
              :data-warn="line.includes('lost') ? '' : undefined"
              :class="line.includes('lost') ? 'text-destructive' : ''"
            >
              {{ line }}
            </p>
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          data-delete-confirm
          @click="confirm"
        >
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
