<script setup lang="ts">
/**
 * One labelled item of the gallery in the Theme preview: a small caption and what it shows. The id
 * goes on the figure as `data-gallery-item`, which is how a test and the real-window script find it.
 * The caption is not a heading: the gallery's headings are the sub-group headings of Settings.
 */
defineProps<{ id: string; label: string }>()
</script>

<template>
  <figure
    class="min-w-0"
    :data-gallery-item="id"
  >
    <figcaption class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {{ label }}
    </figcaption>
    <slot />
  </figure>
</template>
