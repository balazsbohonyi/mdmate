<script setup lang="ts">
import { Menu } from '@lucide/vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import HoverHint from '@/components/HoverHint.vue'
import type { MenuEntry } from './menuEntries'

defineProps<{ entries: readonly MenuEntry[] }>()
const emit = defineEmits<{ select: [id: string]; open: [] }>()

function opened(open: boolean): void {
  if (open) emit('open')
}
</script>

<template>
  <DropdownMenu @update:open="opened">
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
      class="min-w-64"
    >
      <template
        v-for="(entry, index) in entries"
        :key="entry.kind === 'item' ? entry.id : `${entry.kind}-${index}`"
      >
        <DropdownMenuSeparator v-if="entry.kind === 'separator'" />
        <DropdownMenuSub v-else-if="entry.kind === 'submenu'">
          <DropdownMenuSubTrigger class="whitespace-nowrap">
            {{ entry.label }}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent class="max-w-96 min-w-56">
            <template
              v-for="(item, at) in entry.items"
              :key="item.kind === 'item' ? item.id : `${item.kind}-${at}`"
            >
              <DropdownMenuSeparator v-if="item.kind === 'separator'" />
              <DropdownMenuLabel v-else-if="item.kind === 'heading'">
                {{ item.label }}
              </DropdownMenuLabel>
              <HoverHint
                v-else
                :text="item.detail ? `${item.detail}/${item.label}` : item.label"
                side="right"
              >
                <DropdownMenuItem
                  class="whitespace-nowrap"
                  :disabled="item.disabled ?? false"
                  @select="emit('select', item.id)"
                >
                  <span class="max-w-64 shrink-0 truncate">{{ item.label }}</span>
                  <span
                    v-if="item.detail"
                    class="ml-auto min-w-0 truncate pl-3 text-xs text-muted-foreground"
                  >
                    {{ item.detail }}
                  </span>
                </DropdownMenuItem>
              </HoverHint>
            </template>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          v-else
          class="whitespace-nowrap"
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
