<script setup lang="ts">
import SubGroupHeading from '@/features/settings/SubGroupHeading.vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

/**
 * The states strip: a fixed grid of the looks a control takes, side by side, so a color change in
 * Settings can be judged on all of them at once. Disabled is a real disabled element, error a real
 * aria-invalid, selected a real pressed or checked state. Hover and focus cannot be real (a
 * pointer and a focus ring cannot be held on a dozen things at once), so those cells carry the
 * classes the control itself uses for them. Where a control has no such state the cell is empty.
 * The strip is a picture, so it is inert: nothing in it takes a click or a Tab stop, and a screen
 * reader is not read a dozen controls with the same name.
 */

const STATES = ['hover', 'focus', 'disabled', 'error', 'selected'] as const

/** The focus look the shadcn controls share: a border in the ring color and a soft ring. */
const focus = 'border-ring ring-3 ring-ring/50'

const cell = 'flex min-h-10 items-center'
</script>

<template>
  <SubGroupHeading data-states-title>States</SubGroupHeading>
  <p class="mt-1 text-chrome text-muted-foreground">
    Hover, focus, disabled, error and selected, side by side.
  </p>
  <div class="mt-4 overflow-x-auto">
    <div
      inert
      class="grid min-w-[34rem] grid-cols-[7rem_repeat(5,minmax(0,1fr))] items-center gap-x-3 text-chrome"
      data-states-strip
    >
      <span />
      <span
        v-for="state in STATES"
        :key="state"
        class="pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
        :data-state-heading="state"
        >{{ state }}</span
      >

      <span class="text-muted-foreground">Button</span>
      <div
        :class="cell"
        data-sample="button"
        data-state="hover"
      >
        <Button
          variant="outline"
          size="sm"
          class="bg-accent text-accent-foreground"
          >Button</Button
        >
      </div>
      <div
        :class="cell"
        data-sample="button"
        data-state="focus"
      >
        <Button
          variant="outline"
          size="sm"
          :class="focus"
          >Button</Button
        >
      </div>
      <div
        :class="cell"
        data-sample="button"
        data-state="disabled"
      >
        <Button
          variant="outline"
          size="sm"
          disabled
          >Button</Button
        >
      </div>
      <div
        :class="cell"
        data-sample="button"
        data-state="error"
      >
        <Button
          variant="outline"
          size="sm"
          aria-invalid="true"
          >Button</Button
        >
      </div>
      <div
        :class="cell"
        data-sample="button"
        data-state="selected"
      >
        <Button
          variant="default"
          size="sm"
          :aria-pressed="true"
          >Button</Button
        >
      </div>

      <span class="text-muted-foreground">Text field</span>
      <div
        :class="cell"
        data-sample="field"
        data-state="hover"
      />
      <div
        :class="cell"
        data-sample="field"
        data-state="focus"
      >
        <input
          class="h-8 w-full rounded-lg border bg-transparent px-2.5 outline-none dark:bg-input/30"
          :class="focus"
          value="Tide"
          aria-label="A focused text field"
          readonly
        />
      </div>
      <div
        :class="cell"
        data-sample="field"
        data-state="disabled"
      >
        <input
          class="h-8 w-full rounded-lg border border-input bg-input/50 px-2.5 opacity-50 outline-none dark:bg-input/80"
          value="Tide"
          aria-label="A disabled text field"
          disabled
        />
      </div>
      <div
        :class="cell"
        data-sample="field"
        data-state="error"
      >
        <input
          class="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 outline-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
          value="Tide"
          aria-label="A text field with an error"
          aria-invalid="true"
          readonly
        />
      </div>
      <div
        :class="cell"
        data-sample="field"
        data-state="selected"
      />

      <span class="text-muted-foreground">Switch</span>
      <div
        :class="cell"
        data-sample="switch"
        data-state="hover"
      />
      <div
        :class="cell"
        data-sample="switch"
        data-state="focus"
      >
        <Switch
          :model-value="false"
          :class="focus"
          aria-label="A focused switch"
        />
      </div>
      <div
        :class="cell"
        data-sample="switch"
        data-state="disabled"
      >
        <Switch
          :model-value="false"
          disabled
          aria-label="A disabled switch"
        />
      </div>
      <div
        :class="cell"
        data-sample="switch"
        data-state="error"
      >
        <Switch
          :model-value="false"
          aria-invalid="true"
          aria-label="A switch with an error"
        />
      </div>
      <div
        :class="cell"
        data-sample="switch"
        data-state="selected"
      >
        <Switch
          :model-value="true"
          aria-label="A switch that is on"
        />
      </div>

      <span class="text-muted-foreground">Tree row</span>
      <div
        :class="cell"
        data-sample="row"
        data-state="hover"
      >
        <span
          class="w-full truncate rounded-sm bg-sidebar-accent/50 px-2 py-0.5 text-sidebar-foreground"
          >roadmap.md</span
        >
      </div>
      <div
        :class="cell"
        data-sample="row"
        data-state="focus"
      />
      <div
        :class="cell"
        data-sample="row"
        data-state="disabled"
      />
      <div
        :class="cell"
        data-sample="row"
        data-state="error"
      />
      <div
        :class="cell"
        data-sample="row"
        data-state="selected"
      >
        <span
          class="w-full truncate rounded-sm bg-sidebar-accent px-2 py-0.5 text-sidebar-accent-foreground"
          aria-selected="true"
          >README.md</span
        >
      </div>

      <span class="text-muted-foreground">Name field</span>
      <div
        :class="cell"
        data-sample="name"
        data-state="hover"
      />
      <div
        :class="cell"
        data-sample="name"
        data-state="focus"
      >
        <input
          class="w-full truncate rounded border border-ring bg-background px-1 py-0.5 text-foreground outline-none"
          value="ideas.md"
          aria-label="A name being edited"
          readonly
        />
      </div>
      <div
        :class="cell"
        data-sample="name"
        data-state="disabled"
      />
      <div
        :class="cell"
        data-sample="name"
        data-state="error"
      >
        <input
          class="w-full truncate rounded border border-destructive bg-background px-1 py-0.5 text-foreground outline-none"
          value="ideas?.md"
          aria-label="A name that is not allowed"
          aria-invalid="true"
          readonly
        />
      </div>
      <div
        :class="cell"
        data-sample="name"
        data-state="selected"
      />

      <span class="text-muted-foreground">Menu row</span>
      <div
        :class="cell"
        data-sample="menu"
        data-state="hover"
      >
        <span class="w-full truncate rounded-md bg-accent px-1.5 py-1 text-accent-foreground"
          >Copy</span
        >
      </div>
      <div
        :class="cell"
        data-sample="menu"
        data-state="focus"
      >
        <span class="w-full truncate rounded-md bg-accent px-1.5 py-1 text-accent-foreground"
          >Copy</span
        >
      </div>
      <div
        :class="cell"
        data-sample="menu"
        data-state="disabled"
      >
        <span
          class="w-full truncate rounded-md px-1.5 py-1 opacity-50"
          aria-disabled="true"
          >Paste</span
        >
      </div>
      <div
        :class="cell"
        data-sample="menu"
        data-state="error"
      >
        <span class="w-full truncate rounded-md bg-destructive/10 px-1.5 py-1 text-destructive"
          >Delete</span
        >
      </div>
      <div
        :class="cell"
        data-sample="menu"
        data-state="selected"
      />
    </div>
  </div>
</template>
