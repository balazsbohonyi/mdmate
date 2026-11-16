<script setup lang="ts">
import { onMounted } from 'vue'
import { beginJournal, restoreOnStart } from '@/documents/session'
import { watchDisk } from '@/documents/store'
import { installFileDrop } from '@/features/drop'
import { loadKeybindings, watchKeybindingsFile } from '@/features/keybindings/store'
import { loadSettings, watchSettingsFile } from '@/features/settings/store'
import { loadThemes, watchSystemAppearance, watchThemesFolder } from '@/features/themes/store'
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
  // First, so what the settings change (fonts, wrapping, the large-file size) is in force when the
  // first document is made. A file that cannot be used costs the settings, never the start.
  // The system's light or dark first, so System resolves right the first time a theme is applied.
  watchSystemAppearance()
  await loadSettings()
  // Before the first paint too, so a user theme is on the page before the window shows.
  await loadThemes()
  // Also before the first paint: a saved shortcut works from the first key press.
  await loadKeybindings()
  // Before the first paint, so the window opens with the tabs the last run left.
  const restored = await restoreOnStart()
  await afterPaint()
  await host.showWindow()
  reportWindowShown()
  // After the window is up, so it does not count against startup. It reports its own failure.
  void watchDisk()
  void watchSettingsFile().catch((error: unknown) => {
    console.error('Could not watch settings.json', error)
  })
  void watchThemesFolder().catch((error: unknown) => {
    console.error('Could not watch the themes folder', error)
  })
  void watchKeybindingsFile().catch((error: unknown) => {
    console.error('Could not watch keybindings.json', error)
  })
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
