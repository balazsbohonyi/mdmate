<script setup lang="ts">
import { Copy, Minus, Square, X } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getHost } from '@/platform'

const maximized = ref(false)
let stopListening: (() => void) | undefined

onMounted(async () => {
  const { windowControls } = await getHost()
  maximized.value = await windowControls.isMaximized()
  stopListening = await windowControls.onMaximizedChange((value) => {
    maximized.value = value
  })
})

onBeforeUnmount(() => {
  stopListening?.()
})

async function minimize(): Promise<void> {
  await (await getHost()).windowControls.minimize()
}

async function toggleMaximize(): Promise<void> {
  await (await getHost()).windowControls.toggleMaximize()
}

async function close(): Promise<void> {
  await (await getHost()).windowControls.close()
}
</script>

<template>
  <div class="flex shrink-0 items-stretch">
    <button
      type="button"
      aria-label="Minimize"
      tabindex="-1"
      class="flex w-11.5 items-center justify-center text-titlebar-foreground hover:bg-accent"
      @click="minimize"
    >
      <Minus
        class="size-3.5"
        :stroke-width="1.5"
      />
    </button>
    <button
      type="button"
      :aria-label="maximized ? 'Restore' : 'Maximize'"
      tabindex="-1"
      class="flex w-11.5 items-center justify-center text-titlebar-foreground hover:bg-accent"
      @click="toggleMaximize"
    >
      <Copy
        v-if="maximized"
        class="size-3"
        :stroke-width="1.5"
      />
      <Square
        v-else
        class="size-3"
        :stroke-width="1.5"
      />
    </button>
    <button
      type="button"
      aria-label="Close"
      tabindex="-1"
      class="flex w-11.5 items-center justify-center text-titlebar-foreground hover:bg-destructive hover:text-background"
      @click="close"
    >
      <X
        class="size-3.5"
        :stroke-width="1.5"
      />
    </button>
  </div>
</template>
