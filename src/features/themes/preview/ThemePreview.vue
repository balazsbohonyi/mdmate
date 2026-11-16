<script setup lang="ts">
import PreviewGallery from './PreviewGallery.vue'
import MiniApp from './MiniApp.vue'
import StatesStrip from './StatesStrip.vue'

/**
 * The Theme preview tab: the theme in force drawn as a small copy of the app. It holds nothing of
 * its own and reads no store: every color comes from the tokens on the root, so a color changed in
 * Settings shows here at once. Loaded the first time its tab is shown (theme-preview-lazy).
 */
</script>

<template>
  <div
    class="@container min-h-0 flex-1 overflow-y-auto bg-background p-6 text-foreground"
    data-theme-preview
  >
    <h1 class="text-lg font-semibold">Theme preview</h1>
    <p class="mt-1 text-chrome text-muted-foreground">
      The theme in force, drawn small. Change a color in Settings and this follows.
    </p>
    <!-- The page is the container: the miniature drops its sidebar when the pane is narrow instead of squeezing the note. -->
    <p
      class="mt-3 text-xs text-muted-foreground @lg:hidden"
      data-preview-narrow
    >
      The sidebar of the sample is left out while this pane is narrow. Widen it to see it.
    </p>
    <section
      class="mt-3 h-[34rem] overflow-hidden rounded-lg border border-border"
      aria-label="The app"
      data-preview-app
    >
      <MiniApp />
    </section>
    <PreviewGallery />
    <StatesStrip />
  </div>
</template>
