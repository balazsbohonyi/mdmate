<script setup lang="ts">
import { Ellipsis } from '@lucide/vue'
import { computed, nextTick, reactive, ref, useTemplateRef, watch } from 'vue'
import HoverHint from '@/components/HoverHint.vue'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { requestSettingChange } from '@/features/settings/store'
import { BUILT_IN_IDS, BUILT_IN_THEMES } from '@/lib/builtinThemes'
import { settings } from '@/lib/settings'
import { effectiveTokens, slotKey, SYSTEM_THEME } from '@/lib/themes'
import {
  copyTheme,
  createTheme,
  deleteTheme,
  editTheme,
  renameTheme,
  suggestCopyName,
  type StartFrom,
} from './customize'
import { closeThemeForm, openThemeForm, themeForm, themeSlots } from './store'

/**
 * Every theme there is, in one list: the built-in ones first, then the user's own by name. A row
 * shows the name, what it is based on and five swatches, and ends with Select (or a disabled "In
 * use" for the theme in use) and a menu of everything else that can be done to it: Edit colors,
 * Rename, Duplicate and Delete for a theme of the user's, Duplicate for a built-in one. New theme
 * and Duplicate ask for a name in one form. Loaded with the Settings screen (settings-lazy).
 */

interface Swatch {
  readonly token: string
  readonly label: string
  readonly hint: string
  readonly color: string
}

interface Row {
  /** What the theme setting holds to select it. */
  readonly id: string
  readonly label: string
  readonly kind: 'builtin' | 'system' | 'user' | 'broken'
  /** A line under the name: what it is, or what is wrong with the file. */
  readonly note: string
  /** Five colors that stand for the theme, or none (System follows the operating system). */
  readonly swatches: readonly Swatch[]
}

/** The colors a swatch shows, and what each one is for. */
const SWATCH_INFO = [
  { token: 'background', label: 'Background', hint: 'behind the editor and the Settings pages.' },
  { token: 'card', label: 'Card', hint: 'panels and cards, such as the New theme form.' },
  { token: 'foreground', label: 'Foreground', hint: 'the color of text.' },
  { token: 'primary', label: 'Primary', hint: 'buttons, headings and other highlights.' },
  {
    token: 'accent',
    label: 'Accent',
    hint: 'the highlight under the pointer on tabs and window buttons.',
  },
] as const

const swatchesOf = (colors: ReadonlyMap<string, string>): Swatch[] =>
  SWATCH_INFO.flatMap((info) => {
    const color = colors.get(info.token)
    return color === undefined ? [] : [{ ...info, color }]
  })

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

/**
 * True while an item that opens a field (Rename, Duplicate) is being handled: that field takes the
 * focus, so the menu must not hand it back to its button as it closes. Any other item leaves the
 * focus where a closing menu puts it, on the button.
 */
let fieldTakesFocus = false

function renameFromMenu(row: Row): void {
  fieldTakesFocus = true
  void startRename(row)
}

function duplicateFromMenu(row: Row): void {
  fieldTakesFocus = true
  openThemeForm({ kind: 'copy', of: row.id })
}

function keepFocusInField(event: Event): void {
  if (!fieldTakesFocus) return
  fieldTakesFocus = false
  event.preventDefault()
}

/**
 * Resolves once the menu an action came from has closed. An open menu keeps the focus inside it, so
 * a field that takes the focus before then is refused it.
 */
