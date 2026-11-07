<script setup lang="ts">
import { computed } from 'vue'
import { docMeta } from '@/documents/meta'
import { pendingClose, resolveConflict, resolvePendingClose } from '@/documents/store'

const { docId, tabId } = defineProps<{ docId: number; tabId: string }>()

const meta = computed(() => docMeta(docId))
const closing = computed(() => pendingClose.value?.tabId === tabId)
const conflict = computed(() => meta.value?.conflict ?? null)

function settle(choice: 'mine' | 'theirs'): void {
  resolveConflict(docId, choice).catch((error: unknown) => {
    console.error('Could not settle the conflict', error)
  })
}

function resolve(choice: 'save' | 'discard' | 'cancel'): void {
  resolvePendingClose(choice).catch((error: unknown) => {
    console.error('Could not settle the pending close', error)
  })
}
</script>

<template>
  <div
    v-if="closing"
    role="alert"
    class="flex shrink-0 items-center gap-3 border-b border-border bg-muted px-3 py-1.5 text-chrome"
  >
    <span class="min-w-0 flex-1 truncate">
      Save the changes to {{ meta?.name }} before closing?
      <span
        v-if="meta?.saveError"
        class="text-destructive"
      >
        Could not save: {{ meta.saveError }}
      </span>
    </span>
    <button
      type="button"
      class="rounded-sm px-2 py-0.5 hover:bg-accent"
      @click="resolve('save')"
    >
      Save
    </button>
    <button
      type="button"
      class="rounded-sm px-2 py-0.5 hover:bg-accent"
      @click="resolve('discard')"
    >
      Don't save
    </button>
    <button
      type="button"
      class="rounded-sm px-2 py-0.5 hover:bg-accent"
      @click="resolve('cancel')"
    >
      Cancel
    </button>
  </div>
  <div
    v-if="conflict !== null"
    role="alert"
    data-testid="conflict-notice"
    class="flex shrink-0 items-center gap-3 border-b border-border bg-muted px-3 py-1.5 text-chrome"
  >
    <span class="min-w-0 flex-1 truncate">
      {{ meta?.name }} changed on disk, and you have edits the disk does not have.
    </span>
    <button
      type="button"
      class="rounded-sm px-2 py-0.5 hover:bg-accent"
      @click="settle('mine')"
    >
      Keep mine
    </button>
    <button
      type="button"
      class="rounded-sm px-2 py-0.5 hover:bg-accent"
      @click="settle('theirs')"
    >
      Load theirs
    </button>
  </div>
  <div
    v-if="!closing && conflict === null && meta?.readOnly"
    role="status"
    class="shrink-0 border-b border-border bg-muted px-3 py-1.5 text-chrome"
  >
    Read-only:
    {{
      meta.readOnly === 'unsupported-encoding'
        ? "this file's encoding is not UTF-8 or UTF-16, so mdmate shows it but will not save it."
        : 'saving it would change bytes you did not edit.'
    }}
  </div>
  <div
    v-else-if="!closing && conflict === null && meta?.saveError"
    role="alert"
    class="shrink-0 border-b border-border bg-muted px-3 py-1.5 text-chrome text-destructive"
  >
    Could not save {{ meta.name }}: {{ meta.saveError }}
  </div>
</template>
