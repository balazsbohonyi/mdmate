<script setup lang="ts">
import { onMounted } from 'vue'
import { beginJournal, restoreOnStart } from '@/documents/session'
import { watchDisk } from '@/documents/store'
import { installFileDrop } from '@/features/drop'
import { reportWindowShown } from '@/lib/lifecycle'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getHost } from '@/platform'
import AppShell from '@/shell/AppShell.vue'

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
  // Before the first paint, so the window opens with the tabs the last run left.
  const restored = await restoreOnStart()
  await afterPaint()
  await host.showWindow()
  reportWindowShown()
  // After the window is up, so it does not count against startup. It reports its own failure.
  void watchDisk()
  void installFileDrop().catch((error: unknown) => {
    console.error('Could not listen for dropped files', error)
  })
  void beginJournal(restored)
})
</script>

<template>
  <TooltipProvider
    :delay-duration="300"
    :skip-delay-duration="0"
  >
    <AppShell />
  </TooltipProvider>
</template>
