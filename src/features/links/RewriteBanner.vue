<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { baseName } from '@/features/tree/model'
import { answerRewrite, cancelRewriteScan, dismissRewriteReport, rewriteState } from './rewrite'

const box = ref<HTMLElement | null>(null)

const state = computed(() => rewriteState.value)
const asking = computed(() => (state.value?.phase === 'asking' ? state.value.planned : null))

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

// The question takes the keyboard so Escape and Enter work.
watch(
  () => state.value?.phase,
  async (phase) => {
    if (phase !== 'asking' && phase !== 'report') return
    await nextTick()
    box.value?.querySelector('button')?.focus()
  },
  { flush: 'post' },
)
</script>

<template>
  <div
    v-if="state !== null"
    ref="box"
    :role="state.phase === 'asking' ? 'alertdialog' : 'status'"
    aria-label="Links"
    data-rewrite-banner
    :data-phase="state.phase"
    class="flex shrink-0 flex-col gap-2 border-b border-sidebar-border bg-sidebar-accent/40 p-3 text-chrome"
    @keydown.esc.stop="state.phase === 'asking' ? answerRewrite('cancel') : dismissRewriteReport()"
  >
    <template v-if="state.phase === 'scanning'">
      <p data-rewrite-progress>
        Looking for links to update… {{ plural(state.scanned, 'file', 'files') }} checked.
      </p>
      <div class="flex gap-1.5">
        <button
          type="button"
          class="rounded border border-sidebar-border bg-sidebar px-2 py-1 hover:bg-sidebar-accent"
          data-answer="stop"
          @click="cancelRewriteScan()"
        >
          Cancel
        </button>
      </div>
    </template>

    <template v-else-if="asking !== null">
      <p
        class="break-words"
        data-rewrite-question
      >
        Update
        <span
          class="font-medium"
          data-links
          >{{ plural(asking.links, 'link', 'links') }}</span
        >
        in
        <span
          class="font-medium"
          data-files
          >{{ plural(asking.files, 'file', 'files') }}</span
        >?
      </p>
      <p
        v-if="asking.skipped.length > 0"
        class="text-muted-foreground"
        data-rewrite-note
      >
        {{ plural(asking.skipped.length, 'file', 'files') }} could not be checked and will keep
        {{ asking.skipped.length === 1 ? 'its' : 'their' }} links.
      </p>
      <div class="flex flex-wrap gap-1.5">
        <button
          type="button"
          class="rounded border border-sidebar-border bg-sidebar px-2 py-1 hover:bg-sidebar-accent"
          data-answer="update"
          @click="answerRewrite('update')"
        >
          Update links
        </button>
        <button
          type="button"
          class="rounded border border-sidebar-border bg-sidebar px-2 py-1 hover:bg-sidebar-accent"
          data-answer="move-only"
          @click="answerRewrite('move-only')"
        >
          Don't update
        </button>
        <button
          type="button"
          class="rounded border border-sidebar-border bg-sidebar px-2 py-1 hover:bg-sidebar-accent"
          data-answer="cancel"
          @click="answerRewrite('cancel')"
        >
          Cancel
        </button>
      </div>
    </template>

    <template v-else-if="state.phase === 'report'">
      <p
        v-if="state.failed.length > 0"
        class="font-medium"
        data-rewrite-failed-title
      >
        {{ plural(state.failed.length, 'file kept', 'files kept') }} its old links
      </p>
      <ul
        v-if="state.failed.length > 0"
        class="flex flex-col gap-1"
        data-rewrite-failed
      >
        <li
          v-for="item in state.failed"
          :key="item.path"
          class="break-words"
        >
          <span
            class="font-medium"
            :title="item.path"
            >{{ baseName(item.path) }}</span
          >: {{ item.reason }}
        </li>
      </ul>
      <p
        v-if="state.skipped.length > 0"
        class="font-medium"
        data-rewrite-skipped-title
      >
        {{ plural(state.skipped.length, 'file', 'files') }} could not be checked
      </p>
      <ul
        v-if="state.skipped.length > 0"
        class="flex flex-col gap-1"
        data-rewrite-skipped
      >
        <li
          v-for="item in state.skipped"
          :key="item.path"
          class="break-words"
        >
          <span
            class="font-medium"
            :title="item.path"
            >{{ baseName(item.path) }}</span
          >: {{ item.reason }}
        </li>
      </ul>
      <div class="flex gap-1.5">
        <button
          type="button"
          class="rounded border border-sidebar-border bg-sidebar px-2 py-1 hover:bg-sidebar-accent"
          data-answer="dismiss"
          @click="dismissRewriteReport()"
        >
          Dismiss
        </button>
      </div>
    </template>
  </div>
</template>
