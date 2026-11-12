<script setup lang="ts">
import { CaseSensitive, ChevronDown, ChevronRight, Regex, WholeWord, X } from '@lucide/vue'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
  watchEffect,
} from 'vue'
import HoverHint from '@/components/HoverHint.vue'
import { Button } from '@/components/ui/button'
import { docMeta } from '@/documents/meta'
import {
  FIND_COUNT_EVENT,
  isValidFind,
  regexpProblem,
  EMPTY_FIND,
  type FindCount,
} from '@/editor/find'
import {
  applyFind,
  closeFind,
  findBars,
  findCounts,
  findSpec,
  runFind,
  setFind,
  toggleReplaceRow,
  type FindAction,
} from './find'
import { shortcutLabel } from './commands'
import { COMMAND_IDS } from './defaultCommands'
import { detectPlatform } from './keybinding'
import { toggleVariant } from '@/lib/toggle'

const { paneId, tabId, docId } = defineProps<{ paneId: string; tabId: string; docId: number }>()

const bar = computed(() => findBars.get(paneId))
const spec = findSpec
const root = useTemplateRef<HTMLElement>('root')
const findInput = useTemplateRef<HTMLInputElement>('findInput')
const platform = detectPlatform()

const readOnly = computed(() => (docMeta(docId)?.readOnly ?? null) !== null)
const valid = computed(() => isValidFind(spec.value))
const problem = computed(() => regexpProblem(spec.value))

/** The count the shown view last sent up the page, for the query as it was then. */
const count = ref<FindCount>({ total: 0, current: 0, capped: false })

const countLabel = computed(() => {
  if (!valid.value) return ''
  const { total, current, capped } = count.value
  if (total === 0) return capped ? 'Count stopped' : 'No results'
  const floor = capped ? '+' : ''
  return current > 0
    ? `${String(current)} of ${String(total)}${floor}`
    : `${String(total)}${floor} results`
})

// The status bar shows the count, so it goes where the bar for this pane can be found.
watchEffect(() => {
  findCounts.set(paneId, countLabel.value)
})

function onCount(event: Event): void {
  count.value = (event as CustomEvent<FindCount>).detail
}

// The bar sits inside the pane, and the editor's view sends its count up through the pane.
let section: Element | null = null
onMounted(() => {
  section = root.value?.closest('[data-pane-id]') ?? null
  section?.addEventListener(FIND_COUNT_EVENT, onCount)
})

// The query goes onto the shown tab's state, and comes off the tab that is left or closed.
watch(
  [() => tabId, spec],
  ([id, next], [previous]) => {
    if (previous !== undefined && previous !== id) applyFind(previous, EMPTY_FIND)
    applyFind(id, next)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  section?.removeEventListener(FIND_COUNT_EVENT, onCount)
  applyFind(tabId, EMPTY_FIND)
  findCounts.delete(paneId)
})

// A request to focus the box: Ctrl+F or Ctrl+H again selects what is in it.
watch(
  () => bar.value?.focus ?? 0,
  (requests) => {
    if (requests === 0) return
    void nextTick(() => {
      findInput.value?.focus()
      findInput.value?.select()
    })
  },
  { immediate: true },
)

function act(action: FindAction): void {
  runFind(tabId, action)
}

function onFindEnter(event: KeyboardEvent): void {
  act(event.shiftKey ? 'previous' : 'next')
}

function close(): void {
  closeFind(paneId)
}

const hint = (id: string, text: string): string => {
  const keys = shortcutLabel(id, platform)
  return keys === undefined ? text : `${text} (${keys})`
}

const input =
  'h-7 min-w-0 w-full rounded-sm border border-input bg-background px-2 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring aria-invalid:border-destructive'
</script>

