<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
import { ref } from 'vue'
import HoverHint from '@/components/HoverHint.vue'
import { baseName } from '@/features/tree/model'

/**
 * The files a link rewrite left alone, folded away behind its title: a click on the title opens
 * the list, one file to a line with the name in the accent colour and the reason after it, both
 * cut off with an ellipsis when the sidebar is narrow. The tooltip has the full path and reason.
 */
defineProps<{
  heading: string
  items: readonly { path: string; reason: string }[]
  kind: 'failed' | 'skipped'
}>()

const open = ref(false)
</script>

<template>
  <div class="flex flex-col gap-1">
    <button
      type="button"
      class="flex w-full cursor-default items-center gap-1 rounded text-left font-medium hover:text-primary"
      :aria-expanded="open"
      :data-rewrite-toggle="kind"
      @click="open = !open"
    >
      <span class="min-w-0 flex-1">{{ heading }}</span>
      <ChevronDown
        class="size-4 shrink-0 transition-transform"
        :class="open ? 'rotate-180' : ''"
        :stroke-width="1.5"
      />
    </button>
    <ul
      v-if="open"
      class="flex flex-col gap-1"
      :data-rewrite-list="kind"
    >
      <li
        v-for="item in items"
        :key="item.path"
        class="min-w-0"
      >
        <HoverHint :text="`${item.path}\n${item.reason}`">
          <div class="flex min-w-0 gap-1">
            <span class="max-w-[60%] shrink-0 truncate font-medium text-primary">{{
              baseName(item.path)
            }}</span>
            <span class="min-w-0 flex-1 truncate text-muted-foreground">{{ item.reason }}</span>
          </div>
        </HoverHint>
      </li>
    </ul>
  </div>
</template>
