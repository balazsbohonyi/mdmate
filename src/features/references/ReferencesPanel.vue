<script setup lang="ts">
import { computed } from 'vue'
import { baseName } from '@/features/tree/model'
import type { Reference } from '@/platform'
import { relativePathOf } from '@/workbench/tabMenu'
import { openReference, referencesState } from './store'

const state = computed(() => referencesState.value)

interface Group {
  readonly path: string
  readonly name: string
  readonly where: string
  readonly items: readonly Reference[]
}

/** The references by file, in the order Rust listed them. */
const groups = computed<Group[]>(() => {
  const current = state.value
  if (current?.phase !== 'done') return []
  const byFile = new Map<string, Reference[]>()
  for (const reference of current.found.references) {
    const list = byFile.get(reference.path) ?? []
    list.push(reference)
    byFile.set(reference.path, list)
  }
  return [...byFile].map(([path, items]) => {
    const relative = relativePathOf(path)
    const name = baseName(relative)
    return { path, name, where: relative.slice(0, relative.length - name.length), items }
  })
})

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`
}

const summary = computed(() => {
  const current = state.value
  if (current === null) return ''
  if (current.phase === 'searching') return 'Searching...'
  if (current.phase === 'failed') return current.message
  const { references, files } = current.found
  if (references.length === 0) return 'No file links to this one.'
  return `${plural(references.length, 'link', 'links')} in ${plural(files, 'file', 'files')}`
})
</script>

<template>
  <section
    v-if="state !== null"
    aria-label="References"
    data-references
    class="flex min-h-0 flex-1 flex-col text-chrome"
  >
    <div class="shrink-0 border-b border-sidebar-border px-3 py-2">
      <div
        class="truncate font-medium"
        :title="state.target"
      >
        Links to {{ baseName(state.target) }}
      </div>
      <div
        data-references-summary
        class="mt-0.5 text-xs"
        :class="state.phase === 'failed' ? 'text-destructive' : 'text-muted-foreground'"
      >
        {{ summary }}
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <div
        v-for="group in groups"
        :key="group.path"
        data-references-file
      >
        <div
          class="flex items-baseline gap-2 px-3 pt-2 pb-0.5 select-none"
          :title="group.path"
        >
          <span class="shrink-0 font-medium">{{ group.name }}</span>
          <span class="min-w-0 truncate text-xs text-muted-foreground">{{ group.where }}</span>
        </div>
        <button
          v-for="reference in group.items"
          :key="`${String(reference.line)}:${String(reference.column)}`"
          type="button"
          data-reference
          :data-line="reference.line"
          class="flex w-full cursor-default items-baseline gap-2 py-0.5 pr-3 pl-6 text-left hover:bg-sidebar-accent/50 focus-visible:bg-sidebar-accent/50 focus-visible:outline-none"
          @click="openReference(reference)"
        >
          <span class="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {{ reference.line }}
          </span>
          <span class="min-w-0 truncate">{{ reference.text }}</span>
        </button>
      </div>
      <p
        v-if="state.phase === 'done' && state.found.truncated"
        data-references-truncated
        class="px-3 py-2 text-xs text-muted-foreground"
      >
        Only the first links are listed; there are more.
      </p>
      <p
        v-if="state.phase === 'done' && state.found.skipped.length > 0"
        data-references-skipped
        class="px-3 py-2 text-xs text-muted-foreground"
        :title="state.found.skipped.map((item) => `${item.path}: ${item.reason}`).join('\n')"
      >
        {{ plural(state.found.skipped.length, 'file', 'files') }} could not be checked.
      </p>
    </div>
  </section>
</template>
