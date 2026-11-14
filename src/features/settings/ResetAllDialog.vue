<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { ResetKind } from './store'

/**
 * The question before every setting, or every shortcut, goes back to its default. Cancel has the
 * focus, so a stray Enter resets nothing; Escape and a click outside also cancel.
 */
const { kind } = defineProps<{ kind: ResetKind }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirm: [kind: ResetKind] }>()

const words = computed(() =>
  kind === 'settings'
    ? {
        title: 'Reset all settings?',
        action: 'Reset all settings',
        line: 'Every setting goes back to its default.',
        file: 'settings.json',
        unknown: 'a setting this version does not know',
      }
    : {
        title: 'Reset all shortcuts?',
        action: 'Reset all shortcuts',
        line: 'Every command goes back to its default shortcut.',
        file: 'keybindings.json',
        unknown: 'a command this version does not have',
      },
)
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent
      data-reset-dialog
      class="sm:max-w-sm"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{{ words.title }}</AlertDialogTitle>
        <AlertDialogDescription as-child>
          <div class="grid gap-1">
            <p>{{ words.line }}</p>
            <p>
              {{ words.file }} keeps its comments. An entry in it for {{ words.unknown }} is removed
              too.
            </p>
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel data-reset-cancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          data-reset-confirm
          @click="emit('confirm', kind)"
        >
          {{ words.action }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
