<script setup lang="ts">
import { computed } from 'vue'
import {
  SETTINGS_CATEGORIES,
  settingsCategoryLabel,
  type SettingsCategory,
} from '@/lib/settingsCategories'
import { setSettingsCategory, settingsCategoryOf } from '@/workbench/store'

/**
 * The Settings tab's screen: the five groups on the left and the open one on the right. It loads
 * the first time the tab is shown (check-arch: settings-lazy). The rows of each group are P8-T1d's.
 */
const { tabId } = defineProps<{ tabId: string }>()

const category = computed(() => settingsCategoryOf(tabId))
const label = computed(() => settingsCategoryLabel(category.value))

function choose(id: SettingsCategory): void {
  setSettingsCategory(tabId, id)
}
</script>

<template>
  <div
    class="flex min-h-0 flex-1"
    data-settings-view
  >
    <nav
      aria-label="Settings groups"
      class="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2"
    >
      <button
        v-for="item in SETTINGS_CATEGORIES"
        :key="item.id"
        type="button"
        :data-settings-category="item.id"
        :aria-current="category === item.id ? 'page' : undefined"
        class="cursor-default rounded-sm px-3 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
        :class="category === item.id ? 'bg-accent text-foreground' : 'text-muted-foreground'"
        @click="choose(item.id)"
      >
        {{ item.label }}
      </button>
    </nav>
    <section
      :aria-label="label"
      class="min-w-0 flex-1 overflow-y-auto p-6"
      data-settings-panel
    >
      <h1
        class="text-lg font-medium"
        data-settings-heading
      >
        {{ label }}
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">This group has no settings yet.</p>
    </section>
  </div>
</template>
