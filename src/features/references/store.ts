import { shallowRef } from 'vue'
import { describe, followerOfTab, openPath } from '@/documents/store'
import { dirtyBuffers } from '@/features/links/rewrite'
import { getHost, type Reference, type ReferencesFound } from '@/platform'
import { showSidebar } from '@/workbench/sidebar'
import { reportError } from '@/shell/toasts'

/**
 * Find File References: the links that lead to one file, listed in the sidebar. The search is
 * Rust's (it reads the files the rename reads and resolves links the way the rename does); this
 * keeps the answer for the panel and opens a reference at its link.
 */

/** What the panel shows, or null when no search has been made. */
export type ReferencesState =
  | { readonly phase: 'searching'; readonly target: string }
  | { readonly phase: 'done'; readonly target: string; readonly found: ReferencesFound }
  | { readonly phase: 'failed'; readonly target: string; readonly message: string }

export const referencesState = shallowRef<ReferencesState | null>(null)

/** Numbers the searches, so a slow one that was replaced cannot overwrite the newer answer. */
let latest = 0

/**
 * Lists every link to `path`, and shows the panel. Open documents with unsaved edits are read as
 * the editor holds them, so the lines match what is on screen.
 */
export async function findFileReferences(path: string): Promise<void> {
  const mine = ++latest
  referencesState.value = { phase: 'searching', target: path }
  showSidebar('references')
  try {
    const host = await getHost()
    const found = await host.findReferences(path, dirtyBuffers())
    if (mine === latest) referencesState.value = { phase: 'done', target: path, found }
  } catch (error) {
    if (mine === latest) {
      referencesState.value = { phase: 'failed', target: path, message: describe(error) }
    }
  }
}

/** Forgets the list and goes back to the folders. */
export function closeReferences(): void {
  latest += 1
  referencesState.value = null
  showSidebar('folders')
}

/** Opens the file a reference is in and puts the caret on its link. */
export async function openReference(reference: Reference): Promise<void> {
  try {
    const tab = await openPath(reference.path)
    const follower = followerOfTab(tab)
    if (follower === undefined) return
    const doc = follower.state.doc
    const line = doc.line(Math.min(Math.max(reference.line, 1), doc.lines))
    follower.reveal(line.from + Math.min(reference.column, line.length))
  } catch (error) {
    reportError(`Could not open ${reference.path}: ${describe(error)}`)
  }
}

/** Puts the module back as it starts. For tests. */
export function resetReferences(): void {
  latest += 1
  referencesState.value = null
}
