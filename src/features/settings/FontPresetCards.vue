<script setup lang="ts">
import { Ellipsis, Search, X } from '@lucide/vue'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  useTemplateRef,
  watch,
} from 'vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createFontPreset,
  deleteFontPreset,
  duplicateFontPreset,
  renameFontPreset,
  suggestPresetCopyName,
  updateFontPresetFromCurrent,
} from '@/features/fontPresets/manage'
import {
  activeFontPreset,
  allFontPresets,
  fontPresetSlots,
  presetSlotKey,
} from '@/features/fontPresets/store'
import {
  applyDensity,
  type FontDensity,
  type FontPreset,
  type FontPresetId,
} from '@/lib/fontPresets'

/**
 * Clickable live specimen cards for built-in and custom Markdown font presets (P9.1-T38 to T40).
 * Includes a filter box (matching preset name and font names), contextual New / Save as new /
 * Update preset toolbar, inline creation form, capped scrollable 2-column grid, Built-in badges,
 * and per-card ellipsis menus (Duplicate, Reset overrides, Update from current, inline Rename,
 * Delete to Recycle Bin) using only design tokens.
 */
const { modelValue, customized, density } = defineProps<{
  /** The active preset id from `settings.fonts.preset`. */
  modelValue: FontPresetId
  /** True while any individual font or typography metric override is set. */
  customized: boolean
  /** Active typography density (`comfort` or `compact`) for the card size summary. */
  density: FontDensity
}>()

const emit = defineEmits<{
  select: [preset: FontPresetId]
}>()

const filter = ref('')

const activeKey = computed(() => presetSlotKey(modelValue))
const activeIsCustom = computed(() => !activeFontPreset.value.builtIn)
const threeColumnLayout = computed(() => allFontPresets.value.length >= 6)

const gridEl = useTemplateRef<HTMLElement>('gridEl')
const scrolling = ref(false)
let scrollTimer: ReturnType<typeof setTimeout> | undefined
let suppressScroll = false
let scrolledInitial = false

function onGridScroll(): void {
  if (suppressScroll) {
    suppressScroll = false
    return
  }
  scrolling.value = true
  if (scrollTimer !== undefined) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    scrolling.value = false
    scrollTimer = undefined
  }, 800)
}

function scrollActivePresetIntoView(): void {
  const grid = gridEl.value
  if (grid === null) return
  const activeCard = grid.querySelector<HTMLElement>('[data-font-preset-card][data-active="true"]')
  if (activeCard === null) return
  const gridRect = grid.getBoundingClientRect()
  const cardRect = activeCard.getBoundingClientRect()
  if (gridRect.height <= 0 || cardRect.height <= 0) return
  const cardTop = cardRect.top - gridRect.top + grid.scrollTop
  const cardBottom = cardRect.bottom - gridRect.top + grid.scrollTop
  let nextTop = grid.scrollTop
  if (cardTop < grid.scrollTop) {
    nextTop = Math.max(0, cardTop - 4)
  } else if (cardBottom > grid.scrollTop + gridRect.height) {
    nextTop = Math.max(0, cardBottom - gridRect.height + 4)
  }
  if (nextTop !== grid.scrollTop) {
    suppressScroll = true
    grid.scrollTop = nextTop
    // Chromium fires the scroll event on the next frame; keep suppression active across that frame
    // and fall back cleanly when no scroll event fires (e.g. jsdom).
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          suppressScroll = false
        })
      })
    } else {
      setTimeout(() => {
        suppressScroll = false
      }, 0)
    }
  }
  scrolledInitial = true
}

onMounted(async () => {
  await nextTick()
  scrollActivePresetIntoView()
})

watch(
  () => allFontPresets.value.length,
  async () => {
    if (scrolledInitial) return
    await nextTick()
    scrollActivePresetIntoView()
  },
)

onBeforeUnmount(() => {
  if (scrollTimer !== undefined) clearTimeout(scrollTimer)
})

const brokenSlots = computed(() => fontPresetSlots.value.filter((slot) => !slot.ok))

const filteredPresets = computed<readonly FontPreset[]>(() => {
  const words = filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return allFontPresets.value
  return allFontPresets.value.filter((preset) => {
    const hay =
      `${preset.label} ${preset.heading.name} ${preset.body.name} ${preset.code.name}`.toLowerCase()
    return words.every((word) => hay.includes(word))
  })
})

const filteredBroken = computed(() => {
  const words = filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return brokenSlots.value
  return brokenSlots.value.filter((slot) => {
    const hay = `${slot.id} ${slot.message}`.toLowerCase()
    return words.every((word) => hay.includes(word))
  })
})

