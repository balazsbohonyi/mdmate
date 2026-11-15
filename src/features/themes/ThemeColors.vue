<script setup lang="ts">
import { computed, reactive } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BUILT_IN_THEMES } from '@/lib/builtinThemes'
import { contrast, formatColor, toHex, tryParseColor } from '@/lib/color'
import { settings } from '@/lib/settings'
import { checkThemeColor } from '@/lib/themeFile'
import { effectiveTokens } from '@/lib/themes'
import { CONTRAST_PAIRS, THEME_GROUPS, THEME_TOKENS, tokensOf } from '@/lib/themeTokens'
import SubGroupHeading from '@/features/settings/SubGroupHeading.vue'
import { changeThemeColor, customizeTheme } from './customize'
import { currentTheme } from './store'

/**
 * The color editor on the Appearance page: every token of the theme in force, in groups, each with
 * a swatch (a color picker where it can hold the color), a text field, and a warning when the color
 * brings a required pair of text and surface under its contrast floor. A built-in theme has no
 * editor, only Customize, which copies it into a file you can edit; a color changed here is written
 * to the theme's file as it changes. Loaded with the Settings screen (settings-lazy).
 */

const shown = computed(() => currentTheme.value)
const user = computed(() => shown.value.user)
const colors = computed(() => effectiveTokens(shown.value))
const baseName = computed(() => (user.value === null ? '' : BUILT_IN_THEMES[user.value.base].label))

const labels = new Map(THEME_TOKENS.map((token) => [token.name, token.label]))

/** Text typed into a field and not yet accepted, by token. The file's color shows when there is none. */
const drafts = reactive<Record<string, string>>({})
/** Why a typed color was refused, by token. The file keeps its color. */
const refused = reactive<Record<string, string>>({})

function valueOf(token: string): string {
  return colors.value.get(token) ?? ''
}

/** The format every color is shown in, and a changed one is written in. */
const format = computed(() => settings.themes.colorFormat)

/** A color as the field shows it: in the chosen format, as written when it already is in it. */
function displayed(token: string): string {
  return formatColor(valueOf(token), format.value)
}

function shownText(token: string): string {
  return drafts[token] ?? displayed(token)
}

/** The picker holds `#rrggbb`: only a color with no alpha fits it, or the alpha would be lost. */
function pickerValue(token: string): string | null {
  const parsed = tryParseColor(valueOf(token))
  return parsed === null || parsed.alpha < 1 ? null : toHex(parsed)
}

function onPick(token: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  delete drafts[token]
  delete refused[token]
  void changeThemeColor(token, formatColor(value, format.value))
}

function onType(token: string, text: string | number): void {
  drafts[token] = String(text)
}

/** Accepts what was typed when the field is left or Enter is pressed: checked, then written. */
function accept(token: string): void {
  const text = drafts[token]
  if (text === undefined) return
  const checked = checkThemeColor(text)
  if (!checked.ok) {
    refused[token] = checked.why
    return
  }
  delete drafts[token]
  delete refused[token]
  // Written in the chosen format, and not at all when it is what the field already showed.
  const written = formatColor(checked.value, format.value)
  if (written !== displayed(token)) void changeThemeColor(token, written, true)
}

function revert(token: string): void {
  delete drafts[token]
  delete refused[token]
}

/** The pairs of text and surface that are under their floor, as a line for each token in them. */
const warnings = computed(() => {
  const found = new Map<string, string[]>()
  if (settings.themes.hideContrastWarnings) return found
  for (const [text, surface, floor] of CONTRAST_PAIRS) {
    const a = tryParseColor(valueOf(text))
    const b = tryParseColor(valueOf(surface))
    if (a === null || b === null) continue
    const ratio = contrast(a, b)
    if (ratio >= floor) continue
    const line = `${labels.get(text) ?? text} on ${labels.get(surface) ?? surface}: contrast ${ratio.toFixed(2)}, it should be at least ${String(floor)}.`
    for (const token of [text, surface]) found.set(token, [...(found.get(token) ?? []), line])
  }
  return found
})

function customize(): void {
  customizeTheme().catch((error: unknown) => {
    console.error('Could not customize the theme', error)
  })
}
</script>

<template>
  <section
    aria-label="Theme colors"
    class="mt-4"
    data-theme-colors
  >
    <div
      v-if="user === null"
      class="mt-2 flex flex-wrap items-center gap-3"
      data-theme-builtin
    >
      <p class="min-w-0 flex-1 text-chrome text-muted-foreground">
        {{ shown.label }} is built in and cannot be changed. Customize makes a copy in your themes
        folder, selects it, and lets you change its colors here or in the file.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-theme-customize
        @click="customize"
      >
        Customize
      </Button>
    </div>
    <template v-else>
      <div class="mt-2 flex flex-wrap items-center gap-3">
        <p
          class="min-w-0 flex-1 text-chrome text-muted-foreground"
          data-theme-editing
        >
          Editing {{ user.label }} (themes/{{ user.id }}.json), based on {{ baseName }}. A color is
          written to the file as you change it, and a color the file leaves out comes from
          {{ baseName }}.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-theme-customize
          @click="customize"
        >
          Duplicate
        </Button>
      </div>
      <!-- What the Settings screen puts above the colors of a theme being edited. -->
      <slot name="user-options" />
      <div
        v-for="group in THEME_GROUPS"
        :key="group.id"
        class="mt-6"
        :data-theme-group="group.id"
      >
        <SubGroupHeading :level="3">{{ group.label }}</SubGroupHeading>
        <div
          v-for="token in tokensOf(group.id)"
          :key="token.name"
          class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,19rem)] items-center gap-x-3 border-b border-border py-1.5"
          :data-theme-token="token.name"
        >
          <div class="min-w-0">
            <span class="text-sm text-foreground">{{ token.label }}</span>
            <code class="ml-2 text-xs text-muted-foreground/80">--{{ token.name }}</code>
          </div>
          <div class="relative size-7 shrink-0">
            <span
              class="absolute inset-0 rounded-md border border-border"
              :style="{ backgroundColor: `var(--${token.name})` }"
              aria-hidden="true"
              data-theme-swatch
            />
            <input
              v-if="pickerValue(token.name) !== null"
              type="color"
              class="absolute inset-0 size-full cursor-default opacity-0"
              :value="pickerValue(token.name) ?? undefined"
              :aria-label="`${token.label} color picker`"
              data-theme-picker
              @input="onPick(token.name, $event)"
            />
          </div>
          <Input
            :model-value="shownText(token.name)"
            :aria-label="token.label"
            :aria-invalid="refused[token.name] !== undefined ? true : undefined"
            class="font-mono text-xs"
            data-theme-text
            @update:model-value="(text: string | number) => onType(token.name, text)"
            @change="accept(token.name)"
            @keydown.enter="accept(token.name)"
            @keydown.esc="revert(token.name)"
          />
          <p
            v-if="refused[token.name] !== undefined"
            role="alert"
            class="col-span-full pb-1 text-xs text-destructive"
            data-theme-error
          >
            {{ refused[token.name] }}
          </p>
          <p
            v-for="line in warnings.get(token.name) ?? []"
            :key="line"
            role="status"
            class="col-span-full pb-1 text-xs text-warning"
            data-theme-warning
          >
            {{ line }}
          </p>
        </div>
      </div>
    </template>
  </section>
</template>
