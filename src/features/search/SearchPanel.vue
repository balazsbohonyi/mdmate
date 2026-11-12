<script setup lang="ts">
import { CaseSensitive, Ellipsis, Regex, Square, WholeWord } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import HoverHint from '@/components/HoverHint.vue'
import { Button } from '@/components/ui/button'
import {
  baseName,
  FALLBACK_VIEWPORT_HEIGHT,
  ROW_HEIGHT,
  visibleWindow,
} from '@/features/tree/model'
import { toggleVariant } from '@/lib/toggle'
import { MAX_SEARCH_HITS } from '@/platform'
import { focusActiveEditor } from '@/workbench/focus'
import { relativePathOf } from '@/workbench/tabMenu'
import {
  cancelSearch,
  filtersOpen,
  hitAt,
  hitTotal,
  openHit,
  rowCount,
  rowOfHit,
  rowSlice,
  rowsVersion,
  runSearch,
  searchFocusRequest,
  searchOptions,
  searchState,
  selectedHit,
  setSearchOptions,
  takeSearchFocusRequest,
} from './store'
import { scopeText } from './folderFilter'

const options = computed(() => searchOptions.value)
const state = computed(() => searchState.value)

// ---- the query box ----

const box = ref<HTMLInputElement | null>(null)
const scroller = ref<HTMLElement | null>(null)

function focusBox(): void {
  void nextTick(() => {
    box.value?.focus()
    box.value?.select()
  })
}

onMounted(() => {
  if (takeSearchFocusRequest()) focusBox()
})
watch(searchFocusRequest, () => {
  if (takeSearchFocusRequest()) focusBox()
})

function onBoxKeydown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.altKey || event.metaKey) return
  if (event.key === 'Enter') {
    event.preventDefault()
    void runSearch()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    if (state.value.phase === 'searching') void cancelSearch()
    else focusActiveEditor()
  } else if (event.key === 'ArrowDown' && hitTotal() > 0) {
    // From the box into the list, as in the tree's neighbours.
    event.preventDefault()
    if (selectedHit.value < 0) selectedHit.value = 0
    scroller.value?.focus()
    scrollToSelected()
  }
}

/** The Stop button ends the search; the list keeps what was found, and the caret goes back to the box. */
function onStop(): void {
  void cancelSearch()
  focusBox()
}

/** Enter and Escape in "files to include" and "files to exclude", as in the query box. */
function onFieldKeydown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.altKey || event.metaKey) return
  if (event.key === 'Enter') {
    event.preventDefault()
    void runSearch()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    if (state.value.phase === 'searching') void cancelSearch()
    else focusActiveEditor()
  }
}

/** A pattern box is marked when the last answer says its pattern is the problem. */
const badField = (field: 'include' | 'exclude'): boolean =>
  state.value.phase === 'failed' && state.value.errorField === field

const field =
  'h-7 w-full min-w-0 rounded-sm border border-input bg-background px-2 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring aria-invalid:border-destructive'

// ---- the summary line ----

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

const summary = computed(() => {
  const current = state.value
  if (current.phase === 'idle') return ''
  if (current.phase === 'failed') return current.message ?? ''
  const found = hitTotal()
  void rowsVersion.value
  if (current.phase === 'searching') {
    return `Searching... ${plural(current.scanned, 'file', 'files')} read, ${plural(found, 'result', 'results')}`
  }
  const done = current.summary
  const files = done?.files ?? 0
  // Where it looked is part of the answer: a pattern left in a box limits every search.
  const where = current.scope === '' ? '' : ` · ${current.scope}`
  if (done?.stopped === true) {
    return `Search stopped. ${plural(found, 'result', 'results')} so far${where}`
  }
  if (found === 0) return `No results in ${plural(current.scanned, 'file', 'files')}${where}`
  return `${plural(found, 'result', 'results')} in ${plural(files, 'file', 'files')}${where}`
})

/** Before a search, the line shows where the next one would look. */
const idleLine = computed(() => {
  const scope = scopeText(options.value.include, options.value.exclude)
  return scope === '' ? 'Press Enter to search' : `Press Enter to search · ${scope}`
})

/** A pattern is in a box that is folded away, so it limits searches without showing. */
const hiddenFilter = computed(
  () =>
    !filtersOpen.value &&
    (options.value.include.trim() !== '' || options.value.exclude.trim() !== ''),
)

