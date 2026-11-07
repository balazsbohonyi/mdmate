<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { beginJournal, restoreOnStart } from '@/documents/session'
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
  // Before the first paint, so the window opens with the tabs the last run left.
  const restored = await restoreOnStart()
  await afterPaint()
  await host.showWindow()
  reportWindowShown()
  // After the window is up, so it does not count against startup. It reports its own failure.
  void watchDisk()
  void beginJournal(restored)
})
</script>

<template>
  <AppShell :platform-name="platformName" />
</template>