<template>
  <!--
    One grid, so both boxes sit in the same column and have the same length: the switches before the
    boxes, the Find and Replace buttons after them.
  -->
  <div
    ref="root"
    role="search"
    aria-label="Find and replace"
    data-find-bar
    class="grid shrink-0 grid-cols-[auto_auto_minmax(0,1fr)_auto_auto_auto] items-center gap-x-1 gap-y-1 border-t border-border bg-muted px-2 py-1.5 text-chrome"
    @keydown.esc.prevent.stop="close"
  >
    <HoverHint :text="bar?.replace === true ? 'Hide replace' : 'Show replace'">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Toggle replace"
        :aria-expanded="bar?.replace === true"
        @click="toggleReplaceRow(paneId)"
      >
        <ChevronDown v-if="bar?.replace === true" />
        <ChevronRight v-else />
      </Button>
    </HoverHint>
    <div class="flex items-center gap-0.5">
      <HoverHint text="Regular expression">
        <Button
          type="button"
          :variant="toggleVariant(spec.regexp)"
          size="icon-sm"
          aria-label="Regular expression"
          :aria-pressed="spec.regexp"
          @click="setFind({ regexp: !spec.regexp })"
        >
          <Regex class="size-5" />
        </Button>
      </HoverHint>
      <HoverHint text="Match case">
        <Button
          type="button"
          :variant="toggleVariant(spec.caseSensitive)"
          size="icon-sm"
          aria-label="Match case"
          :aria-pressed="spec.caseSensitive"
          @click="setFind({ caseSensitive: !spec.caseSensitive })"
        >
          <CaseSensitive class="size-5" />
        </Button>
      </HoverHint>
      <HoverHint text="Whole word">
        <Button
          type="button"
          :variant="toggleVariant(spec.wholeWord)"
          size="icon-sm"
          aria-label="Whole word"
          :aria-pressed="spec.wholeWord"
          @click="setFind({ wholeWord: !spec.wholeWord })"
        >
          <WholeWord class="size-5" />
        </Button>
      </HoverHint>
    </div>
    <input
      ref="findInput"
      type="text"
      data-find-input
      aria-label="Find"
      placeholder="Find"
      spellcheck="false"
      autocomplete="off"
      :class="input"
      :value="spec.search"
      :aria-invalid="problem !== null"
      @input="setFind({ search: ($event.target as HTMLInputElement).value })"
      @keydown.enter.prevent="onFindEnter"
    />
    <HoverHint :text="hint(COMMAND_IDS.findNext, 'Next match')">
      <Button
        type="button"
        variant="outline"
        size="xs"
        class="h-7 w-full"
        :disabled="!valid"
        @click="act('next')"
      >
        Find
      </Button>
    </HoverHint>
    <HoverHint :text="hint(COMMAND_IDS.findPrevious, 'Previous match')">
      <Button
        type="button"
        variant="outline"
        size="xs"
        class="h-7 w-full"
        :disabled="!valid"
        @click="act('previous')"
      >
        Find Prev
      </Button>
    </HoverHint>
    <HoverHint text="Close (Escape)">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Close find"
        @click="close"
      >
        <X />
      </Button>
    </HoverHint>
    <template v-if="bar?.replace === true">
      <input
        type="text"
        data-replace-input
        aria-label="Replace with"
        placeholder="Replace"
        spellcheck="false"
        autocomplete="off"
        class="col-start-3"
        :class="input"
        :value="spec.replace"
        @input="setFind({ replace: ($event.target as HTMLInputElement).value })"
        @keydown.enter.prevent="act('replace')"
      />
      <Button
        type="button"
        variant="outline"
        size="xs"
        class="h-7 w-full"
        :disabled="readOnly || !valid"
        @click="act('replace')"
      >
        Replace
      </Button>
      <Button
        type="button"
        variant="outline"
        size="xs"
        class="h-7 w-full"
        :disabled="readOnly || !valid"
        @click="act('replaceAll')"
      >
        Replace all
      </Button>
    </template>
    <p
      v-if="problem !== null"
      role="alert"
      class="col-span-4 col-start-3 text-destructive"
    >
      {{ problem }}
    </p>
    <p
      v-if="readOnly && bar?.replace === true"
      class="col-span-4 col-start-3 text-muted-foreground"
    >
      This file is read-only, so it cannot be changed here.
    </p>
  </div>
</template>
