<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { describe, openInActivePane } from '@/documents/store'
import { indexStatus } from '@/features/index/status'
import { parseLineTarget } from '@/editor/goToLine'
import { getHost } from '@/platform'
import type { QuickOpenAnswer } from '@/platform/quickOpen'
import { commandForEvent, runCommand } from '@/workbench/commands'
import { focusActiveEditor } from '@/workbench/focus'
import { detectPlatform } from '@/workbench/keybinding'
import { changeSettingFromCommand } from '@/features/settings/quick'
import { startLineJump } from './lineJump'
import { commandRows, fileRow, segments, themeRows, type PickRow } from './rows'
import { closePalette, paletteMode, PICKER_KEY_IDS, type PaletteMode } from './state'

// One box for all the pickers: the file picker (Ctrl+P), the command palette (Ctrl+Shift+P), the
// theme list and Go to line (Ctrl+G), which has no list. Everything is reachable from the keyboard:
// type to narrow, arrows to move, Enter to choose, Escape to leave. The component loads the first
// time a picker opens.
const { mode } = defineProps<{ mode: PaletteMode }>()

const LIMIT = 50
const PAGE = 8

const input = useTemplateRef<HTMLInputElement>('input')
const list = useTemplateRef<HTMLElement>('list')
const query = ref('')
const selected = ref(0)
const answer = ref<QuickOpenAnswer | null>(null)
const failure = ref<string | null>(null)
const platform = detectPlatform()
// Made as the box opens, so it knows where the caret and the scroll were before the first jump.
const jump = mode === 'line' ? startLineJump() : null
let accepted = false

const rows = computed<PickRow[]>(() =>
  mode === 'files'
    ? (answer.value?.items ?? []).map(fileRow)
    : mode === 'themes'
      ? themeRows(query.value)
      : mode === 'commands'
        ? commandRows(query.value)
        : [],
)
const searching = computed(
  () => mode === 'files' && answer.value === null && failure.value === null,
)

const TEXTS: Record<PaletteMode, { title: string; placeholder: string }> = {
  files: { title: 'Go to file', placeholder: 'Type part of a file name' },
  commands: { title: 'Command palette', placeholder: 'Type the name of a command' },
  themes: { title: 'Switch theme', placeholder: 'Pick a theme' },
  line: { title: 'Go to line', placeholder: 'Line, or line:column' },
}
const title = computed(() => TEXTS[mode].title)
const placeholder = computed(() => TEXTS[mode].placeholder)
const hasList = mode !== 'line'
const optionId = (index: number): string => `palette-option-${index}`

/** What the Go to line box says under what is typed. */
function lineSummary(): string {
  const range = `Lines 1 to ${String(jump?.lines ?? 1)}`
  const typed = query.value.trim()
  return typed === '' || parseLineTarget(typed) !== null ? range : `Not a line number. ${range}`
}

const summary = computed(() => {
  if (mode === 'line') return lineSummary()
  if (failure.value !== null) return failure.value
  if (searching.value) return 'Reading the folders...'
  if (rows.value.length === 0) {
    if (mode === 'commands') return 'No command matches'
    if (mode === 'themes') return 'No theme matches'
    if (answer.value !== null && answer.value.indexed === 0) return 'The open folders have no files'
    return 'No file matches'
  }
  return ''
})

const footer = computed(() => {
  if (mode !== 'files' || answer.value === null) return ''
  const shown = rows.value.length
  const parts: string[] = []
  if (answer.value.total > shown) parts.push(`${shown} of ${answer.value.total} files`)
  if (answer.value.truncated) parts.push('only the first files of a very large folder are searched')
  return parts.join(', ')
})

let sequence = 0

/** Asks the index for the best files. An answer that arrives after a newer question is dropped. */
async function search(keep?: string): Promise<void> {
  const mine = ++sequence
  try {
    const host = await getHost()
    const result = await host.quickOpenQuery(query.value, LIMIT)
    if (mine !== sequence) return
    answer.value = result
    failure.value = null
    const at = keep === undefined ? -1 : result.items.findIndex((item) => item.path === keep)
    selected.value = at >= 0 ? at : 0
  } catch (error) {
    if (mine === sequence) failure.value = `Could not search the files: ${describe(error)}`
  }
}

onMounted(() => {
  input.value?.focus()
  if (mode === 'files') void search()
  // The theme list opens on the theme in use.
  if (mode === 'themes')
    selected.value = Math.max(
      0,
      rows.value.findIndex((row) => row.detail !== ''),
    )
})

// Opening the picker reads nothing: the index is already there. While a folder is being read for
// the first time it grows, so the list follows it, on the row the user is on.
watch(indexStatus, (now, before) => {
  if (mode === 'files' && (now.indexing || before.indexing)) {
    void search(rows.value[selected.value]?.key)
  }
})

watch(query, () => {
  selected.value = 0
  if (mode === 'files') void search()
  jump?.show(query.value)
})

// Left any other way than by Enter (Escape, its key again, a click outside, another picker), the
// Go to line box takes its jumps back.
onUnmounted(() => {
  if (jump === null || accepted) return
  jump.cancel()
  if (paletteMode.value === null) focusActiveEditor()
})

