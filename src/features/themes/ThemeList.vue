<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
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
import { Input } from '@/components/ui/input'
import { requestSettingChange } from '@/features/settings/store'
import { BUILT_IN_IDS, BUILT_IN_THEMES } from '@/lib/builtinThemes'
import { settings } from '@/lib/settings'
import { effectiveTokens, slotKey, SYSTEM_THEME } from '@/lib/themes'
import {
  createTheme,
  deleteTheme,
  duplicateTheme,
  editTheme,
  renameTheme,
  type StartFrom,
} from './customize'
import { themeSlots } from './store'

/**
 * Every theme there is, in one list: the built-in ones first, then the user's own by name. Each row
 * shows the name, what it is based on, five swatches and an "In use" mark, and offers what can be
 * done to it: Select, Edit colors, Rename, Duplicate and Delete for a theme of the user's; Select
 * and Duplicate for a built-in one. New theme makes one from a name and a palette. Loaded with the
 * Settings screen (settings-lazy).
 */

interface Row {
  /** What the theme setting holds to select it. */
  readonly id: string
  readonly label: string
  readonly kind: 'builtin' | 'system' | 'user' | 'broken'
  /** A line under the name: what it is, or what is wrong with the file. */
  readonly note: string
  /** Five colors that stand for the theme, or none (System follows the operating system). */
  readonly swatches: readonly string[]
}

const SWATCH_TOKENS = ['background', 'card', 'foreground', 'primary', 'accent'] as const

const swatchesOf = (colors: ReadonlyMap<string, string>): string[] =>
  SWATCH_TOKENS.map((token) => colors.get(token)).filter(
    (color): color is string => color !== undefined,
  )

const rows = computed<readonly Row[]>(() => {
  const list: Row[] = BUILT_IN_IDS.map((id) => ({
    id,
    label: BUILT_IN_THEMES[id].label,
    kind: 'builtin' as const,
    note: 'Built in',
    swatches: swatchesOf(effectiveTokens({ palette: id, overrides: new Map() })),
  }))
  list.push({
    id: SYSTEM_THEME,
    label: 'System',
    kind: 'system',
    note: 'Built in. Follows the operating system, Dark or Light.',
    swatches: [],
  })
  const own: Row[] = []
  for (const slot of themeSlots.value) {
    if (slot.ok) {
      const { id, label, base, colors } = slot.theme
      own.push({
        id,
        label,
        kind: 'user',
        note: `Based on ${BUILT_IN_THEMES[base].label}`,
        swatches: swatchesOf(effectiveTokens({ palette: base, overrides: colors })),
      })
    } else {
      own.push({ id: slot.id, label: slot.id, kind: 'broken', note: slot.message, swatches: [] })
    }
  }
  own.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  return [...list, ...own]
})

const inUse = (row: Row): boolean => slotKey(settings.theme) === slotKey(row.id)

// ---- New theme ----
const FROM_CHOICES: readonly { readonly value: StartFrom; readonly label: string }[] = [
  ...BUILT_IN_IDS.map((id) => ({ value: id, label: BUILT_IN_THEMES[id].label })),
  { value: 'current', label: 'The theme in use' },
]
const creating = ref(false)
const newName = ref('')
const newFrom = ref<StartFrom>('dark')
const newError = ref<string | null>(null)
const busy = ref(false)

function openNew(): void {
  creating.value = true
  newName.value = ''
  newError.value = null
  newFrom.value = 'dark'
}

async function create(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const made = await createTheme(newName.value, newFrom.value)
    if (made.ok) creating.value = false
    else newError.value = made.why
  } finally {
    busy.value = false
  }
}

// ---- Rename ----
const renaming = ref<string | null>(null)
const renameText = ref('')
const renameError = ref<string | null>(null)
const renameField = reactive<{ el: HTMLInputElement | null }>({ el: null })

async function startRename(row: Row): Promise<void> {
  renaming.value = row.id
  renameText.value = row.label
  renameError.value = null
  await nextTick()
  renameField.el?.focus()
  renameField.el?.select()
}

async function commitRename(row: Row): Promise<void> {
  if (renaming.value !== row.id || busy.value) return
  if (renameText.value.trim() === row.label) {
    renaming.value = null
    return
  }
  busy.value = true
  try {
    const done = await renameTheme(row.id, renameText.value)
    if (done.ok) renaming.value = null
    else renameError.value = done.why
  } finally {
    busy.value = false
  }
}

function cancelRename(): void {
  renaming.value = null
  renameError.value = null
}

function setRenameField(component: unknown): void {
  renameField.el = (component as { $el?: HTMLInputElement } | null)?.$el ?? null
}

// ---- Delete ----
/** The row the question is about; kept while the dialog closes, so Delete can still read it. */
const deleting = ref<Row | null>(null)
const deleteOpen = ref(false)

function askDelete(row: Row): void {
  deleting.value = row
  deleteOpen.value = true
}

async function confirmDelete(): Promise<void> {
  const row = deleting.value
  if (row !== null) await deleteTheme(row.id)
}

const select = (row: Row): void => {
  void requestSettingChange('theme', row.id)
}
</script>

