<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { docMeta } from '@/documents/meta'
import { readRoot } from '@/lib/settingsEdit'
import { interpretKey } from '@/features/keybindings/recorder'
import { commandSections, type SearchableCommand } from '@/features/keybindings/shortcutSearch'
import {
  keybindingsFileState,
  pendingKeybindingChange,
  requestKeybindingChange,
  resolvePendingKeybindingChange,
} from '@/features/keybindings/store'
import {
  commandHolding,
  defaultShortcutLabel,
  isRebound,
  keybindingProblems,
  listCommands,
  runCommand,
  shortcutLabel,
  type Command,
} from '@/workbench/commands'
import { COMMAND_IDS } from '@/workbench/defaultCommands'
import {
  bindingText,
  detectPlatform,
  formatKeybinding,
  type Keybinding,
} from '@/workbench/keybinding'
import SettingRow from './SettingRow.vue'

/**
 * The Keyboard category: every command with its shortcut. Clicking a shortcut records the next
 * combination and writes it to `keybindings.json`; the row keeps no shortcut of its own, it shows
 * what the registry says, so a hand edit of the file shows here at once. Loaded with the Settings
 * screen (settings-lazy).
 */
const platform = detectPlatform()

/** What the search box above the list holds; the Settings screen owns the box. */
const { query = '' } = defineProps<{ query?: string }>()

/** A command as the search sees it: its words and the shortcuts it shows, now and by default. */
function searchable(command: Command): SearchableCommand {
  const shortcuts = [
    shortcutLabel(command.id, platform),
    defaultShortcutLabel(command.id, platform),
  ].filter((label): label is string => label !== undefined)
  return { title: command.title, id: command.id, group: command.group, shortcuts }
}

const commands = computed<readonly Command[]>(() => listCommands())
/** The commands the search finds, under their group's heading, in the fixed order. */
const sections = computed(() => commandSections(commands.value, query, searchable))

/** The row that is waiting for a combination. */
const recordingId = ref<string | null>(null)
/** Why the last combination was refused, for the row that is recording. */
const refusal = ref<{ readonly id: string; readonly message: string } | null>(null)
/** A combination another command holds: the row asks whether to take it over. */
const conflict = ref<{
  readonly id: string
  readonly binding: Keybinding
  readonly other: Command
} | null>(null)

const problems = computed(() => keybindingProblems())
const broken = computed(() => keybindingsFileState.broken)
/** Whether the file holds any entry. Comments are not entries; a file that cannot be read is. */
const hasEntries = computed(() => {
  const text = keybindingsFileState.text
  if (text === null) return false
  const read = readRoot(text, 'keybindings.json')
  return !read.ok || Object.keys(read.root).length > 0
})
const asking = computed(() => pendingKeybindingChange.value)
const askingError = computed(() => {
  const pending = asking.value
  return pending === null ? null : (docMeta(pending.docId)?.saveError ?? null)
})

function change(
  edit: Readonly<Record<string, string | null | undefined>> | 'all',
  label: string,
): void {
  requestKeybindingChange(edit, label).catch((error: unknown) => {
    console.error('Could not change the shortcuts', error)
  })
}

/** While recording, every key goes here first, so nothing else in the app sees it. */
function onKey(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopImmediatePropagation()
  const id = recordingId.value
  if (id === null || event.isComposing) return
  const command = commands.value.find((one) => one.id === id)
  if (command === undefined) return
  const read = interpretKey(event, platform)
  switch (read.kind) {
    case 'ignore':
      return
    case 'cancel':
      stopRecording()
      return
    case 'unbind':
      stopRecording()
      change({ [id]: null }, command.title)
      return
    case 'refused':
      refusal.value = { id, message: read.message }
      return
    case 'binding': {
      const holder = commandHolding(read.binding)
      stopRecording()
      if (holder === undefined || holder.id === id) {
        change({ [id]: bindingText(read.binding) }, command.title)
      } else {
        conflict.value = { id, binding: read.binding, other: holder }
      }
    }
  }
}

function startRecording(id: string): void {
  stopRecording()
  conflict.value = null
  refusal.value = null
  recordingId.value = id
  window.addEventListener('keydown', onKey, true)
}

function stopRecording(): void {
  window.removeEventListener('keydown', onKey, true)
  recordingId.value = null
  refusal.value = null
}

onBeforeUnmount(stopRecording)

