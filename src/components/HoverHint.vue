<script setup lang="ts">
import { ref } from 'vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A tooltip for the one element in the slot: the themed shadcn Tooltip, never the native title
 * (ISC-222). Empty text turns it off. Newlines in the text become lines. `delayDuration` is how
 * long a hover waits (the provider's delay when left out). `whenTruncated` shows the hint only
 * while the slot element's text is cut off with an ellipsis (ISC-224).
 */
const {
  text,
  side = 'top',
  delayDuration = undefined,
  whenTruncated = false,
} = defineProps<{
  text: string | null | undefined
  side?: 'top' | 'right' | 'bottom' | 'left'
  delayDuration?: number | undefined
  whenTruncated?: boolean
}>()

const open = ref(false)
let measured: HTMLElement | null = null

/** The slot element is the one that is cut off; it is measured as the pointer arrives. */
function remember(event: PointerEvent): void {
  measured = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
}

function isCutOff(): boolean {
  return measured !== null && measured.scrollWidth > measured.clientWidth + 0.5
}

function onOpenChange(next: boolean): void {
  open.value = next && (!whenTruncated || isCutOff())
}
</script>

<template>
  <Tooltip
    :open="open"
    v-bind="delayDuration === undefined ? {} : { delayDuration }"
    :disabled="text === null || text === undefined || text === ''"
    @update:open="onOpenChange"
  >
    <TooltipTrigger
      as-child
      @pointerenter="remember"
    >
      <slot />
    </TooltipTrigger>
    <TooltipContent
      data-hover-hint
      :side="side"
      class="break-words whitespace-pre-line"
    >
      {{ text }}
    </TooltipContent>
  </Tooltip>
</template>
