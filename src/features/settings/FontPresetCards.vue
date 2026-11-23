<script setup lang="ts">
import { FONT_PRESET_IDS, FONT_PRESETS, type FontPresetId } from '@/lib/fontPresets'

/**
 * Four clickable live specimen cards for selecting a Markdown font preset (P9.1-T38): System
 * (default non-bundled monospace), plus Editorial, Modern and Journal (bundled Google Fonts).
 * Each card draws a sample heading, body sentence with optically scaled inline code, and multi-line
 * code snippet in that preset's fonts, using only design tokens.
 */
const { modelValue, customized } = defineProps<{
  /** The active preset id from `settings.fonts.preset`. */
  modelValue: FontPresetId
  /** True while any individual heading, body or code font override is set. */
  customized: boolean
}>()

const emit = defineEmits<{
  select: [preset: FontPresetId]
}>()

const presets = FONT_PRESET_IDS.map((id) => FONT_PRESETS[id])
</script>

<template>
  <div class="@container">
    <div
      role="radiogroup"
      aria-label="Font preset"
      class="grid grid-cols-1 gap-3 @[30rem]:grid-cols-2"
      data-font-preset-cards
    >
      <button
        v-for="preset in presets"
        :key="preset.id"
        type="button"
        role="radio"
        :aria-checked="modelValue === preset.id"
        :data-font-preset-card="preset.id"
        :data-active="modelValue === preset.id ? 'true' : undefined"
        :data-customized="modelValue === preset.id && customized ? 'true' : undefined"
        class="flex cursor-default flex-col rounded-lg border bg-card p-3 text-left text-card-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        :class="
          modelValue === preset.id
            ? 'border-primary ring-1 ring-primary/40'
            : 'border-border hover:border-foreground/30'
        "
        @click="emit('select', preset.id)"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-semibold text-card-foreground">{{ preset.label }}</span>
          <span
            v-if="modelValue === preset.id && !customized"
            class="rounded-sm border border-success/50 bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success"
            data-font-preset-state="in-use"
          >
            In use
          </span>
          <span
            v-else-if="modelValue === preset.id && customized"
            class="rounded-sm border border-primary/50 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
            data-font-preset-state="customized"
          >
            Customized
          </span>
        </div>
        <div
          class="mt-2 flex flex-1 flex-col rounded-md border border-border bg-background p-2.5 text-foreground"
          data-font-preset-specimen
        >
          <div
            class="truncate text-base leading-snug font-semibold text-syntax-heading"
            :style="{ fontFamily: preset.heading.stack }"
            data-font-preset-heading
          >
            Markdown Notes
          </div>
          <p
            class="mt-1 text-sm leading-relaxed text-foreground"
            :style="{ fontFamily: preset.body.stack }"
            data-font-preset-body
          >
            Clear prose with
            <code
              class="rounded-sm border border-syntax-code-border bg-syntax-code-background px-0.5 text-syntax-code"
              :style="{
                fontFamily: preset.code.stack,
                fontSize: `${String(preset.inlineCodeScale)}em`,
              }"
              data-font-preset-inline-code
              >inline()</code
            >
            code.
          </p>
          <pre
            class="mt-2 overflow-hidden rounded-sm border border-syntax-code-border bg-syntax-code-background px-2 py-1.5 text-xs leading-snug text-syntax-code"
            :style="{ fontFamily: preset.code.stack }"
            data-font-preset-code-block
          ><code>const sum = (a, b) => a + b
return sum(1, 2) !== 0</code></pre>
        </div>
        <p class="mt-2 truncate text-xs text-muted-foreground">
          {{ preset.heading.name }} · {{ preset.body.name }} · {{ preset.code.name }}
        </p>
      </button>
    </div>
  </div>
</template>
