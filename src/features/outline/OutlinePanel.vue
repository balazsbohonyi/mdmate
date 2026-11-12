<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { headingText } from '@/editor/headingSlug'
import { FALLBACK_VIEWPORT_HEIGHT, ROW_HEIGHT, visibleWindow } from '@/features/tree/model'
import { MAX_OUTLINE_HEADINGS } from '@/platform'
import {
  openHeading,
  outlineFocusRequest,
  outlineState,
  selectedHeading,
  startOutline,
  stopOutline,
  takeOutlineFocusRequest,
} from './store'

const state = computed(() => outlineState.value)
const headings = computed(() => state.value.headings)
const scroller = ref<HTMLElement | null>(null)

// ---- following the document: only while this panel is on screen ----

onMounted(() => {
  startOutline()
  if (takeOutlineFocusRequest()) focusList()
})
onBeforeUnmount(() => {
  stopOutline()
  observer?.disconnect()
})
watch(outlineFocusRequest, () => {
  if (takeOutlineFocusRequest()) focusList()
})

function focusList(): void {
  void nextTick(() => scroller.value?.focus())
}

// ---- what to say when there is no list ----

const message = computed(() => {
  switch (state.value.phase) {
    case 'unsupported':
      return 'This file is not Markdown, so it has no outline.'
    case 'failed':
      return `The outline could not be read. ${state.value.message ?? ''}`.trim()
    case 'idle':
      return 'Open a Markdown file to see its headings.'
    case 'loading':
      return headings.value.length === 0 ? 'Reading headings...' : null
    case 'ready':
      return headings.value.length === 0 ? 'This file has no headings.' : null
  }
})

// ---- the list: only the rows on screen exist ----

const scrollTop = ref(0)
const viewportHeight = ref(FALLBACK_VIEWPORT_HEIGHT)
let observer: ResizeObserver | undefined

onMounted(() => {
  const element = scroller.value
  if (element === null || typeof ResizeObserver === 'undefined') return
  const measure = (): void => {
    // Nothing has a size in a test DOM; keep the fallback there.
    if (element.clientHeight > 0) viewportHeight.value = element.clientHeight
  }
  measure()
  observer = new ResizeObserver(measure)
  observer.observe(element)
})

const total = computed(() => headings.value.length)
const range = computed(() => visibleWindow(scrollTop.value, viewportHeight.value, total.value))

// A heading's words as the page shows them (`**bold**` is bold, a link is its text), made for the
// rows on screen only and kept while they stay there.
const rendered = new Map<string, string>()
function shownText(source: string): string {
  let text = rendered.get(source)
  if (text === undefined) {
    if (rendered.size > 400) rendered.clear()
    text = headingText(source)
    rendered.set(source, text)
  }
  return text === '' ? '(empty heading)' : text
}

const shown = computed(() =>
  headings.value.slice(range.value.start, range.value.end).map((heading, offset) => ({
    heading,
    index: range.value.start + offset,
    top: (range.value.start + offset) * ROW_HEIGHT,
  })),
)

function onScroll(): void {
  scrollTop.value = scroller.value?.scrollTop ?? 0
}

/** Scrolls just far enough for the selected heading to show. */
function scrollToSelected(): void {
  const element = scroller.value
  if (element === null || selectedHeading.value < 0) return
  const top = selectedHeading.value * ROW_HEIGHT
  const height = element.clientHeight > 0 ? element.clientHeight : viewportHeight.value
  let next = element.scrollTop
  if (top < next) next = top
  else if (top + ROW_HEIGHT > next + height) next = top + ROW_HEIGHT - height
  if (next !== element.scrollTop) element.scrollTop = next
  scrollTop.value = next
}

// ---- the keyboard and the mouse, as in the tree ----

function select(index: number): void {
  if (total.value === 0) return
  selectedHeading.value = Math.min(Math.max(index, 0), total.value - 1)
  scrollToSelected()
}

const page = (): number => {
  // An element with no size (a test DOM, a hidden panel) falls back to the last measured height.
  const height = scroller.value?.clientHeight
  return Math.max(
    1,
    Math.floor(
      (height === undefined || height === 0 ? viewportHeight.value : height) / ROW_HEIGHT,
    ) - 1,
  )
}

function onKeydown(event: KeyboardEvent): void {
  if (event.target !== scroller.value) return
  // A key with Ctrl, Alt or Meta is a shortcut of the app and passes.
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
  const at = selectedHeading.value
  switch (event.key) {
    case 'ArrowDown':
      select(at + 1)
      break
    case 'ArrowUp':
      select(at < 0 ? 0 : at - 1)
      break
    case 'PageDown':
      select(at + page())
      break
    case 'PageUp':
      select(at - page())
      break
    case 'Home':
      select(0)
      break
    case 'End':
      select(total.value - 1)
      break
    case 'Enter':
      if (!event.repeat && at >= 0) void openHeading(at, { focusEditor: true })
      break
    default:
      return
  }
  // The arrows and the page keys would scroll the list; the selection moves instead.
  event.preventDefault()
}

function onRowClick(event: MouseEvent, index: number): void {
  selectedHeading.value = index
  // The second click of a double click: the first one already moved the caret.
  if (event.detail >= 2) return
  void openHeading(index)
}

function onRowDoubleClick(index: number): void {
  void openHeading(index, { focusEditor: true })
}

const activeId = computed(() =>
  selectedHeading.value < 0 ? undefined : `outline-heading-${String(selectedHeading.value)}`,
)
</script>

<template>
  <section
    aria-label="Outline"
    data-outline
    class="flex min-h-0 flex-1 flex-col text-chrome"
  >
    <p
      v-if="message !== null"
      data-outline-message
      class="px-3 py-3 text-xs text-muted-foreground"
    >
      {{ message }}
    </p>
    <div
      ref="scroller"
      role="listbox"
      aria-label="Headings"
      data-outline-list
      tabindex="0"
      :aria-activedescendant="activeId"
      class="group/outline min-h-0 flex-1 overflow-x-hidden overflow-y-auto outline-none select-none"
      :class="total === 0 ? 'hidden' : ''"
      @scroll.passive="onScroll"
      @keydown="onKeydown"
    >
      <div
        class="relative w-full"
        :style="{ height: `${String(total * ROW_HEIGHT)}px` }"
      >
        <div
          v-for="{ heading, index, top } in shown"
          :id="`outline-heading-${String(index)}`"
          :key="index"
          role="option"
          data-outline-heading
          :data-level="heading.level"
          :data-line="heading.line"
          :aria-selected="index === selectedHeading"
          class="absolute right-0 left-0 flex cursor-default items-center pr-3"
          :class="[
            index === selectedHeading
              ? 'bg-sidebar-accent/60 text-sidebar-accent-foreground group-focus-within/outline:bg-sidebar-accent'
              : 'hover:bg-sidebar-accent/50',
            heading.level === 1 ? 'font-medium' : '',
          ]"
          :style="{
            top: `${String(top)}px`,
            height: `${String(ROW_HEIGHT)}px`,
            paddingLeft: `${String(12 + (heading.level - 1) * 12)}px`,
          }"
          @click="onRowClick($event, index)"
          @dblclick="onRowDoubleClick(index)"
        >
          <span class="min-w-0 truncate">{{ shownText(heading.text) }}</span>
        </div>
      </div>
    </div>
    <p
      v-if="state.truncated"
      data-outline-note
      class="shrink-0 border-t border-sidebar-border px-3 py-2 text-xs text-muted-foreground"
    >
      Only the first {{ MAX_OUTLINE_HEADINGS.toLocaleString('en-US') }} headings are listed.
    </p>
  </section>
</template>
