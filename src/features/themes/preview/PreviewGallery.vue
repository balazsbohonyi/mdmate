<script setup lang="ts">
import SubGroupHeading from '@/features/settings/SubGroupHeading.vue'
import { Plus, Settings, Trash2 } from '@lucide/vue'
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import GalleryItem from './GalleryItem.vue'
import GalleryPanels from './GalleryPanels.vue'

/**
 * The controls of the app, below the miniature: every button variant and size, a text field,
 * switches, a dropdown, the messages a screen shows, and a scrollbar. They are the real components
 * with their own local state, so hover, focus and typing work and change nothing else. The floating
 * surfaces are in GalleryPanels, and the fixed states strip comes after them.
 */

const VARIANTS = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const
const SIZES = ['xs', 'sm', 'default', 'lg'] as const

const field = ref('Tidewatch')
const on = ref(true)
const off = ref(false)
const choice = ref('dark')

const LINES = Array.from({ length: 14 }, (_, at) => `Line ${String(at + 1)} of a long list`)
</script>

<template>
  <SubGroupHeading data-gallery-title>Components</SubGroupHeading>
  <p class="mt-1 text-chrome text-muted-foreground">
    The controls and surfaces of the app. Hover, focus and type in the live ones.
  </p>
  <div
    class="mt-4 grid gap-x-6 gap-y-6 @2xl:grid-cols-2"
    data-gallery
  >
    <GalleryItem
      id="buttons"
      label="Buttons"
    >
      <div class="flex flex-wrap items-center gap-2">
        <Button
          v-for="variant in VARIANTS"
          :key="variant"
          type="button"
          :variant="variant"
          :data-gallery-variant="variant"
        >
          {{ variant }}
        </Button>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <Button
          v-for="size in SIZES"
          :key="size"
          type="button"
          variant="outline"
          :size="size"
          :data-gallery-size="size"
        >
          {{ size }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Add"
          data-gallery-size="icon"
        >
          <Plus />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete"
          data-gallery-size="icon-sm"
        >
          <Trash2 />
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled
          data-gallery-size="disabled"
        >
          <Settings data-icon="inline-start" />
          disabled
        </Button>
      </div>
    </GalleryItem>

    <GalleryItem
      id="field"
      label="Text field"
    >
      <div class="grid max-w-sm gap-2">
        <Input
          v-model="field"
          aria-label="A text field"
          placeholder="Type here"
          spellcheck="false"
        />
        <Input
          model-value=""
          aria-label="An empty text field"
          placeholder="Placeholder"
          readonly
        />
      </div>
    </GalleryItem>

    <GalleryItem
      id="switch"
      label="Switch"
    >
      <div class="flex items-center gap-6 text-chrome">
        <label class="flex items-center gap-2">
          <Switch
            v-model="on"
            aria-label="A switch that is on"
          />
          On
        </label>
        <label class="flex items-center gap-2">
          <Switch
            v-model="off"
            aria-label="A switch that is off"
          />
          Off
        </label>
      </div>
    </GalleryItem>

    <GalleryItem
      id="dropdown"
      label="Dropdown"
    >
      <Select v-model="choice">
        <SelectTrigger
          class="w-full max-w-sm"
          aria-label="A dropdown"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="dark">Dark</SelectItem>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="sepia">Sepia</SelectItem>
          <SelectItem value="monochrome">Monochrome</SelectItem>
        </SelectContent>
      </Select>
    </GalleryItem>

    <GalleryPanels />

    <GalleryItem
      id="messages"
      label="Messages"
    >
      <div class="grid max-w-sm gap-2 text-chrome">
        <p class="rounded-lg border border-success/50 bg-success/10 px-3 py-2 text-success">
          Saved. The theme file is written.
        </p>
        <p class="text-xs text-warning">This color is hard to read on its background.</p>
        <p class="text-destructive">The name is already taken.</p>
        <div class="rounded-lg border border-border bg-card p-3 text-card-foreground">
          A card, as the theme list uses.
        </div>
      </div>
    </GalleryItem>

    <GalleryItem
      id="scrollbar"
      label="Scrollbar"
    >
      <div
        class="h-28 max-w-sm overflow-y-scroll rounded-md border border-border p-3 text-chrome"
        tabindex="0"
        aria-label="A list that scrolls"
        data-gallery-scroll
      >
        <p
          v-for="line in LINES"
          :key="line"
        >
          {{ line }}
        </p>
      </div>
    </GalleryItem>
  </div>
</template>