function replace(command: Command): void {
  const pending = conflict.value
  if (pending === null) return
  conflict.value = null
  change({ [pending.other.id]: null, [command.id]: bindingText(pending.binding) }, command.title)
}

function reset(command: Command): void {
  conflict.value = null
  change({ [command.id]: undefined }, command.title)
}

function resetAll(): void {
  stopRecording()
  conflict.value = null
  change('all', 'all shortcuts')
}

function answer(choice: 'save' | 'discard' | 'cancel'): void {
  resolvePendingKeybindingChange(choice).catch((error: unknown) => {
    console.error('Could not answer the shortcuts question', error)
  })
}

function openFile(): void {
  runCommand(COMMAND_IDS.openKeybindingsFile).catch((error: unknown) => {
    console.error('Could not open keybindings.json', error)
  })
}

function describeDefault(command: Command): string {
  const first = defaultShortcutLabel(command.id, platform)
  return first === undefined ? 'No default shortcut.' : `Default: ${first}.`
}

function buttonText(command: Command): string {
  if (recordingId.value === command.id) return 'Press a shortcut…'
  return shortcutLabel(command.id, platform) ?? 'Not set'
}
</script>

<template>
  <div data-keyboard-panel>
    <div
      v-if="broken !== null"
      role="alert"
      class="mt-2 flex items-center gap-3 rounded-md bg-muted px-3 py-1.5 text-chrome"
      data-keyboard-banner
    >
      <span class="min-w-0 flex-1">
        keybindings.json has a problem: {{ broken.message }}
        <template v-if="broken.line !== null">(line {{ broken.line }})</template>
        The last good shortcuts stay in use.
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        @click="openFile"
      >
        Open keybindings.json
      </Button>
    </div>
    <div
      v-if="asking !== null"
      role="alert"
      class="mt-2 flex items-center gap-3 rounded-md bg-muted px-3 py-1.5 text-chrome"
      data-keyboard-confirm
    >
      <span class="min-w-0 flex-1">
        keybindings.json has changes you have not saved. Save them before changing
        {{ asking.label }}?
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
    <ul
      v-if="problems.length > 0"
      class="mt-2 flex flex-col gap-1 rounded-md bg-muted px-3 py-1.5 text-chrome"
      data-keyboard-problems
    >
      <li
        v-for="problem in problems"
        :key="problem.message"
      >
        {{ problem.message }}
      </li>
    </ul>
    <div class="mt-2 flex items-center justify-between gap-3">
      <p class="text-chrome text-muted-foreground">Click a shortcut, then press the new keys.</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        :disabled="!hasEntries"
        data-keyboard-reset-all
        @click="resetAll"
      >
        Reset all
      </Button>
    </div>
    <div class="mt-2">
      <section
        v-for="section in sections"
        :key="section.group"
        :aria-label="section.group"
        data-keyboard-group
      >
        <h2
          class="mt-5 mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
          data-keyboard-group-heading
        >
          {{ section.group }}
        </h2>
        <SettingRow
          v-for="command in section.commands"
          :key="command.id"
          :setting-key="command.id"
          :label="command.title"
          :description="describeDefault(command)"
          :modified="isRebound(command.id)"
          :error="refusal?.id === command.id ? refusal.message : null"
          :locked="null"
          @reset="reset(command)"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="justify-between font-normal"
            :aria-label="`Shortcut for ${command.title}`"
            data-shortcut-button
            @click="startRecording(command.id)"
            @blur="recordingId === command.id && stopRecording()"
          >
            {{ buttonText(command) }}
          </Button>
          <p
            v-if="recordingId === command.id"
            class="text-xs text-muted-foreground"
          >
            Esc cancels. Backspace removes the shortcut.
          </p>
          <div
            v-if="conflict?.id === command.id"
            role="alert"
            class="flex flex-col gap-1 text-xs"
            data-shortcut-conflict
          >
            <span>
              {{ formatKeybinding(conflict.binding, platform) }} is used by
              {{ conflict.other.title }}.
            </span>
            <span class="flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                data-shortcut-replace
                @click="replace(command)"
              >
                Replace
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                @click="conflict = null"
              >
                Cancel
              </Button>
            </span>
          </div>
        </SettingRow>
      </section>
      <p
        v-if="sections.length === 0"
        class="mt-4 text-chrome text-muted-foreground"
        data-keyboard-empty
      >
        No shortcut matches that.
      </p>
    </div>
  </div>
</template>
