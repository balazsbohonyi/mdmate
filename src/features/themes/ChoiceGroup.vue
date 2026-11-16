<script setup lang="ts" generic="T extends string">
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/**
 * One choice out of a few, drawn as a toggle group: the buttons sit side by side, the chosen one in
 * the primary color. Pressing the chosen one again keeps it chosen (there is always an answer).
 * `itemAttr` names a data attribute each button carries its value in, which tests and the real
 * window use to find it.
 */

const props = defineProps<{
  options: readonly { readonly value: T; readonly label: string }[]
  label: string
  itemAttr: string
  size?: 'default' | 'sm'
}>()

const chosen = defineModel<T>({ required: true })

function onChange(value: unknown): void {
  const match = props.options.find((option) => option.value === value)
  if (match !== undefined) chosen.value = match.value
}
</script>

<template>
  <ToggleGroup
    type="single"
    variant="outline"
    :size="props.size ?? 'sm'"
    :model-value="chosen"
    :aria-label="props.label"
    data-theme-choice-group
    @update:model-value="onChange"
  >
    <ToggleGroupItem
      v-for="option in props.options"
      :key="option.value"
      :value="option.value"
      :[props.itemAttr]="option.value"
      class="data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground"
    >
      {{ option.label }}
    </ToggleGroupItem>
  </ToggleGroup>
</template>