const notes = computed(() => {
  const done = state.value.summary
  const out: string[] = []
  if (done?.truncated === true) {
    out.push(`Only the first ${MAX_SEARCH_HITS.toLocaleString('en-US')} results are listed.`)
  }
  if (done !== null && done.skipped > 0) {
    out.push(`${plural(done.skipped, 'file', 'files')} could not be read.`)
  }
  return out
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
onBeforeUnmount(() => {
  observer?.disconnect()
})

// The list grows in place; reading `rowsVersion` is how these hear that it did.
const total = computed(() => {
  void rowsVersion.value
  return rowCount()
})
const range = computed(() => visibleWindow(scrollTop.value, viewportHeight.value, total.value))
const shown = computed(() => {
  void rowsVersion.value
  return rowSlice(range.value.start, range.value.end).map((row, offset) => ({
    row,
    top: (range.value.start + offset) * ROW_HEIGHT,
  }))
})

function onScroll(): void {
  scrollTop.value = scroller.value?.scrollTop ?? 0
}

/** Scrolls just far enough for the selected hit to show. */
function scrollToSelected(): void {
  const element = scroller.value
  if (element === null || selectedHit.value < 0) return
  const at = rowOfHit(selectedHit.value)
  if (at < 0) return
  const top = at * ROW_HEIGHT
  const height = element.clientHeight > 0 ? element.clientHeight : viewportHeight.value
  let next = element.scrollTop
  if (top < next) next = top
  else if (top + ROW_HEIGHT > next + height) next = top + ROW_HEIGHT - height
  if (next !== element.scrollTop) element.scrollTop = next
  scrollTop.value = next
}

// ---- the keyboard and the mouse, as in the tree ----

function select(index: number): void {
  const total = hitTotal()
  if (total === 0) return
  selectedHit.value = Math.min(Math.max(index, 0), total - 1)
  scrollToSelected()
}

const page = (): number =>
  Math.max(1, Math.floor((scroller.value?.clientHeight ?? viewportHeight.value) / ROW_HEIGHT) - 1)

function onKeydown(event: KeyboardEvent): void {
  if (event.target !== scroller.value) return
  // A key with Ctrl, Alt or Meta is a shortcut of the app and passes.
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
  const at = selectedHit.value
  switch (event.key) {
    case 'ArrowDown':
      select(at + 1)
      break
    case 'ArrowUp':
      if (at <= 0) box.value?.focus()
      else select(at - 1)
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
      select(hitTotal() - 1)
      break
    case 'Enter': {
      if (event.repeat) break
      const hit = hitAt(at)
      if (hit !== undefined) void openHit(hit, { focusEditor: true })
      break
    }
    default:
      return
  }
  // The arrows and the page keys would scroll the list; the selection moves instead.
  event.preventDefault()
}

function onRowClick(event: MouseEvent, index: number): void {
  selectedHit.value = index
  // The second click of a double click: the first one already showed the file.
  if (event.detail >= 2) return
  const hit = hitAt(index)
  if (hit !== undefined) void openHit(hit)
}

function onRowDoubleClick(index: number): void {
  const hit = hitAt(index)
  if (hit !== undefined) void openHit(hit, { focusEditor: true })
}

// ---- drawing ----

function whereOf(path: string): string {
  const relative = relativePathOf(path)
  return relative.slice(0, relative.length - baseName(relative).length)
}

/** A hit's text in three pieces, so the match can be drawn marked. */
function pieces(text: string, start: number, length: number): readonly [string, string, string] {
  return [text.slice(0, start), text.slice(start, start + length), text.slice(start + length)]
}

const activeId = computed(() =>
  selectedHit.value < 0 ? undefined : `search-hit-${String(selectedHit.value)}`,
)
</script>

<template>
  <section
    aria-label="Search"
    data-search
    class="flex min-h-0 flex-1 flex-col text-chrome"
  >
    <div
      role="search"
      class="relative flex shrink-0 flex-col gap-1 border-b border-sidebar-border px-2 py-2"
    >
      <div class="relative">
        <input
          ref="box"
          type="text"
          data-search-input
          aria-label="Search in folders"
          placeholder="Search"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          :value="options.query"
          class="h-8 w-full min-w-0 rounded-sm border border-input bg-background pr-[84px] pl-2 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
          @input="setSearchOptions({ query: ($event.target as HTMLInputElement).value })"
          @keydown="onBoxKeydown"
        />
        <div class="absolute inset-y-0 right-1 flex items-center gap-0.5">
          <HoverHint text="Match case">
            <Button
              type="button"
              :variant="toggleVariant(options.caseSensitive)"
              size="icon-xs"
              aria-label="Match case"
              data-search-case
              :aria-pressed="options.caseSensitive"
              @click="setSearchOptions({ caseSensitive: !options.caseSensitive })"
            >
              <CaseSensitive class="size-[18px]" />
            </Button>
          </HoverHint>
          <HoverHint text="Whole word">
            <Button
              type="button"
              :variant="toggleVariant(options.wholeWord)"
              size="icon-xs"
              aria-label="Whole word"
              data-search-word
              :aria-pressed="options.wholeWord"
              @click="setSearchOptions({ wholeWord: !options.wholeWord })"
            >
              <WholeWord class="size-[18px]" />
            </Button>
          </HoverHint>
          <HoverHint text="Regular expression">
            <Button
              type="button"
              :variant="toggleVariant(options.regexp)"
              size="icon-xs"
              aria-label="Regular expression"
              data-search-regexp
              :aria-pressed="options.regexp"
              @click="setSearchOptions({ regexp: !options.regexp })"
            >
              <Regex class="size-[18px]" />
            </Button>
          </HoverHint>
        </div>
      </div>
      <div class="flex justify-end">
        <HoverHint text="Toggle search details">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            :aria-label="
              hiddenFilter ? 'Toggle search details (a pattern is set)' : 'Toggle search details'
            "
            data-search-filters-toggle
            :aria-expanded="filtersOpen"
            class="relative"
            :class="filtersOpen ? 'bg-accent text-accent-foreground' : ''"
            @click="filtersOpen = !filtersOpen"
          >
            <Ellipsis />
            <span
              v-if="hiddenFilter"
              data-search-filters-dot
              class="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
            />
          </Button>
        </HoverHint>
      </div>
      <template v-if="filtersOpen">
        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          files to include
          <input
            type="text"
            data-search-include
            aria-label="Files to include"
            placeholder="e.g. *.md, ./docs"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            :value="options.include"
            :aria-invalid="badField('include')"
            :class="field"
            @input="setSearchOptions({ include: ($event.target as HTMLInputElement).value })"
            @keydown="onFieldKeydown"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-muted-foreground">
          files to exclude
          <input
            type="text"
            data-search-exclude
            aria-label="Files to exclude"
            placeholder="e.g. **/build, *.txt"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            :value="options.exclude"
            :aria-invalid="badField('exclude')"
            :class="field"
            @input="setSearchOptions({ exclude: ($event.target as HTMLInputElement).value })"
            @keydown="onFieldKeydown"
          />
        </label>
      </template>
      <div class="flex min-h-6 items-center justify-between gap-2">
        <div
          data-search-summary
          aria-live="polite"
          class="min-w-0 text-xs"
          :class="state.phase === 'failed' ? 'text-destructive' : 'text-muted-foreground'"
        >
          {{ summary || idleLine }}
        </div>
        <HoverHint
          v-if="state.phase === 'searching'"
          text="Stop the search (Esc)"
        >
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-label="Stop search"
            data-search-stop
            class="shrink-0"
            @click="onStop"
          >
            <Square />
            Stop
          </Button>
        </HoverHint>
      </div>
      <div
        v-if="state.phase === 'searching'"
        data-search-progress
        role="progressbar"
        aria-label="Searching"
        class="search-progress absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
      >
        <div class="search-progress-bar h-full w-1/3 bg-primary" />
      </div>
    </div>
    <div
      ref="scroller"
      role="listbox"
      aria-label="Search results"
      data-search-results
      tabindex="0"
      :aria-activedescendant="activeId"
      class="group/results min-h-0 flex-1 overflow-x-hidden overflow-y-auto outline-none select-none"
      @scroll.passive="onScroll"
      @keydown="onKeydown"
    >
      <div
        class="relative w-full"
        :style="{ height: `${String(total * ROW_HEIGHT)}px` }"
      >
        <template
          v-for="{ row, top } in shown"
          :key="row.kind === 'file' ? `f:${row.path}:${String(top)}` : `h:${String(row.index)}`"
        >
          <HoverHint
            v-if="row.kind === 'file'"
            :text="row.path"
            side="right"
          >
            <div
              role="presentation"
              data-search-file
              class="absolute right-0 left-0 flex items-center gap-2 px-3"
              :style="{ top: `${String(top)}px`, height: `${String(ROW_HEIGHT)}px` }"
            >
              <span class="shrink-0 font-medium">{{ baseName(row.path) }}</span>
              <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{{
                whereOf(row.path)
              }}</span>
              <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{{
                row.count
              }}</span>
            </div>
          </HoverHint>
          <div
            v-else
            :id="`search-hit-${String(row.index)}`"
            role="option"
            data-search-hit
            :data-line="row.hit.line"
            :aria-selected="row.index === selectedHit"
            class="absolute right-0 left-0 flex cursor-default items-center gap-2 pr-3 pl-6"
            :class="
              row.index === selectedHit
                ? 'bg-sidebar-accent/60 text-sidebar-accent-foreground group-focus-within/results:bg-sidebar-accent'
                : 'hover:bg-sidebar-accent/50'
            "
            :style="{ top: `${String(top)}px`, height: `${String(ROW_HEIGHT)}px` }"
            @click="onRowClick($event, row.index)"
            @dblclick="onRowDoubleClick(row.index)"
          >
            <span
              class="min-w-8 shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums"
              >{{ row.hit.line }}</span
            >
            <span class="min-w-0 truncate whitespace-pre"
              ><template
                v-for="(part, at) in pieces(row.hit.text, row.hit.start, row.hit.length)"
                :key="at"
                ><span
                  v-if="at === 1"
                  data-search-match
                  class="rounded-sm bg-find-match"
                  >{{ part }}</span
                ><template v-else>{{ part }}</template></template
              ></span
            >
          </div>
        </template>
      </div>
    </div>
    <div
      v-if="notes.length > 0"
      class="shrink-0 border-t border-sidebar-border px-3 py-2 text-xs text-muted-foreground"
    >
      <p
        v-for="note in notes"
        :key="note"
        data-search-note
      >
        {{ note }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.search-progress-bar {
  animation: search-progress 1.1s ease-in-out infinite;
}
@keyframes search-progress {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(300%);
  }
}
/* No motion asked for: a still bar says the same thing. */
@media (prefers-reduced-motion: reduce) {
  .search-progress-bar {
    animation: none;
    width: 100%;
    opacity: 0.5;
  }
}
</style>
