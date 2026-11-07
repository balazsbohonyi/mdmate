<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { watchDisk } from '@/documents/store'
import { reportWindowShown } from '@/lib/lifecycle'
import { getHost } from '@/platform'
import AppShell from '@/shell/AppShell.vue'

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
  // After the window is up, so it does not count against startup. It reports its own failure.
  void watchDisk()
})
</script>

<template>
  <AppShell :platform-name="platformName" />
</template>
