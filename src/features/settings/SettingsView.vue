<script setup lang="ts">
import { Check, ChevronsUpDown, Search, X } from '@lucide/vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { docMeta } from '@/documents/meta'
import { languageChoices, type LanguageChoice } from '@/editor/codeLanguages'
import { familyStack } from '@/editor/documentFonts'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxAnchor,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxViewport,
} from '@/components/ui/combobox'
import HoverHint from '@/components/HoverHint.vue'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { type LinksOnRename, settings } from '@/lib/settings'
import {
  SETTINGS_CATEGORIES,
  settingsCategoryLabel,
  type SettingsCategory,
} from '@/lib/settingsCategories'
import {
  checkExtension,
  checkFolderName,
  getSettingFrom,
  SETTING_DEFS,
  type SettingKey,
  type SettingValueMap,
} from '@/lib/settingsFile'
import { getHost } from '@/platform'
import { runCommand } from '@/workbench/commands'
import { COMMAND_IDS } from '@/workbench/defaultCommands'
import { setSettingsCategory, settingsCategoryOf } from '@/workbench/store'
import {
  isModified,
  pendingSettingChange,
  requestResetSetting,
  requestSettingChange,
  resolvePendingSettingChange,
  settingsFileState,
} from './store'
import { LINKS_ENV_VAR, rowsMatching, rowsOf, SETTING_ROWS, type SettingRowSpec } from './rows'
import KeyboardPanel from './KeyboardPanel.vue'
import SettingRow from './SettingRow.vue'

/**
 * The Settings tab's screen: the five groups on the left, the rows of the open one on the right,
 * a search box over all of them, and a banner while `settings.json` cannot be read. It holds no
 * value of its own: a control asks the store to change the file and shows what the file now says
 * (check-arch: settings-lazy loads this screen the first time the tab is shown).
 */
const { tabId } = defineProps<{ tabId: string }>()

const category = computed(() => settingsCategoryOf(tabId))
const label = computed(() => settingsCategoryLabel(category.value))

const query = ref('')
const searching = computed(() => query.value.trim() !== '')
const shown = computed<readonly SettingRowSpec[]>(() =>
  searching.value ? rowsMatching(query.value) : rowsOf(category.value),
)
const heading = computed(() => (searching.value ? 'Search results' : label.value))
const showsActions = computed(() => !searching.value && category.value === 'advanced')
/** The Keyboard category is a list of commands, not of settings, so it has its own panel. */
const showsKeyboard = computed(() => !searching.value && category.value === 'keyboard')

/** The box on the Keyboard title row; it filters the list of shortcuts, not the settings. */
const keyboardQuery = ref('')

function choose(id: SettingsCategory): void {
  query.value = ''
  keyboardQuery.value = ''
  setSettingsCategory(tabId, id)
}

/** What `MDMATE_LINKS_ON_RENAME` makes a rename do for this run, or null when it is not set. */
const linksLock = ref<LinksOnRename | null>(null)

onMounted(() => {
  // The Syntax colors row names languages, so the list is read with the screen (a lazy chunk).
  loadLanguages(true)
  getHost()
    .then((host) => host.linksOnRenameOverride())
    .then((mode) => {
      linksLock.value = mode
    })
    .catch(() => {
      linksLock.value = null
    })
})

/** Text typed into a field and not yet accepted, by key; the file's value shows when there is none. */
const drafts = reactive<Record<string, string>>({})
/** Why a typed value was refused, by key. The file keeps its last good value. */
const refused = reactive<Record<string, string>>({})

function valueOf(key: SettingKey): unknown {
  return getSettingFrom(settings, key)
}

function lockOf(key: SettingKey): string | null {
  if (key !== 'links.onRename' || linksLock.value === null) return null
  return `Set by the ${LINKS_ENV_VAR} environment variable for this run, so it cannot be changed here.`
}

function errorOf(key: SettingKey): string | null {
  return refused[key] ?? settingsFileState.problems[key] ?? null
}

function shownText(key: SettingKey): string {
  return drafts[key] ?? String(valueOf(key))
}