const isActive = (preset: FontPreset): boolean => presetSlotKey(preset.id) === activeKey.value

function sizeSummary(preset: FontPreset): string {
  const effective = applyDensity(preset, density)
  return `${String(effective.size)}px / ${String(effective.lineHeight)}`
}

// ---- Focus hand-off from DropdownMenu to inline forms ----
let fieldTakesFocus = false

function keepFocusInField(event: Event): void {
  if (!fieldTakesFocus) return
  fieldTakesFocus = false
  event.preventDefault()
}

async function afterMenuClosed(): Promise<void> {
  await nextTick()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

// ---- Inline New / Duplicate / Save-as-new form ----
type FormMode =
  | { readonly kind: 'new' }
  | { readonly kind: 'save' }
  | { readonly kind: 'duplicate'; readonly ofId: string; readonly ofLabel: string }

const formMode = ref<FormMode | null>(null)
const formName = ref('')
const formFrom = ref('current')
const formError = ref<string | null>(null)
const formEl = useTemplateRef<HTMLFormElement>('formEl')
const busy = ref(false)

async function openForm(mode: FormMode, fromMenu = false): Promise<void> {
  if (fromMenu) fieldTakesFocus = true
  formMode.value = mode
  formError.value = null
  formFrom.value = 'current'
  if (mode.kind === 'new') formName.value = ''
  else if (mode.kind === 'save') formName.value = suggestPresetCopyName()
  else formName.value = suggestPresetCopyName(mode.ofId)
  if (fromMenu) await afterMenuClosed()
  else await nextTick()
  const field = formEl.value?.querySelector('input')
  field?.focus()
  field?.select()
}

function closeForm(): void {
  formMode.value = null
  formError.value = null
}

async function submitForm(): Promise<void> {
  const mode = formMode.value
  if (busy.value || mode === null) return
  busy.value = true
  try {
    const result =
      mode.kind === 'duplicate'
        ? await duplicateFontPreset(mode.ofId, formName.value)
        : mode.kind === 'save'
          ? await createFontPreset(formName.value, 'current')
          : await createFontPreset(formName.value, formFrom.value)
    if (result.ok) closeForm()
    else formError.value = result.why
  } finally {
    busy.value = false
  }
}

async function onUpdatePreset(id: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await updateFontPresetFromCurrent(id)
  } finally {
    busy.value = false
  }
}

// ---- Inline Rename on custom card ----
const renamingId = ref<string | null>(null)
const renameText = ref('')
const renameError = ref<string | null>(null)
const renameField = reactive<{ el: HTMLInputElement | null }>({ el: null })

function setRenameField(component: unknown): void {
  renameField.el = (component as { $el?: HTMLInputElement } | null)?.$el ?? null
}

async function startRename(preset: FontPreset): Promise<void> {
  fieldTakesFocus = true
  renamingId.value = preset.id
  renameText.value = preset.label
  renameError.value = null
  await afterMenuClosed()
  renameField.el?.focus()
  renameField.el?.select()
}

async function commitRename(preset: FontPreset): Promise<void> {
  if (renamingId.value !== preset.id || busy.value) return
  if (renameText.value.trim() === preset.label) {
    renamingId.value = null
    return
  }
  busy.value = true
  try {
    const done = await renameFontPreset(preset.id, renameText.value)
    if (done.ok) renamingId.value = null
    else renameError.value = done.why
  } finally {
    busy.value = false
  }
}

function cancelRename(): void {
  renamingId.value = null
  renameError.value = null
}

// ---- Delete confirmation dialog ----
const deleting = ref<{ readonly id: string; readonly label: string } | null>(null)
const deleteOpen = ref(false)

function askDelete(id: string, label: string): void {
  deleting.value = { id, label }
  deleteOpen.value = true
}

