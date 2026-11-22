<script setup lang="ts">
import { Check } from '@lucide/vue'
import { computed, nextTick, ref, watch } from 'vue'
import { Input } from '@/components/ui/input'
import { cssFamilyList } from '@/editor/documentFonts'

/**
 * A font field with a list of the installed families under it (P9.1-T25). The field stays a text
 * field: what is typed is the value (a family, or a stack such as `Inter, sans-serif`), the sample
 * line under it follows what is typed, and Enter or leaving the field accepts it. The list only
 * helps: it shows every family when the field opens, narrows to what is typed once typing starts,
 * draws each option in its own family, and puts "Built-in" first, which clears the field. A name
 * that is not in the list is as good as one that is. A saved stack is shown as written.
 */
const props = defineProps<{
  /** What the field shows: the text typed, or the saved value. */
  modelValue: string
  label: string
  invalid: boolean
  /** The installed families, or null until the list has been read. */
  fonts: readonly string[] | null
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', text: string): void
  /** The text in the field is to be accepted now (Enter, leaving the field, an option picked). */
  (event: 'accept'): void
  /** The text is to be dropped and the saved value shown again (Escape). */
  (event: 'revert'): void
  /** The list is wanted: the parent reads it on the first call. */
  (event: 'open'): void
}>()

/** Options drawn at most, each in its own family: a list of hundreds is narrowed by typing. */
const MAX_OPTIONS = 60
/** When the value is further down than the cap, the list runs this far past it, so it shows. */
const PAST_VALUE = 20

const listId = `font-list-${String(Math.random()).slice(2, 8)}`
const open = ref(false)
/** Whether typing has begun since the list opened: until then every family is listed. */
const narrowing = ref(false)
/** The option the arrow keys are on: 0 is Built-in; -1 is none (Enter then accepts the typed text). */
const active = ref(-1)

const matches = computed<readonly string[]>(() => {
  const all = props.fonts ?? []
  const typed = props.modelValue.trim().toLowerCase()
  if (!narrowing.value || typed === '') return all
  return all.filter((name) => name.toLowerCase().includes(typed))
})
/**
 * The options drawn: the first `MAX_OPTIONS`, or, while the list is only opened and the field holds
 * a family that comes later, everything up to a few options past it, so the list can open on it.
 */
const shown = computed(() => {
  let count = MAX_OPTIONS
  if (!narrowing.value) {
    const at = matches.value.findIndex(isCurrent)
    if (at >= 0) count = Math.max(count, at + 1 + PAST_VALUE)
  }
  return matches.value.slice(0, count)
})
const hidden = computed(() => matches.value.length - shown.value.length)
/** Built-in, then the families drawn: what the arrow keys walk over. */
const values = computed<readonly string[]>(() => ['', ...shown.value])

const list = ref<HTMLElement | null>(null)

/** Scrolls the list so the option that is the value is in the middle of it. */
function reveal(): void {
  const box = list.value
  const chosen = box?.querySelector<HTMLElement>('[aria-selected="true"]')
  if (box === null || box === undefined || chosen === null || chosen === undefined) return
  box.scrollTop = Math.max(0, chosen.offsetTop - box.clientHeight / 2 + chosen.offsetHeight / 2)
}

// When the list opens on the field's value, or arrives after it opened, it starts at that option.
// Typing narrows the list and the user is steering it then, so it is left alone.
watch([open, () => props.fonts], async ([isOpen, fonts]) => {
  if (!isOpen || fonts === null || narrowing.value) return
  await nextTick()
  reveal()
})

function show(): void {
  if (!open.value) {
    open.value = true
    narrowing.value = false
    active.value = -1
    emit('open')
  }
}

function hide(): void {
  open.value = false
  active.value = -1
}

function onInput(text: string | number): void {
  emit('update:modelValue', String(text))
  narrowing.value = true
  active.value = -1
  open.value = true
  emit('open')
}

function pick(value: string): void {
  emit('update:modelValue', value)
  emit('accept')
  hide()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    show()
    const step = event.key === 'ArrowDown' ? 1 : -1
    const count = values.value.length
    const next = active.value + step
    active.value = next < 0 ? count - 1 : next >= count ? 0 : next
    document
      .getElementById(`${listId}-${String(active.value)}`)
      ?.scrollIntoView?.({ block: 'nearest' })
    return
  }
  if (event.key === 'Enter') {
    const value = values.value[active.value]
    if (open.value && active.value >= 0 && value !== undefined) {
      event.preventDefault()
      pick(value)
      return
    }
    emit('accept')
    hide()
    return
  }
  if (event.key === 'Escape') {
    emit('revert')
    hide()
  }
}

/** Whether an option is the value now in the field, for the check mark. */
const isCurrent = (value: string): boolean =>
  value.trim().toLowerCase() === props.modelValue.trim().toLowerCase()
</script>

<template>
  <div
    class="relative"
    data-font-picker
  >
    <Input
      :model-value="modelValue"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="active >= 0 ? `${listId}-${String(active)}` : undefined"
      placeholder="Built-in"
      :aria-label="label"
      :aria-invalid="invalid ? true : undefined"
      autocomplete="off"
      spellcheck="false"
      @update:model-value="onInput"
      @focus="show"
      @mousedown="show"
      @blur="hide"
      @change="emit('accept')"
      @keydown="onKeydown"
    />
    <ul
      v-if="open && fonts !== null"
      :id="listId"
      ref="list"
      role="listbox"
      :aria-label="`${label} list`"
      class="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      data-font-list
      @mousedown.prevent
    >
      <li
        :id="`${listId}-0`"
        role="option"
        :aria-selected="isCurrent('')"
        class="relative flex w-full cursor-default items-center rounded-md py-1 pr-8 pl-1.5 text-sm select-none hover:bg-accent hover:text-accent-foreground"
        :class="active === 0 ? 'bg-accent text-accent-foreground' : ''"
        data-font-option
        data-font-built-in
        @click="pick('')"
      >
        Built-in
        <Check
          v-if="isCurrent('')"
          class="absolute right-2 size-4"
        />
      </li>
      <li
        v-for="(name, at) in shown"
        :id="`${listId}-${String(at + 1)}`"
        :key="name"
        role="option"
        :aria-selected="isCurrent(name)"
        class="relative flex w-full cursor-default items-center rounded-md py-1 pr-8 pl-1.5 text-sm select-none hover:bg-accent hover:text-accent-foreground"
        :class="active === at + 1 ? 'bg-accent text-accent-foreground' : ''"
        :style="{ fontFamily: cssFamilyList(name) }"
        data-font-option
        :data-font-name="name"
        @click="pick(name)"
      >
        {{ name }}
        <Check
          v-if="isCurrent(name)"
          class="absolute right-2 size-4"
        />
      </li>
      <li
        v-if="hidden > 0"
        class="px-2 py-1.5 text-center text-xs text-muted-foreground"
        data-font-more
      >
        {{ hidden }} more. Keep typing to narrow the list.
      </li>
      <li
        v-else-if="fonts.length === 0"
        class="px-2 py-1.5 text-center text-xs text-muted-foreground"
        data-font-none
      >
        No installed fonts were found. Type a name instead.
      </li>
      <li
        v-else-if="matches.length === 0"
        class="px-2 py-1.5 text-center text-xs text-muted-foreground"
        data-font-none
      >
        No installed font matches. The name is used as typed.
      </li>
    </ul>
  </div>
</template>
