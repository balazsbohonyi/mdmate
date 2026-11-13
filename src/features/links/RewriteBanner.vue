<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { baseName } from '@/features/tree/model'
import { answerRewrite, cancelRewriteScan, dismissRewriteReport, rewriteState } from './rewrite'
import RewriteFileList from './RewriteFileList.vue'

const box = ref<HTMLElement | null>(null)

const state = computed(() => rewriteState.value)
const asking = computed(() => (state.value?.phase === 'asking' ? state.value.path : null))

const updatedLine = computed(() => {
  const report = state.value
  if (report?.phase !== 'report' || report.updated === null) return null
  const { links, files } = report.updated
  if (links === 0) return 'No links pointed to it, so none were changed.'
  const where = plural(files, 'file', 'files')
  return links === null
    ? `Updated links in ${where}.`
    : `Updated ${plural(links, 'link', 'links')} in ${where}.`
})

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

// The question takes the keyboard so Escape and Enter work, and so does a list of what went
// wrong. A line that only says what was updated does not: the keyboard stays where it was.
watch(
  () => {
    const now = state.value
    if (now?.phase === 'asking') return 'asking'
    if (now?.phase === 'report' && (now.failed.length > 0 || now.skipped.length > 0))
      return 'report'
    return null
  },
  async (asks) => {
    if (asks === null) return
    await nextTick()
    box.value?.querySelector<HTMLElement>('[data-answer]')?.focus()
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
        Update links to
        <span
          class="font-medium"
          data-name
          >{{ baseName(asking) }}</span
        >?
      </p>
      <p
        class="text-muted-foreground"
        data-rewrite-note
      >
        Scans this workspace's Markdown files. May take a while.
      </p>
      <div class="flex flex-wrap gap-1.5">
        <!-- Yes comes first, so it is the button that has the keyboard and Enter picks it. -->
        <button
          type="button"
          class="rounded border border-sidebar-border bg-sidebar px-2 py-1 hover:bg-sidebar-accent"
          data-answer="update"
          @click="answerRewrite('update')"
        >
          Yes
        </button>
        <button
          type="button"
          class="rounded border border-sidebar-border bg-sidebar px-2 py-1 hover:bg-sidebar-accent"
          data-answer="move-only"
          @click="answerRewrite('move-only')"
        >
          No
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
        v-if="updatedLine !== null"
        data-rewrite-updated
      >
        {{ updatedLine }}
      </p>
      <RewriteFileList
        v-if="state.failed.length > 0"
        kind="failed"
        :heading="`${plural(state.failed.length, 'file kept', 'files kept')} its old links`"
        :items="state.failed"
      />
      <RewriteFileList
        v-if="state.skipped.length > 0"
        kind="skipped"
        :heading="`${plural(state.skipped.length, 'file', 'files')} could not be checked`"
        :items="state.skipped"
      />
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