<template>
  <section
    aria-label="Themes"
    data-theme-list
  >
    <div class="mt-2 flex flex-wrap items-center gap-3">
      <p class="min-w-0 flex-1 text-chrome text-muted-foreground">
        Every theme there is. Select one to use it, or make your own: a new theme starts from a
        palette you pick, and its colors are yours to change below.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-theme-new
        @click="openNew"
      >
        New theme
      </Button>
    </div>

    <form
      v-if="creating"
      class="mt-3 grid gap-3 rounded-lg border border-border bg-card p-3"
      data-theme-new-form
      @submit.prevent="create"
      @keydown.escape="creating = false"
    >
      <label class="grid gap-1 text-sm text-foreground">
        Name
        <Input
          v-model="newName"
          placeholder="My theme"
          aria-label="New theme name"
          :aria-invalid="newError !== null ? true : undefined"
          data-theme-new-name
        />
      </label>
      <div
        class="grid gap-1 text-sm text-foreground"
        role="group"
        aria-label="Start from"
      >
        <span>Start from</span>
        <div class="flex flex-wrap gap-2">
          <Button
            v-for="choice in FROM_CHOICES"
            :key="choice.value"
            type="button"
            :variant="newFrom === choice.value ? 'secondary' : 'outline'"
            :aria-pressed="newFrom === choice.value"
            :data-theme-new-from="choice.value"
            @click="newFrom = choice.value"
          >
            {{ choice.label }}
          </Button>
        </div>
      </div>
      <p
        v-if="newError !== null"
        class="text-sm text-destructive"
        role="alert"
        data-theme-new-error
      >
        {{ newError }}
      </p>
      <div class="flex gap-2">
        <Button
          type="submit"
          :disabled="busy"
          data-theme-new-create
        >
          Create
        </Button>
        <Button
          type="button"
          variant="ghost"
          data-theme-new-cancel
          @click="creating = false"
        >
          Cancel
        </Button>
      </div>
    </form>

    <ul class="mt-3">
      <li
        v-for="row in rows"
        :key="row.id"
        class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border py-2"
        :data-theme-item="row.id"
        :data-theme-in-use="inUse(row) ? 'true' : undefined"
      >
        <div class="min-w-0 flex-1 basis-56">
          <template v-if="renaming === row.id">
            <Input
              :ref="setRenameField"
              v-model="renameText"
              aria-label="Theme name"
              :aria-invalid="renameError !== null ? true : undefined"
              data-theme-rename-input
              @keydown.enter.prevent="commitRename(row)"
              @keydown.escape.stop="cancelRename"
              @blur="commitRename(row)"
            />
            <p
              v-if="renameError !== null"
              class="mt-1 text-sm text-destructive"
              role="alert"
              data-theme-rename-error
            >
              {{ renameError }}
            </p>
          </template>
          <template v-else>
            <div class="flex items-center gap-2">
              <span
                class="truncate text-sm font-medium text-foreground"
                data-theme-name
              >
                {{ row.label }}
              </span>
              <span
                v-if="inUse(row)"
                class="shrink-0 rounded-full bg-primary/15 px-2 text-xs text-primary"
                data-theme-in-use-mark
              >
                In use
              </span>
            </div>
            <p class="text-xs text-muted-foreground">{{ row.note }}</p>
          </template>
        </div>
        <div
          v-if="row.swatches.length > 0"
          class="flex shrink-0 gap-1"
          aria-hidden="true"
          data-theme-swatches
        >
          <span
            v-for="(color, at) in row.swatches"
            :key="at"
            class="size-4 rounded-sm border border-border"
            :style="{ backgroundColor: color }"
          />
        </div>
        <div class="flex shrink-0 flex-wrap gap-1">
          <Button
            v-if="!inUse(row) && row.kind !== 'broken'"
            type="button"
            variant="outline"
            size="xs"
            data-theme-select
            @click="select(row)"
          >
            Select
          </Button>
          <Button
            v-if="row.kind === 'user'"
            type="button"
            variant="outline"
            size="xs"
            data-theme-edit
            @click="editTheme(row.id)"
          >
            Edit colors
          </Button>
          <Button
            v-if="row.kind === 'user'"
            type="button"
            variant="outline"
            size="xs"
            data-theme-rename
            @click="startRename(row)"
          >
            Rename
          </Button>
          <Button
            v-if="row.kind !== 'broken'"
            type="button"
            variant="outline"
            size="xs"
            data-theme-duplicate
            @click="duplicateTheme(row.id)"
          >
            Duplicate
          </Button>
          <Button
            v-if="row.kind === 'user' || row.kind === 'broken'"
            type="button"
            variant="outline"
            size="xs"
            data-theme-delete
            @click="askDelete(row)"
          >
            Delete
          </Button>
        </div>
      </li>
    </ul>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent
        data-theme-delete-dialog
        class="sm:max-w-sm"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {{ deleting?.label }}?</AlertDialogTitle>
          <AlertDialogDescription>
            The theme file goes to the Recycle Bin, so you can get it back from there.
            <template v-if="deleting !== null && inUse(deleting)">
              It is the theme in use, so Dark is used instead.
            </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-theme-delete-cancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-theme-delete-confirm
            @click="confirmDelete"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
