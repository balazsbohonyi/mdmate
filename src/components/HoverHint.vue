<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A tooltip for the one element in the slot: the themed shadcn Tooltip, never the native title
 * (ISC-222). Empty text turns it off. Newlines in the text become lines.
 */
const { text, side = 'top' } = defineProps<{
  text: string | null | undefined
  side?: 'top' | 'right' | 'bottom' | 'left'
}>()
</script>

<template>
  <Tooltip :disabled="text === null || text === undefined || text === ''">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipContent
      data-hover-hint
      :side="side"
      class="break-all whitespace-pre-line"
    >
      {{ text }}
    </TooltipContent>
  </Tooltip>
</template>
