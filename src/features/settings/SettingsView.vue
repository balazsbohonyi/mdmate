<script setup lang="ts">
import { X } from '@lucide/vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { docMeta } from '@/documents/meta'
import { Button } from '@/components/ui/button'
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

function choose(id: SettingsCategory): void {
  query.value = ''
  setSettingsCategory(tabId, id)
}

/** What `MDMATE_LINKS_ON_RENAME` makes a rename do for this run, or null when it is not set. */
const linksLock = ref<LinksOnRename | null>(null)

onMounted(() => {
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
        <div class="flex items-center gap-4">
          <h1
            class="min-w-0 flex-1 text-lg font-medium"
            data-settings-heading
          >
            {{ heading }}
          </h1>
          <Input
            v-model="query"
            type="search"
            placeholder="Search settings"
            aria-label="Search settings"
            class="max-w-64"
            data-settings-search
          />
        </div>
        <div class="mt-2">
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
              v-else
              class="flex flex-col gap-2"
              data-excluded-folders
            >
              <ul class="flex flex-wrap gap-1">
                <li
                  v-for="name in settings.workspace.excludedFolders"
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
                  size="sm"
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