function choiceValue(spec: SettingRowSpec): string {
  if (spec.key === 'links.onRename' && linksLock.value !== null) return linksLock.value
  return String(valueOf(spec.key))
}

/** The options of a choice, with the current value added when the file holds one not in the list. */
function optionsOf(spec: SettingRowSpec): readonly { value: string; label: string }[] {
  if (spec.control.kind !== 'choice') return []
  const current = choiceValue(spec)
  const known = spec.control.options
  return known.some((option) => option.value === current)
    ? known
    : [...known, { value: current, label: current }]
}

function set<K extends SettingKey>(key: K, value: SettingValueMap[K]): void {
  void requestSettingChange(key, value)
}

function reset(key: SettingKey): void {
  delete drafts[key]
  delete refused[key]
  void requestResetSetting(key)
}

/** The font stack the sample line under a family field is drawn in: what is typed, then the fallbacks. */
function sampleStack(spec: SettingRowSpec): string {
  if (spec.control.kind !== 'font') return ''
  return familyStack(spec.control.family, shownText(spec.key), settings.fonts.body)
}

const HEADING_SCALE = 'fonts.headingScale' as const
/** Heading sizes typed and not yet accepted, by level index. */
const scaleDrafts = reactive<Record<number, string>>({})

function scaleText(index: number): string {
  return scaleDrafts[index] ?? String(settings.fonts.headingScale[index] ?? '')
}

function onScaleType(index: number, text: string | number): void {
  scaleDrafts[index] = String(text)
}

function revertScale(): void {
  for (const index of Object.keys(scaleDrafts)) delete scaleDrafts[Number(index)]
  delete refused[HEADING_SCALE]
}

/** Accepts the six sizes together when one is left: the list is checked and written as one value. */
function acceptScale(): void {
  const numbers = settings.fonts.headingScale.map((_, index) => {
    const text = scaleText(index).trim()
    return text === '' ? undefined : Number(text)
  })
  const checked = SETTING_DEFS[HEADING_SCALE].check(numbers)
  if (!checked.ok) {
    refused[HEADING_SCALE] = checked.why
    return
  }
  revertScale()
  set(HEADING_SCALE, checked.value)
}

function onType(key: SettingKey, text: string | number): void {
  drafts[key] = String(text)
}

/** Accepts what was typed when the field is left or Enter is pressed: checked, then written. */
function accept(spec: SettingRowSpec): void {
  const key = spec.key
  const text = drafts[key]
  if (text === undefined) return
  const raw =
    spec.control.kind === 'number' ? (text.trim() === '' ? undefined : Number(text)) : text
  const checked = SETTING_DEFS[key].check(raw)
  if (!checked.ok) {
    refused[key] = checked.why
    return
  }
  delete drafts[key]
  delete refused[key]
  set(key, checked.value as never)
}

function revert(key: SettingKey): void {
  delete drafts[key]
  delete refused[key]
}

const folderDraft = ref('')
/** The chips, A to Z whatever the case. Shown sorted; the file keeps the order it was written in. */
const sortedFolders = computed(() =>
  [...settings.workspace.excludedFolders].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  ),
)
const FOLDERS = 'workspace.excludedFolders' as const

function addFolder(): void {
  const name = folderDraft.value.trim()
  if (name === '') return
  const checked = checkFolderName(name)
  if (!checked.ok) {
    refused[FOLDERS] = checked.why
    return
  }
  const list = [...settings.workspace.excludedFolders]
  if (list.some((have) => have.toLowerCase() === checked.value.toLowerCase())) {
    refused[FOLDERS] = `${checked.value} is already in the list.`
    return
  }
  const next = SETTING_DEFS[FOLDERS].check([...list, checked.value])
  if (!next.ok) {
    refused[FOLDERS] = next.why
    return
  }
  delete refused[FOLDERS]
  folderDraft.value = ''
  set(FOLDERS, next.value)
}

function removeFolder(name: string): void {
  delete refused[FOLDERS]
  set(
    FOLDERS,
    settings.workspace.excludedFolders.filter((have) => have !== name),
  )
}

