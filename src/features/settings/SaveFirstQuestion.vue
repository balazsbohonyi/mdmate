<script setup lang="ts">
import { Button } from '@/components/ui/button'

/**
 * The bar shown while a change waits because the file's own tab holds edits that are not saved:
 * Save, Don't save, or Cancel the change. The Settings screen shows one for `settings.json` and one
 * for `keybindings.json`, whichever page asked.
 */
defineProps<{
  file: string
  /** What the change is about: a setting's name, a command's title, or "all shortcuts". */
  label: string
  /** Why the last Save failed, or null. */
  error: string | null
}>()
const emit = defineEmits<{ answer: [choice: 'save' | 'discard' | 'cancel'] }>()
</script>

<template>
  <div
    role="alert"
    class="flex shrink-0 items-center gap-3 border-b border-border bg-muted px-3 py-1.5 text-chrome"
  >
    <span class="min-w-0 flex-1">
      {{ file }} has changes you have not saved. Save them before changing {{ label }}?
      <span
        v-if="error !== null"
        class="text-destructive"
      >
        Could not save: {{ error }}
      </span>
    </span>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      @click="emit('answer', 'save')"
    >
      Save
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      @click="emit('answer', 'discard')"
    >
      Don't save
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      @click="emit('answer', 'cancel')"
    >
      Cancel
    </Button>
  </div>
</template>
