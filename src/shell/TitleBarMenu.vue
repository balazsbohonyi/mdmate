<script setup lang="ts">
import { Menu } from '@lucide/vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { MenuEntry } from './menuEntries'

defineProps<{ entries: readonly MenuEntry[] }>()
const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        aria-label="Menu"
        class="flex w-titlebar shrink-0 items-center justify-center text-titlebar-foreground outline-none hover:bg-accent focus-visible:bg-accent data-[state=open]:bg-accent"
      >
        <Menu
          class="size-4"
          :stroke-width="1.5"
        />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="start"
      :side-offset="0"
      class="min-w-52"
    >
      <template
        v-for="(entry, index) in entries"
        :key="entry.kind === 'item' ? entry.id : `separator-${index}`"
      >
        <DropdownMenuSeparator v-if="entry.kind === 'separator'" />
        <DropdownMenuItem
          v-else
          :disabled="entry.disabled ?? false"
          @select="emit('select', entry.id)"
        >
          {{ entry.label }}
          <DropdownMenuShortcut v-if="entry.shortcut">{{ entry.shortcut }}</DropdownMenuShortcut>
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
