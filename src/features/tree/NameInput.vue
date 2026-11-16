<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { stemLength } from './model'

/**
 * The box a name is typed in, inside a row of the tree. Enter keeps the name, Escape drops it, and
 * so does leaving the box: clicking elsewhere never creates or renames anything by accident.
 *
 * The refusal is a bubble under the box. It hangs from the row, not from the box: the box is only
 * what is left of the row after the indent and the icons, and the tree clips what sticks out past
 * its edge, so a bubble the width of its text is cut off. Anchored to the row and capped at the
 * row width, it wraps instead.
 */
const props = defineProps<{
  initial: string
  /** Why the last attempt was refused; shown under the box. */
  error: string | null
  /** True for a rename of a file, where only the part before the extension starts selected. */
  stem: boolean
  label: string
}>()
const emit = defineEmits<{
  commit: [name: string]
  cancel: []
}>()

const input = ref<HTMLInputElement | null>(null)
const value = ref(props.initial)

onMounted(async () => {
  await nextTick()
  const element = input.value
  if (element === null) return
  element.focus()
  element.setSelectionRange(0, props.stem ? stemLength(props.initial) : props.initial.length)
})

function onBlur(): void {
  emit('cancel')
}
</script>

<template>
  <span class="min-w-0 flex-1">
    <input
      ref="input"
      v-model="value"
      type="text"
      spellcheck="false"
      autocomplete="off"
      :aria-label="label"
      :aria-invalid="error !== null"
      data-name-input
      class="h-5 w-full rounded-sm border bg-background px-1 text-chrome text-foreground outline-none"
      :class="error === null ? 'border-ring' : 'border-destructive'"
      @keydown.enter.prevent.stop="emit('commit', value)"
      @keydown.esc.prevent.stop="emit('cancel')"
      @keydown.stop
      @click.stop
      @pointerdown.stop
      @blur="onBlur"
    />
    <span
      v-if="error !== null"
      role="alert"
      data-name-error
      class="absolute top-full left-1 z-20 mt-0.5 w-max max-w-[min(14rem,calc(100%-0.5rem))] rounded-sm bg-destructive px-1.5 py-0.5 text-chrome text-destructive-foreground shadow"
    >
      {{ error }}
    </span>
  </span>
</template>