async function afterMenuClosed(): Promise<void> {
  await nextTick()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

// ---- The name form: New theme, and a copy of a theme ----
const FROM_CHOICES: readonly { readonly value: StartFrom; readonly label: string }[] = [
  ...BUILT_IN_IDS.map((id) => ({ value: id, label: BUILT_IN_THEMES[id].label })),
  { value: 'current', label: 'The theme in use' },
]
const formEl = useTemplateRef<HTMLFormElement>('formEl')
const newName = ref('')
const newFrom = ref<StartFrom>('dark')
const newError = ref<string | null>(null)
const busy = ref(false)

/** The theme a copy is made of, for the form to name. */
const copyOfRow = computed<Row | undefined>(() => {
  const request = themeForm.value
  if (request?.kind !== 'copy') return undefined
  const key = slotKey(request.of ?? settings.theme)
  return rows.value.find((row) => slotKey(row.id) === key)
})

// A form that opens, or opens for another theme, starts clean with the name selected.
watch(themeForm, async (request) => {
  if (request === null) return
  newError.value = null
  newFrom.value = 'dark'
  newName.value = request.kind === 'copy' ? suggestCopyName(request.of) : ''
  await afterMenuClosed()
  const field = formEl.value?.querySelector('input')
  field?.focus()
  field?.select()
})

async function create(): Promise<void> {
  const request = themeForm.value
  if (busy.value || request === null) return
  busy.value = true
  try {
    const made =
      request.kind === 'copy'
        ? await copyTheme(request.of, newName.value)
        : await createTheme(newName.value, newFrom.value)
    if (made.ok) closeThemeForm()
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
  await afterMenuClosed()
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
        @click="openThemeForm({ kind: 'new' })"
      >
        New theme
      </Button>
    </div>

    <form
      v-if="themeForm !== null"
      ref="formEl"
      class="mt-3 grid gap-3 rounded-lg border border-border bg-card p-3"
      data-theme-new-form
      :data-theme-form-kind="themeForm.kind"
      @submit.prevent="create"
      @keydown.escape="closeThemeForm"
    >
      <label class="grid gap-1 text-sm text-foreground">
        {{ themeForm.kind === 'copy' ? 'Name of the copy' : 'Name' }}
        <Input
          v-model="newName"
          placeholder="My theme"
          aria-label="New theme name"
          :aria-invalid="newError !== null ? true : undefined"
          data-theme-new-name
        />
      </label>
      <p
        v-if="themeForm.kind === 'copy'"
        class="text-sm text-muted-foreground"
        data-theme-copy-of
      >
        A copy of {{ copyOfRow?.label ?? 'the theme in use' }}, with every color as it is now.
      </p>
      <div
        v-else
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
          {{ themeForm.kind === 'copy' ? 'Duplicate' : 'Create' }}
        </Button>
        <Button
          type="button"
          variant="ghost"
          data-theme-new-cancel
          @click="closeThemeForm"
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
            <span
              class="block truncate text-sm font-medium text-foreground"
              data-theme-name
            >
              {{ row.label }}
            </span>
            <p class="text-xs text-muted-foreground">{{ row.note }}</p>
          </template>
        </div>
        <div
          v-if="row.swatches.length > 0"
          class="flex shrink-0 gap-1"
          data-theme-swatches
        >
          <HoverHint
            v-for="swatch in row.swatches"
            :key="swatch.token"
            :text="`${swatch.label}: ${swatch.hint}`"
          >
            <span
              class="size-4 rounded-sm border border-border"
              :style="{ backgroundColor: swatch.color }"
              :data-theme-swatch="swatch.token"
            />
          </HoverHint>
        </div>
        <div
          class="w-20 shrink-0"
          data-theme-state-slot
        >
          <Button
            v-if="inUse(row)"
            type="button"
            variant="outline"
            size="xs"
            disabled
            class="w-full border-success/50 bg-success/10 text-success disabled:opacity-100 dark:border-success/50 dark:bg-success/10"
            data-theme-in-use-mark
          >
            In use
          </Button>
          <Button
            v-else-if="row.kind !== 'broken'"
            type="button"
            variant="outline"
            size="xs"
            class="w-full"
            data-theme-select
            @click="select(row)"
          >
            Select
          </Button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              class="hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent"
              :aria-label="`More actions for ${row.label}`"
              data-theme-menu
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <!-- An item that opens a field takes the focus itself; the menu must not hand it back to its button. -->
          <DropdownMenuContent
            align="end"
            data-theme-menu-content
            @close-auto-focus="keepFocusInField"
          >
            <DropdownMenuItem
              v-if="row.kind === 'user'"
              data-theme-edit
              @select="editTheme(row.id)"
            >
              Edit colors
            </DropdownMenuItem>
            <DropdownMenuItem
              v-if="row.kind === 'user'"
              data-theme-rename
              @select="renameFromMenu(row)"
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              v-if="row.kind !== 'broken'"
              data-theme-duplicate
              @select="duplicateFromMenu(row)"
            >
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              v-if="row.kind === 'user' || row.kind === 'broken'"
              variant="destructive"
              data-theme-delete
              @select="askDelete(row)"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
