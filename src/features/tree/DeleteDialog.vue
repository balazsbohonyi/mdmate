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
 * goes, and what happens to the tabs that show it (ISC-228). A permanent delete says that it
 * cannot be undone (ISC-793). Cancel has the focus, so a stray Enter never deletes.
 */
const bin = navigator.userAgent.includes('Windows') ? 'the Recycle Bin' : 'the Trash'

/** Several items in one question: the title names how many, and the lines say what they are. */
const several = computed(() => (deletePrompt.value?.paths.length ?? 1) > 1)

const title = computed(() => {
  const asked = deletePrompt.value
  if (asked === null) return ''
  const how = asked.permanent ? ' permanently' : ''
  if (several.value) return `Delete ${asked.name}${how}?`
  return `Delete ${asked.folder ? 'the folder ' : ''}"${asked.name}"${how}?`
})

const UNDONE = 'This cannot be undone.'

/** The lines that tell of a loss, which are drawn in the warning color. */
const warns = (line: string): boolean => line === UNDONE || line.includes('lost')

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`
}

const lines = computed<string[]>(() => {
  const asked = deletePrompt.value
  if (asked === null) return []
  const out: string[] = []
  if (several.value) {
    const parts = [
      asked.files > 0 ? count(asked.files, 'file', 'files') : null,
      asked.folders > 0 ? count(asked.folders, 'folder', 'folders') : null,
    ].filter((part): part is string => part !== null)
    const what = parts.join(' and ')
    out.push(
      asked.permanent ? `${what} will be removed without ${bin}.` : `${what} move to ${bin}.`,
    )
    if (asked.folders > 0) out.push('A folder takes everything in it.')
  } else if (asked.permanent) {
    out.push(
      asked.folder
        ? `The folder and everything in it will be removed without ${bin}.`
        : `The file will be removed without ${bin}.`,
    )
  } else {
    out.push(
      asked.folder
        ? `The folder and everything in it moves to ${bin}.`
        : `The file moves to ${bin}.`,
    )
  }
  if (asked.permanent) out.push(UNDONE)
  if (asked.tabs > 0) {
    out.push(asked.tabs === 1 ? '1 open tab closes.' : `${String(asked.tabs)} open tabs close.`)
  }
  if (asked.unsaved > 0) {
    out.push(
      asked.unsaved === 1
        ? several.value
          ? '1 file has unsaved changes, and they are lost.'
          : 'It has unsaved changes, and they are lost.'
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
        <AlertDialogTitle class="break-words">
          {{ title }}
        </AlertDialogTitle>
        <AlertDialogDescription as-child>
          <div class="grid gap-1">
            <p
              v-for="line in lines"
              :key="line"
              :data-warn="warns(line) ? '' : undefined"
              :class="warns(line) ? 'text-destructive' : ''"
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
          {{ deletePrompt?.permanent ? 'Delete Permanently' : 'Delete' }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