function acceptLine(): void {
  if (jump?.show(query.value) !== true) return
  accepted = true
  closePalette()
  focusActiveEditor()
}

watch(rows, (now) => {
  if (selected.value >= now.length) selected.value = Math.max(0, now.length - 1)
})

watch(selected, async () => {
  await nextTick()
  list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
})

async function accept(at: number): Promise<void> {
  if (mode === 'line') {
    acceptLine()
    return
  }
  const row = rows.value[at]
  if (row === undefined || row.disabled) return
  closePalette()
  try {
    if (mode === 'files') {
      await openInActivePane(row.key)
      // The tab may already have been the one shown, which wakes no editor (ISC-255).
      focusActiveEditor()
    } else if (mode === 'themes') await changeSettingFromCommand('theme', row.key)
    else await runCommand(row.key)
  } catch (error) {
    if (mode === 'files') reportError(`Could not open ${row.key}: ${describe(error)}`)
    else console.error(`Command "${row.key}" failed`, error)
  }
}

function move(by: number): void {
  const count = rows.value.length
  if (count === 0) return
  selected.value = (selected.value + by + count) % count
}

function page(by: number): void {
  const count = rows.value.length
  if (count === 0) return
  selected.value = Math.min(count - 1, Math.max(0, selected.value + by))
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  // The shortcuts of the other commands do nothing while a picker is open: they would act on a
  // document the user cannot see. Those that open a picker pass through to the app, so the same
  // key closes it or switches to the other one.
  const command = commandForEvent(event, platform)
  if (command !== undefined && !PICKER_KEY_IDS.has(command.id)) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      move(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      move(-1)
      break
    case 'PageDown':
      event.preventDefault()
      page(PAGE)
      break
    case 'PageUp':
      event.preventDefault()
      page(-PAGE)
      break
    case 'Enter':
      event.preventDefault()
      void accept(selected.value)
      break
    case 'Escape':
      event.preventDefault()
      closePalette()
      break
    case 'Tab':
      // Focus stays in the box; there is nowhere else to go.
      event.preventDefault()
      break
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex justify-center bg-background/40 px-3 pt-[12vh]"
    data-palette
    :data-mode="mode"
    @mousedown.self="closePalette"
  >
    <div
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      class="flex max-h-[60vh] w-[min(36rem,100%)] flex-col self-start overflow-hidden rounded-md border border-border bg-popover text-chrome text-popover-foreground shadow-lg"
    >
      <input
        ref="input"
        v-model="query"
        type="text"
        :role="hasList ? 'combobox' : undefined"
        :aria-label="hasList ? undefined : title"
        :aria-autocomplete="hasList ? 'list' : undefined"
        :aria-expanded="hasList ? 'true' : undefined"
        :aria-controls="hasList ? 'palette-list' : undefined"
        :aria-activedescendant="rows.length > 0 ? optionId(selected) : undefined"
        :placeholder="placeholder"
        spellcheck="false"
        autocomplete="off"
        data-palette-input
        class="w-full border-b border-border bg-transparent px-3 py-2 outline-none placeholder:text-muted-foreground"
        @keydown="onKeydown"
      />
      <ul
        v-if="hasList"
        id="palette-list"
        ref="list"
        role="listbox"
        :aria-label="title"
        class="min-h-0 flex-1 overflow-y-auto overscroll-none py-1"
      >
        <li
          v-for="(row, index) in rows"
          :id="optionId(index)"
          :key="row.key"
          role="option"
          :aria-selected="index === selected"
          :aria-disabled="row.disabled"
          data-palette-row
          class="flex items-baseline gap-3 px-3 py-1"
          :class="[
            index === selected ? 'bg-accent text-accent-foreground' : '',
            row.disabled ? 'text-muted-foreground' : '',
          ]"
          @mousemove="selected = index"
          @click="accept(index)"
        >
          <span class="shrink-0">
            <template
              v-for="(part, at) in segments(row.label, row.labelHits)"
              :key="at"
            >
              <b
                v-if="part.hit"
                class="font-semibold text-primary"
                >{{ part.text }}</b
              >
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
          <span
            class="min-w-0 flex-1 truncate text-muted-foreground"
            :class="mode !== 'files' ? 'text-right' : ''"
          >
            <template
              v-for="(part, at) in segments(row.detail, row.detailHits)"
              :key="at"
            >
              <b
                v-if="part.hit"
                class="font-semibold text-primary"
                >{{ part.text }}</b
              >
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
          <span
            v-if="row.state !== null"
            data-palette-state
            class="shrink-0 text-xs"
            :class="row.state ? 'font-medium text-foreground' : 'text-muted-foreground'"
            >{{ row.state ? 'On' : 'Off' }}</span
          >
        </li>
      </ul>
      <p
        v-if="summary !== ''"
        role="status"
        data-palette-summary
        class="px-3 py-2 text-muted-foreground"
      >
        {{ summary }}
      </p>
      <p
        v-if="footer !== ''"
        data-palette-footer
        class="border-t border-border px-3 py-1 text-muted-foreground"
      >
        {{ footer }}
      </p>
    </div>
  </div>
</template>
