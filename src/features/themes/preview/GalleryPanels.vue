<script setup lang="ts">
import {
  CaseSensitive,
  ChevronDown,
  OctagonX,
  Regex,
  TriangleAlert,
  WholeWord,
  X,
} from '@lucide/vue'
import { ref } from 'vue'
import HoverHint from '@/components/HoverHint.vue'
import { Button } from '@/components/ui/button'
import { toggleVariant } from '@/lib/toggle'
import GalleryItem from './GalleryItem.vue'

/**
 * The floating surfaces of the app drawn in place: a tooltip, a dialog, a context menu, toasts, the
 * find bar and the command palette. The real ones live in a portal or a store and open on an action,
 * so here each is markup with the same classes as the component it stands for. The pictures are
 * `inert` (nothing in them takes a click, a focus or a hover); the tooltip item also has a button with
 * the real tooltip on it, and the find bar's boxes take text, so the parts a person tries by hand
 * are live. A change of a surface class in the app is a change to make here too: the classes below
 * are copied from components/ui/{tooltip,alert-dialog,context-menu} and from FindBar, PaletteHost.
 */

const find = ref('tide')
const replace = ref('')

const box =
  'h-7 min-w-0 w-full rounded-sm border border-input bg-background px-2 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring aria-invalid:border-destructive'
</script>

