<script setup lang="ts">
defineProps<{ platformName: string }>()
</script>

<template>
  <footer
    class="flex h-statusbar shrink-0 items-center justify-between bg-statusbar px-3 text-xs text-statusbar-foreground select-none"
  >
    <span>No file open</span>
    <span>{{ platformName }}</span>
  </footer>
</template>