async function confirmDelete(): Promise<void> {
  const target = deleting.value
  if (target === null || busy.value) return
  busy.value = true
  try {
    await deleteFontPreset(target.id)
    deleteOpen.value = false
    deleting.value = null
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="@container flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="relative min-w-[12rem] flex-1">
        <Search
          class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          v-model="filter"
          type="search"
          placeholder="Filter presets or fonts…"
          aria-label="Filter font presets"
          class="h-8 pr-7 pl-8 text-xs"
          data-font-preset-filter
        />
        <button
          v-if="filter !== ''"
          type="button"
          aria-label="Clear preset filter"
          class="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          @click="filter = ''"
        >
          <X class="size-3.5" />
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <Button
          v-if="customized && activeIsCustom"
          type="button"
          variant="outline"
          size="sm"
          :disabled="busy"
          data-font-preset-update
          @click="onUpdatePreset(activeFontPreset.id)"
        >
          Update preset
        </Button>
        <Button
          v-if="customized"
          type="button"
          variant="outline"
          size="sm"
          :disabled="busy"
          data-font-preset-save-new
          @click="openForm({ kind: 'save' })"
        >
          Save as new
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="busy"
          data-font-preset-new
          @click="openForm({ kind: 'new' })"
        >
          New preset
        </Button>
      </div>
    </div>

    <form
      v-if="formMode !== null"
      ref="formEl"
      class="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 text-card-foreground"
      data-font-preset-form
      @submit.prevent="submitForm"
    >
      <div class="flex flex-wrap items-center gap-2">
        <label class="w-20 shrink-0 text-xs font-medium text-card-foreground">Name</label>
        <Input
          v-model="formName"
          type="text"
          placeholder="e.g. Studio Serif"
          aria-label="Preset name"
          :aria-invalid="formError !== null ? true : undefined"
          class="h-8 min-w-[10rem] flex-1"
          data-font-preset-name-input
          @keydown.esc.prevent="closeForm"
        />
      </div>
      <p
        v-if="formMode.kind === 'duplicate'"
        class="text-xs text-muted-foreground"
      >
        Creates a copy of {{ formMode.ofLabel }}.
      </p>
      <p
        v-else-if="formMode.kind === 'save'"
        class="text-xs text-muted-foreground"
      >
        Saves your current font and size overrides as a new custom preset.
      </p>
      <div
        v-else
        class="flex flex-wrap items-center gap-2"
      >
        <label class="w-20 shrink-0 text-xs font-medium text-card-foreground">Start from</label>
        <Select v-model="formFrom">
          <SelectTrigger
            class="h-8 min-w-[10rem] flex-1"
            aria-label="Start from preset"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current">Current settings</SelectItem>
            <SelectItem
              v-for="preset in allFontPresets"
              :key="preset.id"
              :value="preset.id"
            >
              {{ preset.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p
        v-if="formError !== null"
        role="alert"
        class="text-xs text-destructive"
        data-font-preset-form-error
      >
        {{ formError }}
      </p>
      <div class="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          @click="closeForm"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          :disabled="busy"
          data-font-preset-form-submit
        >
          {{ formMode.kind === 'new' ? 'Create' : 'Save' }}
        </Button>
      </div>
    </form>

    <div
      ref="gridEl"
      role="radiogroup"
      aria-label="Font preset"
      class="grid max-h-[27.5rem] grid-cols-1 gap-3 overflow-y-auto p-0.5 @[30rem]:grid-cols-2"
      :class="threeColumnLayout ? '@[46rem]:grid-cols-3' : undefined"
      :data-scrolling="scrolling ? 'true' : undefined"
      data-font-preset-cards
      @scroll="onGridScroll"
    >
      <div
        v-for="preset in filteredPresets"
        :key="preset.id"
        role="radio"
        tabindex="0"
        :aria-checked="isActive(preset)"
        :data-font-preset-card="preset.id"
        :data-active="isActive(preset) ? 'true' : undefined"
        :data-customized="isActive(preset) && customized ? 'true' : undefined"
        class="flex cursor-default flex-col rounded-lg border bg-card p-3 text-left text-card-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        :class="
          isActive(preset)
            ? 'border-primary ring-1 ring-primary/40'
            : 'border-border hover:border-foreground/30'
        "
        @click="renamingId === preset.id ? undefined : emit('select', preset.id)"
        @keydown.enter.self="emit('select', preset.id)"
        @keydown.space.self.prevent="emit('select', preset.id)"
      >
        <div class="flex items-center justify-between gap-1.5">
          <div
            v-if="renamingId === preset.id"
            class="flex min-w-0 flex-1 flex-col gap-1"
            @click.stop
          >
            <Input
              :ref="setRenameField"
              v-model="renameText"
              type="text"
              aria-label="Rename preset"
              :aria-invalid="renameError !== null ? true : undefined"
              class="h-7 text-xs"
              data-font-preset-rename-input
              @keydown.enter.prevent="commitRename(preset)"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename(preset)"
            />
            <p
              v-if="renameError !== null"
              role="alert"
              class="text-xs text-destructive"
              data-font-preset-rename-error
            >
              {{ renameError }}
            </p>
          </div>
          <span
            v-else
            class="min-w-0 truncate text-sm font-semibold text-card-foreground"
            data-font-preset-label
          >
            {{ preset.label }}
          </span>
          <div
            class="flex shrink-0 items-center gap-1"
            @click.stop
          >
            <span
              v-if="preset.builtIn"
              class="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              data-font-preset-builtin
            >
              Built-in
            </span>
            <span
              v-if="isActive(preset) && !customized"
              class="rounded-sm border border-success/50 bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success"
              data-font-preset-state="in-use"
            >
              In use
            </span>
            <span
              v-else-if="isActive(preset) && customized"
              class="rounded-sm border border-primary/50 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
              data-font-preset-state="customized"
            >
              Customized
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  :aria-label="`${preset.label} preset actions`"
                  data-font-preset-menu
                  @click.stop
                >
                  <Ellipsis class="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                @close-auto-focus="keepFocusInField"
              >
                <DropdownMenuItem
                  v-if="!preset.builtIn && isActive(preset) && customized"
                  data-font-preset-action="update"
                  @select="onUpdatePreset(preset.id)"
                >
                  Update from current
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="preset.builtIn && isActive(preset) && customized"
                  data-font-preset-action="reset"
                  @select="emit('select', preset.id)"
                >
                  Reset overrides
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-font-preset-action="duplicate"
                  @select="
                    openForm({ kind: 'duplicate', ofId: preset.id, ofLabel: preset.label }, true)
                  "
                >
                  Duplicate…
                </DropdownMenuItem>
                <template v-if="!preset.builtIn">
                  <DropdownMenuItem
                    data-font-preset-action="rename"
                    @select="startRename(preset)"
                  >
                    Rename…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    class="text-destructive focus:text-destructive"
                    data-font-preset-action="delete"
                    @select="askDelete(preset.id, preset.label)"
                  >
                    Delete
                  </DropdownMenuItem>
                </template>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div
          class="mt-2 flex flex-1 flex-col rounded-md border border-border bg-background p-2.5 text-foreground"
          data-font-preset-specimen
        >
          <div
            class="truncate text-base leading-snug font-semibold text-syntax-heading"
            :style="{ fontFamily: preset.heading.stack }"
            data-font-preset-heading
          >
            Markdown Notes
          </div>
          <p
            class="mt-1 text-sm leading-relaxed text-foreground"
            :style="{ fontFamily: preset.body.stack }"
            data-font-preset-body
          >
            Clear prose with
            <code
              class="rounded-sm border border-syntax-code-border bg-syntax-code-background px-0.5 text-syntax-code"
              :style="{
                fontFamily: preset.code.stack,
                fontSize: `${String(preset.inlineCodeScale)}em`,
              }"
              data-font-preset-inline-code
              >inline()</code
            >
            code.
          </p>
          <pre
            class="mt-2 overflow-hidden rounded-sm border border-syntax-code-border bg-syntax-code-background px-2 py-1.5 text-xs leading-snug text-syntax-code"
            :style="{ fontFamily: preset.code.stack }"
            data-font-preset-code-block
          ><code>const sum = (a, b) => a + b
return sum(1, 2) !== 0</code></pre>
        </div>
        <div
          class="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"
          data-font-preset-meta
        >
          <span class="min-w-0 truncate">
            {{ preset.heading.name }} · {{ preset.body.name }} · {{ preset.code.name }}
          </span>
          <span class="shrink-0 tabular-nums">{{ sizeSummary(preset) }}</span>
        </div>
      </div>

      <div
        v-for="broken in filteredBroken"
        :key="`broken:${broken.id}`"
        class="flex flex-col justify-between gap-2 rounded-lg border border-destructive/40 bg-card p-3 text-card-foreground"
        :data-font-preset-broken="broken.id"
      >
        <div>
          <div class="text-sm font-semibold text-card-foreground">{{ broken.id }}</div>
          <p class="mt-1 text-xs text-destructive">{{ broken.message }}</p>
        </div>
        <div class="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            @click="askDelete(broken.id, broken.id)"
          >
            Delete
          </Button>
        </div>
      </div>
    </div>

    <p
      v-if="filteredPresets.length === 0 && filteredBroken.length === 0"
      class="text-xs text-muted-foreground"
      data-font-preset-empty
    >
      No font preset matches "{{ filter.trim() }}".
    </p>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent data-font-preset-delete-dialog>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {{ deleting?.label }}?</AlertDialogTitle>
          <AlertDialogDescription>
            The preset file moves to the Recycle Bin.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-font-preset-delete-confirm
            @click="confirmDelete"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
