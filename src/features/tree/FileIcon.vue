<script setup lang="ts">
/** The icon of a file row, by file type (ISC-576): a symbol of the local sprite, so nothing loads from the network. */
import { computed } from 'vue'
import { fileIconFor } from './fileIcons'

const props = defineProps<{ name: string }>()

const id = computed(() => fileIconFor(props.name))
const href = computed(() => `${import.meta.env.BASE_URL}file-icons.svg#${id.value}`)
</script>

<template>
  <svg
    class="size-4 shrink-0"
    :data-file-icon="id"
    aria-hidden="true"
  >
    <use :href="href" />
  </svg>
</template>
