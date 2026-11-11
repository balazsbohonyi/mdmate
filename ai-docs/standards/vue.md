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
- Use `components/HoverHint.vue` (`<HoverHint :text="...">` around one element) for a hint on any element; it holds the shadcn parts, so a template stays short. An empty or null text turns it off, and newlines in the text become lines.
- One `TooltipProvider` lives in `App.vue`. A component test that draws a hint mounts through `tests/helpers/tooltips.ts` (`tooltipApp`), which adds the provider and the `ResizeObserver` stub jsdom lacks.
- `tests/shell/noNativeTitle.test.ts` fails the build on a native `title` in any template outside `components/ui/`. Markdown image titles drawn inside a document are document content and are not covered.
- `HoverHint` takes `delayDuration` (ms; the provider's 300 ms when left out) and `whenTruncated` (shows only while the slot element is cut off with an ellipsis, measured as the pointer arrives). Tabs and tree rows use `SLOW_HINT_DELAY` (1 s, `components/hintDelay.ts`); the provider's skip delay is 0 so hopping between hints waits too. A tab's hint sits on its label, never on the tab itself, which belongs to the context menu trigger.
- Inside the editor (CodeMirror, outside Vue) a hint is a `data-hint="..."` attribute on a decoration or widget element; `editor/hoverHints.ts` draws it in the same colors. The scan also covers `.ts` files.
- A question that needs an answer before something is lost uses the shadcn `AlertDialog` from `components/ui/alert-dialog` (the delete confirmation is the first). Every other question stays an inline banner. The generated overlay is `bg-background/60`, not `bg-black/10`, because the color rule refuses a palette color; `pnpm ui:add alert-dialog --overwrite` would put it back.
- A menu trigger never sits inside a tooltip trigger. A tooltip and a menu each anchor to the nearest popper root, so a `DropdownMenuTrigger` inside a `HoverHint` leaves its menu with no anchor and it stays at the top-left corner of the window. Put the `HoverHint` around the whole menu (`<HoverHint><span><DropdownMenu>...</DropdownMenu></span></HoverHint>`), as `TabStrip.vue` does. jsdom does not show this; check a menu with a hint in the real window.
- A disabled control takes no pointer events: put the trigger (`as-child`) on a wrapper element around it.

## Scrollbars (project call)

- One global style in `styles/tokens.css` makes every scrollbar thin and rounded, from the `--scrollbar-thumb` tokens. Do not use a `ScrollArea` component (it would replace the editor's and the tree's scrolling elements) and never set `scrollbar-width` or `scrollbar-color` on an element, which makes Chromium ignore the global rule there. To hide a bar use `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`, as the tab strip does. `tests/styles/scrollbar.test.ts` checks it.

## Security

- Render document text with interpolation. `v-html` stays unused.
- Send every document-derived URL through the link guard in `platform/`.
- Templates come only from the source tree, because a template built from a string can run code.

## State (project call)

Module-level reactive stores in `documents/` and `workbench/`, exposed as functions. No Pinia.
