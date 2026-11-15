<script setup lang="ts">
/**
 * The heading of a sub-group on the Settings screen: Theme and Fonts in Appearance, Theme colors
 * and its color groups, and the groups of the Keyboard page. One component so every sub-group looks
 * the same and takes the theme's `--primary`, which is what sets it apart from a page title and a
 * row label. `level` 2 is a group of rows, 3 a group inside one; `first` trims the space above the
 * first heading of a page, which sits right under the page title.
 */
withDefaults(defineProps<{ level?: 2 | 3; first?: boolean }>(), { level: 2, first: false })
</script>

<template>
  <component
    :is="level === 2 ? 'h2' : 'h3'"
    class="font-semibold text-primary"
    :class="level === 2 ? ['mb-1 text-base', first ? 'mt-4' : 'mt-10'] : 'mb-1 text-sm'"
    data-sub-group-heading
  >
    <slot />
  </component>
</template>
