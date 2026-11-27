<script setup lang="ts">
import { computed, onScopeDispose, watch } from 'vue'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { holdShortcuts } from '@/workbench/keyboard'
import { cancelRunningDelete, deleteRun } from './ops'

/**
 * The dialog of a delete that takes long (ISC-788). It holds the app back until the delete ends:
 * Cancel asks the delete to stop, and does not close the dialog by itself.
 */
const bin = navigator.userAgent.includes('Windows') ? 'the Recycle Bin' : 'the Trash'

// No shortcut acts on the app behind the dialog (ISC-789).
let releaseShortcuts: (() => void) | undefined
watch(
  () => deleteRun.value !== null,
  (open) => {
    releaseShortcuts?.()
    releaseShortcuts = open ? holdShortcuts() : undefined
  },
  { immediate: true },
)
onScopeDispose(() => releaseShortcuts?.())

const moving = computed(() => deleteRun.value?.progress.phase === 'moving')
const cancelling = computed(() => !moving.value && deleteRun.value?.cancelling === true)
/** How far the system has counted, or null where there is no figure. */
const percent = computed(() => {
  const progress = deleteRun.value?.progress
  return progress?.phase === 'counting' ? progress.percent : null
})
const state = computed(() => {
  if (moving.value) return `Moving to ${bin}…`
  if (cancelling.value) return 'Cancelling…'
  return percent.value === null ? 'Preparing…' : `Counting… ${String(percent.value)}%`
})
const filled = computed(() =>
  percent.value === null ? {} : { width: `${String(percent.value)}%` },
)

/** Cancel and Escape both ask for the dialog to close; the delete decides when it does. */
function onOpenChange(open: boolean): void {
  if (!open) cancelRunningDelete()
}

/** Cancel takes the focus by itself, but not while it is disabled. */
function onOpenFocus(event: Event): void {
  if (!moving.value || !(event.target instanceof HTMLElement)) return
  event.preventDefault()
  event.target.focus()
}
</script>

<template>
  <AlertDialog
    :open="deleteRun !== null"
    @update:open="onOpenChange"
  >
    <AlertDialogContent
      data-delete-progress
      class="sm:max-w-sm"
      @open-auto-focus="onOpenFocus"
    >
      <AlertDialogHeader>
        <AlertDialogTitle class="break-words"> Deleting {{ deleteRun?.name }} </AlertDialogTitle>
        <AlertDialogDescription
          data-delete-state
          aria-live="polite"
        >
          {{ state }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <!-- The bar of the indexing status, as wide as the dialog. -->
      <div
        class="bg-foreground/20 h-1 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-label="Deleting"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="percent ?? undefined"
      >
        <div
          class="bg-primary h-full"
          :class="percent === null ? 'delete-bar-running w-1/3' : ''"
          :style="filled"
          data-delete-bar
        />
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel
          :disabled="moving || cancelling"
          data-delete-cancel
        >
          Cancel
        </AlertDialogCancel>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<style scoped>
/* With no figure, a short piece travels along the bar: a full bar would read as finished. */
.delete-bar-running {
  animation: delete-progress 1.1s ease-in-out infinite;
}
@keyframes delete-progress {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(300%);
  }
}
/* No motion asked for: a still, faint bar says the same thing. */
@media (prefers-reduced-motion: reduce) {
  .delete-bar-running {
    animation: none;
    width: 100%;
    opacity: 0.5;
  }
}
</style>
