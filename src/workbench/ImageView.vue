<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { formatBytes } from '@/lib/bytes'
import { freshImageSrc } from '@/editor/livePreview/blocks'
import { getHost } from '@/platform'
import {
  actualView,
  fitView,
  panBy,
  recall,
  remember,
  rememberedView,
  rememberView,
  zoomAbout,
  type Size,
  type View,
} from './imageView'

/**
 * An image tab: the picture, fitted to the pane to start with, with zoom, pan, and its dimensions
 * and size on disk. The picture is loaded through `<img>` and nothing else, never inline, so the
 * scripts of an SVG file cannot run.
 */

const { tabId, path, size } = defineProps<{ tabId: string; path: string; size: number }>()

const pane = useTemplateRef<HTMLElement>('pane')
const url = ref<string | null>(null)
const natural = ref<Size | null>(null)
const failed = ref(false)
const view = ref<View>({ scale: 1, x: 0, y: 0 })
/** True until the user zooms or pans: a resize then refits the picture. */
const fitted = ref(true)
let observer: ResizeObserver | undefined
let drag: { pointer: number; x: number; y: number } | undefined

function paneSize(): Size {
  const box = pane.value
  return { width: box?.clientWidth ?? 0, height: box?.clientHeight ?? 0 }
}

function fit(): void {
  if (natural.value === null) return
  view.value = fitView(natural.value, paneSize())
  fitted.value = true
}

function actual(): void {
  if (natural.value === null) return
  view.value = actualView(natural.value, paneSize())
  fitted.value = false
}

function zoom(factor: number, cx?: number, cy?: number): void {
  const box = paneSize()
  view.value = zoomAbout(view.value, factor, cx ?? box.width / 2, cy ?? box.height / 2)
  fitted.value = false
}

function loaded(event: Event): void {
  const image = event.target as HTMLImageElement
  // An SVG with no width or height has no size of its own; the browser's default stands in.
  natural.value = { width: image.naturalWidth || 300, height: image.naturalHeight || 150 }
  failed.value = false
  // Coming back to a tab the owner zoomed or moved puts the picture back as it was (ISC-233); a
  // tab that was never touched fits the pane as before.
  const saved = rememberedView(tabId)
  if (saved === undefined || saved.fitted) {
    fit()
    return
  }
  view.value = recall(saved, paneSize())
  fitted.value = false
}

function onWheel(event: WheelEvent): void {
  const box = pane.value?.getBoundingClientRect()
  if (box === undefined) return
  zoom(Math.exp(-event.deltaY * 0.0015), event.clientX - box.left, event.clientY - box.top)
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
  pane.value?.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (drag?.pointer !== event.pointerId) return
  view.value = panBy(view.value, event.clientX - drag.x, event.clientY - drag.y)
  drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
  fitted.value = false
}

function onPointerUp(event: PointerEvent): void {
  if (drag?.pointer === event.pointerId) drag = undefined
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === '+' || event.key === '=') zoom(1.25)
  else if (event.key === '-') zoom(0.8)
  else if (event.key === '0') fit()
  else if (event.key === '1') actual()
  else return
  event.preventDefault()
}

async function load(): Promise<void> {
  url.value = null
  natural.value = null
  failed.value = false
  url.value = freshImageSrc((await getHost()).assetUrl(path))
}

onMounted(() => {
  load().catch(() => {
    failed.value = true
  })
  if (pane.value !== null) {
    observer = new ResizeObserver(() => {
      if (fitted.value) fit()
    })
    observer.observe(pane.value)
  }
})
watch(
  () => path,
  () => {
    load().catch(() => {
      failed.value = true
    })
  },
)
// Every change of the picture's place is written down, once the picture is there to place.
watch([view, fitted], () => {
  if (natural.value !== null) rememberView(tabId, remember(view.value, paneSize(), fitted.value))
})
onBeforeUnmount(() => {
  observer?.disconnect()
})

const percent = computed(() => `${String(Math.round(view.value.scale * 100))}%`)
const dimensions = computed(() =>
  natural.value === null
    ? ''
    : `${String(natural.value.width)} × ${String(natural.value.height)} px`,
)
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col"
    data-image-tab
  >
    <div
      ref="pane"
      tabindex="0"
      class="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-muted outline-none active:cursor-grabbing"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @keydown="onKeyDown"
    >
      <img
        v-if="url !== null && !failed"
        :src="url"
        alt=""
        draggable="false"
        data-image
        :data-scale="view.scale"
        :data-x="view.x"
        :data-y="view.y"
        class="absolute top-0 left-0 max-w-none origin-top-left select-none"
        :class="natural === null ? 'invisible' : ''"
        :style="{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }"
        @load="loaded"
        @error="failed = true"
      />
      <p
        v-if="failed"
        class="absolute inset-0 flex items-center justify-center text-muted-foreground"
      >
        This image could not be shown.
      </p>
    </div>
    <div
      class="flex h-8 shrink-0 items-center gap-3 border-t border-border bg-background px-3 text-chrome text-muted-foreground"
      data-image-info
    >
      <span>{{ dimensions }}</span>
      <span>{{ formatBytes(size) }}</span>
      <span
        class="ml-auto"
        data-image-zoom
        >{{ percent }}</span
      >
      <button
        type="button"
        class="rounded-sm px-2 py-0.5 hover:bg-accent"
        @click="zoom(0.8)"
      >
        −
      </button>
      <button
        type="button"
        class="rounded-sm px-2 py-0.5 hover:bg-accent"
        @click="zoom(1.25)"
      >
        +
      </button>
      <button
        type="button"
        class="rounded-sm px-2 py-0.5 hover:bg-accent"
        @click="fit()"
      >
        Fit
      </button>
      <button
        type="button"
        class="rounded-sm px-2 py-0.5 hover:bg-accent"
        @click="actual()"
      >
        100%
      </button>
    </div>
  </div>
</template>
