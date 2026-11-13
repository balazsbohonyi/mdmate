import { computed, shallowRef } from 'vue'
import { getHost } from '@/platform'
import { IDLE_INDEX, type IndexStatus } from '@/platform/indexStatus'

/**
 * How the workspace index is doing, for the status bar. Rust owns the index and says when it starts
 * and finishes reading a folder, how far along it is, and which folder hit the file limit; this
 * keeps the latest word.
 */

/** The most recent status Rust sent. */
export const indexStatus = shallowRef<IndexStatus>(IDLE_INDEX)

/** The limit the status bar names; Rust holds the real one and sends only the names. */
const LIMIT_TEXT = '1,000,000'

/** The note for folders the index could not hold whole, or an empty text when there are none. */
export const indexCutNote = computed(() => {
  const names = indexStatus.value.cut
  if (names.length === 0) return ''
  return `Only the first ${LIMIT_TEXT} files of ${names.join(', ')} are indexed; search there is slower`
})

let stopListening: (() => void) | undefined
let started = false

/** Starts listening to Rust. Once; a second call changes nothing. */
export async function watchIndexStatus(): Promise<void> {
  if (started) return
  started = true
  try {
    const host = await getHost()
    stopListening = await host.watchIndex((status) => {
      indexStatus.value = status
    })
  } catch (error) {
    started = false
    throw error
  }
}

/** Forgets the status and stops listening, for tests. */
export function resetIndexStatus(): void {
  stopListening?.()
  stopListening = undefined
  started = false
  indexStatus.value = IDLE_INDEX
}
