# Vue standard

Read this before writing or reviewing `.vue` files, composables or reactive state. Sources verified 2026-11-07; "project call" marks our own conventions.

Sources: [Performance](https://vuejs.org/guide/best-practices/performance.html), [Style Guide A](https://vuejs.org/style-guide/rules-essential), [Style Guide B](https://vuejs.org/style-guide/rules-strongly-recommended), [Composables](https://vuejs.org/guide/reusability/composables.html), [TS with Composition API](https://vuejs.org/guide/typescript/composition-api.html), [Security](https://vuejs.org/guide/best-practices/security.html), [Advanced reactivity](https://vuejs.org/api/reactivity-advanced.html), [v-model](https://vuejs.org/guide/components/v-model.html), [eslint-plugin-vue](https://eslint.vuejs.org/user-guide/)

## Enforced by tools

ESLint runs `eslint-plugin-vue` `flat/recommended-error`, covering Priority A and B rules such as multi-word names, keyed `v-for`, one attribute per line and self-closing tags.

`components/ui/` is exempt from `multi-word-component-names`, because shadcn-vue generates single-word names.

## Shape

- `<script setup lang="ts">`, then `<template>`.
- Styling uses Tailwind token classes. `<style>` blocks are for what utilities can't express.
- Filenames are PascalCase, and use full words.
- Tightly coupled children carry the parent's prefix: `TabBar`, `TabBarItem`.
- Templates hold simple expressions. Logic moves to small, well-named computeds.
- Filter lists in a computed, so `v-if` and `v-for` stay on separate elements.

## Typed component API

```ts
const { title, pinned = false } = defineProps<{ title: string; pinned?: boolean }>()
const emit = defineEmits<{ close: [id: DocId] }>()
const value = defineModel<string>({ required: true })
const input = useTemplateRef('input')
```

- Make `defineModel` required. Its defaults can desync parent and child.
- Share injected values through a typed `InjectionKey`.
- Parents own props; children emit changes.

## Composables

- Name them `useX`, and call them synchronously from setup.
- Accept refs or getters, and normalize with `toValue()`.
- Return a plain object of refs, so destructuring keeps reactivity.
- Remove every listener in `onUnmounted`.

## Reactivity and speed

- CodeMirror objects stay outside reactivity: wrap holders in `markRaw`, and use one reference style for each object.
- Large immutable data uses `shallowRef`. Update it by replacing `.value`.
- Keep shallow structures at root level, outside deep reactive objects.
- Keep props stable: pass `:active="tab.id === activeId"` so only affected rows update.
- Computeds returning objects hand back the old value when nothing changed, after running the full computation.
- Virtualize the file tree and search results, and keep row components thin.
- Lazy-load palette, settings and search with `defineAsyncComponent`.
- Prove any speed fix with `app.config.performance` and the DevTools Performance panel.

## Tooltips (project call)

- A tooltip is the shadcn `Tooltip` from `components/ui/tooltip`, never the native `title` attribute. The owner ruled this on 2026-11-10.
- Its content uses theme tokens (`bg-popover`, `text-popover-foreground`), so it follows dark and light with the menus. No hard-coded colors.
- One `TooltipProvider` lives in `App.vue`. A component test that mounts a tooltip wraps it in a provider.
- A disabled control takes no pointer events: put the trigger (`as-child`) on a wrapper element around it.

## Security

- Render document text with interpolation. `v-html` stays unused.
- Send every document-derived URL through the link guard in `platform/`.
- Templates come only from the source tree, because a template built from a string can run code.

## State (project call)

Module-level reactive stores in `documents/` and `workbench/`, exposed as functions. No Pinia.
