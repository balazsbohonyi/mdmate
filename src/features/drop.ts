import { describe, problem } from '@/documents/store'
import { getHost, type Point } from '@/platform'
import { addRootFromDrop } from './tree/store'

/**
 * What a file or folder dragged in from Explorer does, decided by where it lands. The OS reports
 * the drop to Rust, which records the paths itself; this only works out the meaning and asks Rust
 * to act on paths from that record (`describeDrop`, `addDroppedRoot`). A path no drop delivered is
 * refused over there, whatever this code asks.
 */

/** True when the point is over the sidebar tree. */
function overTree(point: Point): boolean {
  return document.elementFromPoint(point.x, point.y)?.closest('[data-file-tree]') != null
}

/** Handles one drop at `position`, in page pixels. Failures go to the status bar. */
export async function handleDrop(paths: readonly string[], position: Point): Promise<void> {
  try {
    const host = await getHost()
    const items = await host.describeDrop(paths)
    const onTree = overTree(position)
    for (const item of items) {
      // A folder outside the tree becomes a workspace root. On the tree it means something else
      // (a copy into the folder under it), which a later task adds.
      if (item.kind === 'folder' && !onTree) await addRootFromDrop(item.path)
    }
  } catch (error) {
    problem.value = `Could not use the dropped files: ${describe(error)}`
  }
}

/** Starts listening for drops on the window. Returns the function that stops. */
export async function installFileDrop(): Promise<() => void> {
  const host = await getHost()
  return host.onFileDrag((event) => {
    if (event.type !== 'drop' || event.paths === undefined || event.position === undefined) return
    void handleDrop(event.paths, event.position)
  })
}
