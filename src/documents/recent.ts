import { shallowRef } from 'vue'
import { openRecentFolder as addRecentFolder } from '@/features/tree/store'
import { getHost, type RecentLists } from '@/platform'
import { describe, openPath, problem } from './store'

/**
 * Open Recent. Rust keeps the lists (the last 10 files and 5 folders, newest first) and is the only
 * thing that adds to them; the page asks for them when the menu opens and asks Rust to open an
 * entry, which Rust only does for a path that is on its list.
 */
export const recentLists = shallowRef<RecentLists>({ files: [], folders: [] })

/** Reads the lists again. Rust drops entries that no longer exist before it answers. */
export async function refreshRecent(): Promise<void> {
  try {
    recentLists.value = await (await getHost()).recentList()
  } catch (error) {
    problem.value = `Could not read the recent files: ${describe(error)}`
  }
}

/** Opens a file from the list in a tab. */
export async function openRecentFile(path: string): Promise<void> {
  problem.value = null
  try {
    const granted = await (await getHost()).recentOpenFile(path)
    await openPath(granted)
  } catch (error) {
    problem.value = `Could not open ${path}: ${describe(error)}`
  }
  await refreshRecent()
}

/** Makes a folder from the list a workspace folder again. */
export async function openRecentFolder(path: string): Promise<void> {
  problem.value = null
  try {
    await addRecentFolder(path)
  } catch (error) {
    problem.value = `Could not open ${path}: ${describe(error)}`
  }
  await refreshRecent()
}

/** Empties both lists. */
export async function clearRecent(): Promise<void> {
  try {
    await (await getHost()).recentClear()
    recentLists.value = { files: [], folders: [] }
  } catch (error) {
    problem.value = `Could not clear the recent files: ${describe(error)}`
  }
}