const EXTENSIONS = 'editor.highlightExtensions' as const

/** The languages the picker offers: null until the list has loaded, which waits for the first open. */
const languages = ref<readonly LanguageChoice[] | null>(null)
const languageSearch = ref('')

function loadLanguages(open: boolean): void {
  if (!open || languages.value !== null) return
  void languageChoices().then((list) => {
    languages.value = list
  })
}

/** A language's extensions that the list can hold; the picker adds exactly these. */
function usableExtensions(language: LanguageChoice): string[] {
  const usable = language.extensions
    .filter((extension) => checkExtension(extension).ok)
    .map((extension) => extension.toLowerCase())
  return [...new Set(usable)]
}

/** A language's extensions on one line, each with its dot: `.ts .mts .cts`. */
function extensionsText(language: LanguageChoice): string {
  return usableExtensions(language)
    .map((extension) => `.${extension}`)
    .join(' ')
}

function allEnabled(language: LanguageChoice): boolean {
  return usableExtensions(language).every((extension) =>
    settings.editor.highlightExtensions.includes(extension.toLowerCase()),
  )
}

/**
 * The languages for what is typed in the picker's search box: every word is part of the name, or is
 * exactly one of its extensions (`rs` finds Rust, though the name has no `rs` in it). The options
 * show names only, so a match is never one the label cannot explain, apart from that exact case.
 */
const matchingLanguages = computed(() => {
  const words = languageSearch.value.toLowerCase().split(/\s+/).filter(Boolean)
  return (languages.value ?? []).filter((language) => {
    if (usableExtensions(language).length === 0) return false
    const name = language.name.toLowerCase()
    const extensions = language.extensions.map((extension) => extension.toLowerCase())
    return words.every(
      (word) => name.includes(word) || extensions.includes(word.replace(/^\./, '')),
    )
  })
})

function addLanguage(name: string): void {
  const language = languages.value?.find((have) => have.name === name)
  if (language === undefined) return
  const next = SETTING_DEFS[EXTENSIONS].check([
    ...settings.editor.highlightExtensions,
    ...usableExtensions(language),
  ])
  if (!next.ok) {
    refused[EXTENSIONS] = next.why
    return
  }
  delete refused[EXTENSIONS]
  languageSearch.value = ''
  set(EXTENSIONS, next.value)
}

/** One tag in the Syntax colors row: a language, or a bare extension no language in the list owns. */
interface ColorTag {
  readonly key: string
  readonly label: string
  /** What a hover shows: the language's extensions. Empty for a bare extension. */
  readonly hint: string
  /** The extensions that go when the tag is removed. */
  readonly extensions: readonly string[]
  readonly language: boolean
}

/**
 * The tags: each language with at least one of its extensions in the list, A to Z by name, then any
 * extension no language owns (a hand-written one), so nothing in the file is out of sight. Until
 * the language list has loaded every extension shows as its own tag. The file keeps its own order.
 */
const colorTags = computed<readonly ColorTag[]>(() => {
  const have = new Set(settings.editor.highlightExtensions)
  const covered = new Set<string>()
  const tags: ColorTag[] = []
  for (const language of languages.value ?? []) {
    const extensions = usableExtensions(language)
    const on = extensions.filter((extension) => have.has(extension))
    if (on.length === 0) continue
    on.forEach((extension) => covered.add(extension))
    tags.push({
      key: `language:${language.name}`,
      label: language.name,
      hint: extensionsText(language),
      extensions,
      language: true,
    })
  }
  for (const extension of [...have].sort()) {
    if (covered.has(extension)) continue
    tags.push({
      key: `extension:${extension}`,
      label: `.${extension}`,
      hint: '',
      extensions: [extension],
      language: false,
    })
  }
  return tags
})

function removeTag(tag: ColorTag): void {
  delete refused[EXTENSIONS]
  set(
    EXTENSIONS,
    settings.editor.highlightExtensions.filter((have) => !tag.extensions.includes(have)),
  )
}

