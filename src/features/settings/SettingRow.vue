<script setup lang="ts">
import { RotateCcw } from '@lucide/vue'
import HoverHint from '@/components/HoverHint.vue'
import { Button } from '@/components/ui/button'

/**
 * The one row every setting uses: its label and a one-line description on the left, its control
 * on the right (the slot), the JSON key in muted text, and, only while the value differs from the
 * default, a dot and a reset icon. An error from the control or from the file shows under the
 * control. A locked row says why it cannot be changed. Loaded with the screen (settings-lazy).
 */
const {
  settingKey,
  label,
  description,
  modified,
  error,
  locked,
  fieldResets = false,
  alsoKey = undefined,
} = defineProps<{
  /** The key in the file, or null for a row that is an action and not a setting. */
  settingKey: string | null
  label: string
  description: string
  modified: boolean
  error: string | null
  /** Why the row cannot be changed, or null. */
  locked: string | null
  /**
   * The row holds more than one setting and each field has its own reset, so the label shows the
   * changed dot but no reset of its own.
   */
  fieldResets?: boolean
  /** The key of a second setting the row holds, shown after the first. */
  alsoKey?: string | undefined
}>()

const emit = defineEmits<{ reset: [] }>()
</script>

<template>
  <div
    class="grid grid-cols-[minmax(0,1fr)_minmax(0,16rem)] items-start gap-x-6 gap-y-1 border-b border-border py-3"
    :data-setting-row="settingKey ?? undefined"
    :data-setting-action="settingKey === null ? 'true' : undefined"
    :data-modified="modified ? 'true' : undefined"
  >
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-foreground">{{ label }}</span>
        <HoverHint
          v-if="modified"
          text="Changed from the default"
        >
          <span
            class="size-1.5 shrink-0 rounded-full bg-primary"
            role="img"
            aria-label="Modified"
            data-setting-modified
          />
        </HoverHint>
        <HoverHint
          v-if="modified && locked === null && !fieldResets"
          text="Reset to the default"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            :aria-label="`Reset ${label}`"
            data-setting-reset
            @click="emit('reset')"
          >
            <RotateCcw />
          </Button>
        </HoverHint>
      </div>
      <p class="text-chrome text-muted-foreground">{{ description }}</p>
      <code
        v-if="settingKey !== null"
        class="text-xs text-muted-foreground/80"
        data-setting-key
        >{{ settingKey }}</code
      >
      <code
        v-if="alsoKey !== undefined"
        class="ml-2 text-xs text-muted-foreground/80"
        data-setting-key-also
        >{{ alsoKey }}</code
      >
    </div>
    <div class="flex min-w-0 flex-col items-stretch gap-1">
      <slot />
      <p
        v-if="locked !== null"
        class="text-xs text-muted-foreground"
        data-setting-locked
      >
        {{ locked }}
      </p>
      <p
        v-if="error !== null"
        role="alert"
        class="text-xs text-destructive"
        data-setting-error
      >
        {{ error }}
      </p>
    </div>
  </div>
</template>
