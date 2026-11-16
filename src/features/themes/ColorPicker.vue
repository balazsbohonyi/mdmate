<script setup lang="ts">
import {
  ColorAreaArea,
  ColorAreaRoot,
  ColorAreaThumb,
  SliderRoot,
  SliderThumb,
  SliderTrack,
} from 'reka-ui'
import { computed, reactive, ref, watch } from 'vue'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { fromHsv, toHex, toHexString, toHsv, tryParseColor, withOpacity } from '@/lib/color'
import '@/styles/colorpicker.css'

/**
 * The color picker of the theme editor: a swatch that opens one popover with a color area
 * (saturation across, brightness up), a hue slider, an alpha slider and an opacity field. It holds
 * the color as hue, saturation, brightness and alpha, so a hue chosen while the color is grey or
 * black is still there when it is not. Nothing is sent until the user changes something, and what
 * is sent is the color in the format asked for. A color it just sent comes back as `value` and is
 * not read again, so the thumbs do not jump while one is dragged.
 */

const props = defineProps<{
  /** The color as the theme has it, in either format. */
  value: string
  /** What the color is called, for the screen reader. */
  label: string
  format: 'hex' | 'oklch'
  /** The CSS the swatch is painted with (a variable of the theme, so it shows what the page shows). */
  swatch: string
}>()

const emit = defineEmits<{
  /** The user changed the color: its text in the chosen format. */
  pick: [text: string]
  /** The popover closed. */
  close: []
}>()

const open = ref(false)
const hsv = reactive({ h: 0, s: 0, v: 0, a: 1 })
/** The color last sent, as `#rrggbbaa`: what comes back as `value` is that and needs no reading. */
let sent: string | null = null

function load(value: string): void {
  const color = tryParseColor(value)
  if (color === null) return
  const next = toHsv(color, hsv.h)
  hsv.h = next.h
  hsv.s = next.s
  hsv.v = next.v
  hsv.a = color.alpha
}

watch(
  () => props.value,
  (value) => {
    const color = tryParseColor(value)
    if (color === null || toHexString(color) === sent) return
    load(value)
  },
)

watch(open, (isOpen) => {
  if (isOpen) {
    sent = null
    load(props.value)
  } else emit('close')
})

/** Sends the color held, unless it is the one the theme already has. */
function commit(): void {
  const text = withOpacity(fromHsv(hsv), hsv.a, props.format)
  const color = tryParseColor(text)
  if (color === null) return
  const hex = toHexString(color)
  const current = tryParseColor(props.value)
  if (current !== null && toHexString(current) === hex) return
  sent = hex
  emit('pick', text)
}

/** What the area sends is saturation and brightness in percent; the hue is ours, it can be lost there. */
function onArea(color: { s?: number; b?: number }): void {
  hsv.s = (color.s ?? 0) / 100
  hsv.v = (color.b ?? 0) / 100
  commit()
}

function onHue(values: number[] | undefined): void {
  const [hue] = values ?? []
  if (hue === undefined) return
  hsv.h = hue
  commit()
}

function onAlpha(values: number[] | undefined): void {
  const [percent] = values ?? []
  if (percent === undefined) return
  hsv.a = percent / 100
  commit()
}

/** Accepts an opacity typed in percent (0 to 100); anything else puts the shown one back. */
function onOpacityField(event: Event): void {
  const field = event.target as HTMLInputElement
  const percent = Number(field.value)
  if (field.value.trim() === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    field.value = String(opacity.value)
    return
  }
  hsv.a = percent / 100
  commit()
}

const opacity = computed(() => Math.round(hsv.a * 100))
const areaColor = computed(() => ({
  space: 'hsb' as const,
  h: hsv.h,
  s: hsv.s * 100,
  b: hsv.v * 100,
  alpha: hsv.a,
}))
const vars = computed(() => ({
  '--picker-hue-color': toHex(fromHsv({ h: hsv.h, s: 1, v: 1 })),
  '--picker-color': toHex(fromHsv(hsv)),
}))

const THUMB =
  'block size-4 rounded-full border-2 border-background shadow-sm ring-1 ring-foreground/70 outline-none focus-visible:ring-2 focus-visible:ring-ring'
const SLIDER = 'relative flex h-4 w-full touch-none items-center select-none'
const TRACK = 'relative h-3 w-full grow rounded-full'
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="relative size-7 shrink-0 cursor-default rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="`${props.label} color picker`"
        data-theme-picker
      >
        <span
          class="color-checker absolute inset-0 rounded-md"
          aria-hidden="true"
        />
        <span
          class="absolute inset-0 rounded-md border border-border"
          :style="{ backgroundColor: props.swatch }"
          aria-hidden="true"
          data-theme-swatch
        />
      </button>
    </PopoverTrigger>
    <PopoverContent
      class="w-60 gap-3"
      align="end"
      :style="vars"
      data-theme-picker-content
    >
      <ColorAreaRoot
        :model-value="areaColor"
        color-space="hsb"
        x-channel="saturation"
        y-channel="brightness"
        @update:color="onArea"
      >
        <ColorAreaArea
          class="color-area relative block h-36 w-full cursor-crosshair rounded-md"
          data-picker-area
        >
          <ColorAreaThumb
            :class="THUMB"
            data-picker-area-thumb
          />
        </ColorAreaArea>
      </ColorAreaRoot>
      <SliderRoot
        :model-value="[hsv.h]"
        :min="0"
        :max="360"
        :step="1"
        :class="SLIDER"
        data-picker-hue
        @update:model-value="onHue"
      >
        <SliderTrack :class="`${TRACK} color-hue-track`" />
        <SliderThumb
          :class="THUMB"
          aria-label="Hue"
        />
      </SliderRoot>
      <SliderRoot
        :model-value="[opacity]"
        :min="0"
        :max="100"
        :step="1"
        :class="SLIDER"
        data-picker-alpha
        @update:model-value="onAlpha"
      >
        <SliderTrack :class="`${TRACK} color-alpha-track`" />
        <SliderThumb
          :class="THUMB"
          aria-label="Opacity"
        />
      </SliderRoot>
      <label class="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
        Opacity
        <Input
          type="number"
          min="0"
          max="100"
          step="1"
          :model-value="opacity"
          :aria-label="`${props.label} opacity in percent`"
          class="h-7 w-16 px-1.5 text-xs"
          data-picker-opacity
          @change="onOpacityField"
          @keydown.enter="onOpacityField"
        />
        %
      </label>
    </PopoverContent>
  </Popover>
</template>