<template>
  <GalleryItem
    id="tooltip"
    label="Tooltip"
  >
    <div class="flex flex-wrap items-center gap-3">
      <span
        inert
        class="inline-flex w-fit max-w-xs items-center gap-1.5 rounded-md bg-tooltip px-3 py-1.5 text-xs text-tooltip-foreground shadow-md ring-1 ring-foreground/10"
        data-gallery-picture
        >Next match (F3)</span
      >
      <HoverHint text="This one is the real tooltip">
        <Button
          type="button"
          variant="outline"
          size="sm"
          >Hover me</Button
        >
      </HoverHint>
    </div>
  </GalleryItem>

  <GalleryItem
    id="dialog"
    label="Dialog"
  >
    <div
      inert
      class="grid max-w-sm gap-4 overflow-hidden rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10"
      data-gallery-picture
    >
      <div class="grid gap-1.5">
        <p class="text-base font-medium">Delete Sepia copy?</p>
        <p class="text-sm text-muted-foreground">
          The theme file goes to the Recycle Bin. If it is in use, Dark takes its place.
        </p>
      </div>
      <div class="-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4">
        <Button variant="outline">Cancel</Button>
        <Button variant="destructive">Delete</Button>
      </div>
    </div>
  </GalleryItem>

  <GalleryItem
    id="context-menu"
    label="Context menu"
  >
    <div
      inert
      class="w-52 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      data-gallery-picture
    >
      <div class="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm">Cut</div>
      <div
        class="flex items-center gap-1.5 rounded-md bg-accent px-1.5 py-1 text-sm text-accent-foreground"
      >
        Copy
        <span class="ml-auto text-xs tracking-widest text-accent-foreground">Ctrl+C</span>
      </div>
      <div class="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm opacity-50">
        Paste
        <span class="ml-auto text-xs tracking-widest text-muted-foreground">Ctrl+V</span>
      </div>
      <div class="-mx-1 my-1 h-px bg-border" />
      <div class="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-destructive">
        Delete
      </div>
    </div>
  </GalleryItem>

  <GalleryItem
    id="toasts"
    label="Toasts"
  >
    <div
      inert
      class="grid max-w-sm gap-2"
      data-gallery-picture
    >
      <!-- Sonner draws these; the icon colors are the ones styles/toasts.css gives them. -->
      <div
        class="relative flex items-start gap-2 rounded-2xl border border-border bg-popover py-3 pr-10 pl-3 text-chrome text-popover-foreground shadow-lg"
      >
        <OctagonX class="mt-0.5 size-4 shrink-0 text-destructive" />
        <span>Could not open notes.md: the file is gone.</span>
        <X class="absolute top-2 right-2 size-4 text-muted-foreground" />
      </div>
      <div
        class="relative flex items-start gap-2 rounded-2xl border border-border bg-popover py-3 pr-10 pl-3 text-chrome text-popover-foreground shadow-lg"
      >
        <TriangleAlert class="mt-0.5 size-4 shrink-0 text-syntax-heading" />
        <span>Link target not found.</span>
        <X class="absolute top-2 right-2 size-4 text-muted-foreground" />
      </div>
    </div>
  </GalleryItem>

  <GalleryItem
    id="find-bar"
    label="Find bar"
  >
    <div
      class="grid grid-cols-[auto_auto_minmax(0,1fr)_auto_auto_auto] items-center gap-x-1 gap-y-1 rounded-md border border-border bg-muted px-2 py-1.5 text-chrome"
      data-gallery-find-bar
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Toggle replace"
        aria-expanded="true"
      >
        <ChevronDown />
      </Button>
      <div class="flex items-center gap-0.5">
        <Button
          type="button"
          :variant="toggleVariant(false)"
          size="icon-sm"
          aria-label="Regular expression"
          :aria-pressed="false"
        >
          <Regex class="size-5" />
        </Button>
        <Button
          type="button"
          :variant="toggleVariant(true)"
          size="icon-sm"
          aria-label="Match case"
          :aria-pressed="true"
        >
          <CaseSensitive class="size-5" />
        </Button>
        <Button
          type="button"
          :variant="toggleVariant(false)"
          size="icon-sm"
          aria-label="Whole word"
          :aria-pressed="false"
        >
          <WholeWord class="size-5" />
        </Button>
      </div>
      <input
        v-model="find"
        type="text"
        aria-label="Find"
        placeholder="Find"
        spellcheck="false"
        autocomplete="off"
        :class="box"
      />
      <Button
        type="button"
        variant="outline"
        size="xs"
        class="h-7 w-full"
        >Find</Button
      >
      <Button
        type="button"
        variant="outline"
        size="xs"
        class="h-7 w-full"
        >Find Prev</Button
      >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Close find"
      >
        <X />
      </Button>
      <input
        v-model="replace"
        type="text"
        aria-label="Replace with"
        placeholder="Replace"
        spellcheck="false"
        autocomplete="off"
        class="col-start-3"
        :class="box"
      />
      <Button
        type="button"
        variant="outline"
        size="xs"
        class="h-7 w-full"
        >Replace</Button
      >
      <Button
        type="button"
        variant="outline"
        size="xs"
        class="h-7 w-full"
        >Replace all</Button
      >
    </div>
  </GalleryItem>

  <GalleryItem
    id="palette"
    label="Command palette"
  >
    <div
      inert
      class="flex w-full max-w-xl flex-col overflow-hidden rounded-md border border-border bg-popover text-chrome text-popover-foreground shadow-lg"
      data-gallery-picture
    >
      <span class="border-b border-border px-3 py-2">sw</span>
      <ul class="py-1">
        <li class="flex items-baseline gap-3 bg-accent px-3 py-1 text-accent-foreground">
          <span class="shrink-0"><b class="font-semibold text-primary">Sw</b>itch theme</span>
          <span class="min-w-0 flex-1 truncate text-right text-muted-foreground">Appearance</span>
        </li>
        <li class="flex items-baseline gap-3 px-3 py-1">
          <span class="shrink-0"><b class="font-semibold text-primary">S</b>plit right</span>
          <span class="min-w-0 flex-1 truncate text-right text-muted-foreground">Alt+Shift+2</span>
        </li>
        <li class="flex items-baseline gap-3 px-3 py-1 text-muted-foreground">
          <span class="shrink-0">Toggle wrap</span>
          <span class="min-w-0 flex-1 truncate text-right">Editor</span>
          <span class="shrink-0 text-xs font-medium text-foreground">On</span>
        </li>
      </ul>
    </div>
  </GalleryItem>
</template>
