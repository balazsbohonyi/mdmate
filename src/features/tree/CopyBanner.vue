<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { baseName } from './model'
import { answerClash, cancelCopy, copyPrompt, currentClash } from './ops'

const applyToAll = ref(false)
const box = ref<HTMLElement | null>(null)

const name = computed(() => {
  const prompt = copyPrompt.value
  return prompt === null ? undefined : currentClash(prompt)
})
const folder = computed(() => {
  const prompt = copyPrompt.value
  return prompt === null ? '' : baseName(prompt.into)
})
/** How many names, this one included, still wait for an answer. */
const remaining = computed(() => {
  const prompt = copyPrompt.value
  return prompt === null ? 0 : prompt.clashes.length - prompt.answers.length
})

// A new question starts with "apply to all" off, and takes the keyboard so Escape and Enter work.
watch(
  () => copyPrompt.value?.answers.length,
  () => {
    applyToAll.value = false
  },
)
watch(
  () => copyPrompt.value === null,
  async (gone) => {
    if (gone) return
    await nextTick()
    box.value?.querySelector('button')?.focus()
  },
  { flush: 'post' },
)
</script>

<template>
  <div
    v-if="copyPrompt !== null"
    ref="box"
    role="alertdialog"
    aria-label="Name already exists"
    data-copy-banner
    class="flex shrink-0 flex-col gap-2 border-b border-sidebar-border bg-sidebar-accent/40 p-3 text-chrome"
    @keydown.esc.stop="cancelCopy()"
  >
    <p class="break-words">
      <span class="font-medium">{{ name }}</span>
      already exists in
      <span class="font-medium">{{ folder }}</span
      >.
    </p>
    <div class="flex flex-wrap gap-1.5">
      <button
        type="button"
        class="rounded border border-sidebar-border bg-sidebar px-2 py-1 hover:bg-sidebar-accent"
        data-answer="replace"
        @click="answerClash('replace', applyToAll)"
      >
        Replace
      </button>
      <button
        type="button"
        class="rounded border border-sidebar-border bg-sidebar px-2 py-1 hover:bg-sidebar-accent"
        data-answer="keep-both"
        @click="answerClash('keep-both', applyToAll)"
      >
        Keep both
      </button>
      <button
        type="button"
        class="rounded border border-sidebar-border bg-sidebar px-2 py-1 hover:bg-sidebar-accent"
        data-answer="skip"
        @click="answerClash('skip', applyToAll)"
      >
        Skip
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-muted-foreground hover:bg-sidebar-accent"
        data-answer="cancel"
        @click="cancelCopy()"
      >
        Cancel
      </button>
    </div>
    <label
      v-if="remaining > 1"
      class="flex items-center gap-1.5 text-muted-foreground"
    >
      <input
        v-model="applyToAll"
        type="checkbox"
        data-apply-all
      />
      Apply to all {{ remaining }} names
    </label>
    <p class="text-muted-foreground">Replace sends the old one to the Recycle Bin first.</p>
  </div>
</template>