const bannerHint = computed(() => settingsFileState.broken)

const asking = computed(() => pendingSettingChange.value)
const askingLabel = computed(
  () => SETTING_ROWS.find((row) => row.key === asking.value?.key)?.label ?? 'a setting',
)
const askingError = computed(() => {
  const pending = asking.value
  return pending === null ? null : (docMeta(pending.docId)?.saveError ?? null)
})

function answer(choice: 'save' | 'discard' | 'cancel'): void {
  resolvePendingSettingChange(choice).catch((error: unknown) => {
    console.error('Could not answer the settings question', error)
  })
}

function openKeybindingsFile(): void {
  runCommand(COMMAND_IDS.openKeybindingsFile).catch((error: unknown) => {
    console.error('Could not open keybindings.json', error)
  })
}

function openFile(): void {
  runCommand(COMMAND_IDS.openSettingsFile).catch((error: unknown) => {
    console.error('Could not open settings.json', error)
  })
}
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col"
    data-settings-view
  >
    <div
      v-if="bannerHint !== null"
      role="alert"
      class="flex shrink-0 items-center gap-3 border-b border-border bg-muted px-3 py-1.5 text-chrome"
      data-settings-banner
    >
      <span class="min-w-0 flex-1">
        settings.json has a problem: {{ bannerHint.message }} The last good settings stay in use.
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        @click="openFile"
      >
        Open settings.json
      </Button>
    </div>
    <div
      v-if="asking !== null"
      role="alert"
      class="flex shrink-0 items-center gap-3 border-b border-border bg-muted px-3 py-1.5 text-chrome"
      data-settings-confirm
    >
      <span class="min-w-0 flex-1">
        settings.json has changes you have not saved. Save them before changing
        {{ askingLabel }}?
        <span
          v-if="askingError !== null"
          class="text-destructive"
        >
          Could not save: {{ askingError }}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        @click="answer('save')"
      >
        Save
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        @click="answer('discard')"
      >
        Don't save
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        @click="answer('cancel')"
      >
        Cancel
      </Button>
    </div>
    <div class="flex min-h-0 flex-1">
      <nav
        aria-label="Settings groups"
        class="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2"
      >
        <div class="relative mb-1.5">
          <Search
            class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            v-model="query"
            type="search"
            placeholder="Search settings"
            aria-label="Search settings"
            class="pl-8"
            data-settings-search
          />
        </div>
        <button
          v-for="item in SETTINGS_CATEGORIES"
          :key="item.id"
          type="button"
          :data-settings-category="item.id"
          :aria-current="category === item.id && !searching ? 'page' : undefined"
          class="cursor-default rounded-sm px-3 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
          :class="
            category === item.id && !searching
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground'
          "
          @click="choose(item.id)"
        >
          {{ item.label }}
        </button>
      </nav>
      <section
        :aria-label="heading"
        class="min-w-0 flex-1 overflow-y-auto p-6"
        data-settings-panel
      >
        <div class="flex items-center justify-between gap-3">
          <h1
            class="min-w-0 text-lg font-medium"
            data-settings-heading
          >
            {{ heading }}
          </h1>
          <div
            v-if="showsKeyboard"
            class="relative w-64 max-w-[50%] shrink-0"
          >
            <Search
              class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              v-model="keyboardQuery"
              type="search"
              placeholder="Search shortcuts"
              aria-label="Search shortcuts"
              class="pl-8"
              data-keyboard-search
              @keydown.escape="keyboardQuery = ''"
            />
          </div>
        </div>
        <KeyboardPanel
          v-if="showsKeyboard"
          :query="keyboardQuery"
        />
        <div
          v-else
          class="mt-2"
        >
          <SettingRow
            v-for="spec in shown"
            :key="spec.key"
            :setting-key="spec.key"
            :label="spec.label"
            :description="spec.description"
            :modified="isModified(spec.key)"
            :error="errorOf(spec.key)"
            :locked="lockOf(spec.key)"
            @reset="reset(spec.key)"
          >
            <Switch
              v-if="spec.control.kind === 'switch'"
              :model-value="valueOf(spec.key) === true"
              :aria-label="spec.label"
              @update:model-value="(on: boolean) => set(spec.key as 'devtools', on)"
            />
            <Input
              v-else-if="spec.control.kind === 'number'"
              :model-value="shownText(spec.key)"
              inputmode="decimal"
              :aria-label="spec.label"
              :aria-invalid="refused[spec.key] !== undefined ? true : undefined"
              @update:model-value="(text: string | number) => onType(spec.key, text)"
              @change="accept(spec)"
              @keydown.enter="accept(spec)"
              @keydown.esc="revert(spec.key)"
            />
            <Input
              v-else-if="spec.control.kind === 'text'"
              :model-value="shownText(spec.key)"
              :placeholder="spec.control.placeholder"
              :aria-label="spec.label"
              :aria-invalid="refused[spec.key] !== undefined ? true : undefined"
              @update:model-value="(text: string | number) => onType(spec.key, text)"
              @change="accept(spec)"
              @keydown.enter="accept(spec)"
              @keydown.esc="revert(spec.key)"
            />
            <div
              v-else-if="spec.control.kind === 'font'"
              class="flex flex-col gap-1"
            >
              <Input
                :model-value="shownText(spec.key)"
                placeholder="Built-in"
                :aria-label="spec.label"
                :aria-invalid="refused[spec.key] !== undefined ? true : undefined"
                @update:model-value="(text: string | number) => onType(spec.key, text)"
                @change="accept(spec)"
                @keydown.enter="accept(spec)"
                @keydown.esc="revert(spec.key)"
              />
              <p
                class="truncate text-sm text-foreground"
                :style="{ fontFamily: sampleStack(spec) }"
                data-font-sample
              >
                The quick brown fox jumps over the lazy dog
              </p>
            </div>
            <div
              v-else-if="spec.control.kind === 'scale'"
              class="grid grid-cols-6 gap-1"
              data-heading-scale
            >
              <label
                v-for="(_, index) in settings.fonts.headingScale"
                :key="index"
                class="flex flex-col items-center gap-0.5 text-xs text-muted-foreground"
              >
                H{{ index + 1 }}
                <Input
                  :model-value="scaleText(index)"
                  inputmode="decimal"
                  :aria-label="`Heading ${index + 1} size`"
                  :aria-invalid="refused[spec.key] !== undefined ? true : undefined"
                  class="px-1 text-center"
                  @update:model-value="(text: string | number) => onScaleType(index, text)"
                  @change="acceptScale"
                  @keydown.enter="acceptScale"
                  @keydown.esc="revertScale"
                />
              </label>
            </div>
            <Select
              v-else-if="spec.control.kind === 'choice'"
              :model-value="choiceValue(spec)"
              :disabled="lockOf(spec.key) !== null"
              @update:model-value="(value) => set(spec.key as 'theme', String(value))"
            >
              <SelectTrigger
                class="w-full"
                :aria-label="spec.label"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="option in optionsOf(spec)"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <div
              v-else-if="spec.control.kind === 'folders'"
              class="flex flex-col gap-2"
              data-excluded-folders
            >
              <ul class="flex flex-wrap gap-1">
                <li
                  v-for="name in sortedFolders"
                  :key="name"
                  class="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                  data-excluded-chip
                >
                  {{ name }}
                  <button
                    type="button"
                    class="cursor-default rounded-sm text-muted-foreground hover:text-foreground"
                    :aria-label="`Remove ${name}`"
                    @click="removeFolder(name)"
                  >
                    <X class="size-3" />
                  </button>
                </li>
              </ul>
              <div class="flex gap-1">
                <Input
                  v-model="folderDraft"
                  placeholder="Add a folder name"
                  aria-label="Add an excluded folder"
                  @keydown.enter.prevent="addFolder"
                />
                <Button
                  type="button"
                  variant="outline"
                  @click="addFolder"
                >
                  Add
                </Button>
              </div>
              <Button
                v-if="isModified(spec.key)"
                type="button"
                variant="outline"
                size="sm"
                data-excluded-reset
                @click="reset(spec.key)"
              >
                Reset to built-in list
              </Button>
            </div>
            <div
              v-else-if="spec.control.kind === 'extensions'"
              class="flex flex-col gap-2"
              data-highlight-extensions
            >
              <ul class="flex flex-wrap gap-1">
                <HoverHint
                  v-for="tag in colorTags"
                  :key="tag.key"
                  :text="tag.hint"
                >
                  <li
                    class="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                    data-extension-chip
                    :data-language-chip="tag.language ? 'true' : undefined"
                  >
                    {{ tag.label }}
                    <button
                      type="button"
                      class="cursor-default rounded-sm text-muted-foreground hover:text-foreground"
                      :aria-label="`Remove ${tag.label}`"
                      @click="removeTag(tag)"
                    >
                      <X class="size-3" />
                    </button>
                  </li>
                </HoverHint>
              </ul>
              <Combobox
                :model-value="''"
                ignore-filter
                @update:model-value="(value) => addLanguage(String(value))"
                @update:open="loadLanguages"
              >
                <ComboboxAnchor as-child>
                  <ComboboxTrigger as-child>
                    <Button
                      type="button"
                      variant="outline"
                      class="w-full justify-between font-normal"
                      aria-label="Add a language"
                      data-extension-picker
                    >
                      Add a language
                      <ChevronsUpDown class="opacity-50" />
                    </Button>
                  </ComboboxTrigger>
                </ComboboxAnchor>
                <ComboboxList>
                  <ComboboxInput
                    v-model="languageSearch"
                    placeholder="Search languages"
                  />
                  <p
                    v-if="languages === null"
                    class="px-2 py-2 text-center text-sm text-muted-foreground"
                  >
                    Loading languages…
                  </p>
                  <p
                    v-else-if="matchingLanguages.length === 0"
                    class="px-2 py-2 text-center text-sm text-muted-foreground"
                    data-language-empty
                  >
                    No language found.
                  </p>
                  <ComboboxViewport class="max-h-60">
                    <ComboboxGroup>
                      <ComboboxItem
                        v-for="language in matchingLanguages"
                        :key="language.name"
                        :value="language.name"
                        :disabled="allEnabled(language)"
                        data-language-item
                      >
                        <span class="flex min-w-0 flex-1 flex-col">
                          <span data-language-name>{{ language.name }}</span>
                          <HoverHint :text="extensionsText(language)">
                            <span
                              class="truncate text-xs text-muted-foreground!"
                              data-language-extensions
                              >{{ extensionsText(language) }}</span
                            >
                          </HoverHint>
                        </span>
                        <Check
                          v-if="allEnabled(language)"
                          class="size-4 shrink-0"
                        />
                      </ComboboxItem>
                    </ComboboxGroup>
                  </ComboboxViewport>
                </ComboboxList>
              </Combobox>
              <Button
                v-if="isModified(spec.key)"
                type="button"
                variant="outline"
                size="sm"
                data-extension-reset
                @click="reset(spec.key)"
              >
                Reset to the default list
              </Button>
            </div>
          </SettingRow>
          <SettingRow
            v-if="showsActions"
            :setting-key="null"
            label="settings.json"
            description="The file behind these settings. Edit it by hand and this screen follows."
            :modified="false"
            :error="null"
            :locked="null"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-open-settings-file
              @click="openFile"
            >
              Open settings.json
            </Button>
          </SettingRow>
          <SettingRow
            v-if="showsActions"
            :setting-key="null"
            label="keybindings.json"
            description="The file behind the shortcuts. Edit it by hand and the Keyboard group follows."
            :modified="false"
            :error="null"
            :locked="null"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-open-keybindings-file
              @click="openKeybindingsFile"
            >
              Open keybindings.json
            </Button>
          </SettingRow>
          <p
            v-if="shown.length === 0 && !showsActions"
            class="mt-2 text-sm text-muted-foreground"
            data-settings-empty
          >
            {{ searching ? 'No setting matches that.' : 'This group has no settings yet.' }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
