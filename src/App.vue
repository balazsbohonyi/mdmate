<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { reportWindowShown } from '@/lib/lifecycle'
import { getHost } from '@/platform'

const platformName = ref('')

/** Resolves after the browser has painted the current frame. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
  })
}

onMounted(async () => {
  const host = await getHost()
  platformName.value = await host.platformName()
  await afterPaint()
  await host.showWindow()
  reportWindowShown()
})
</script>

<template>
  <main
    class="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground"
  >
    <span>mdmate on {{ platformName }}</span>
  </main>
</template>
