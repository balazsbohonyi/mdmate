import { describe, problem } from '@/documents/store'
import { getHost, type Point } from '@/platform'
import { parentPath } from './tree/model'
import { copyDropInto } from './tree/ops'
import { addRootFromDrop } from './tree/store'

/**
 * What a file or folder dragged in from Explorer does, decided by where it lands. The OS reports
 * the drop to Rust, which records the paths itself; this only works out the meaning and asks Rust
 * to act on paths from that record (`describeDrop`, `addDroppedRoot`, `copyDropped`). A path no
 * drop delivered is refused over there, whatever this code asks.
 */

/**
 * The folder a drop on a row of the tree goes into: the row itself for a folder or a root, the
 * folder holding it for a file. Null where there is no row under the point, such as the empty
 * space below the rows or anywhere outside the tree.
 */
function folderUnder(point: Point): string | null {
  const row = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-row-path]')
  const path = row?.dataset.rowPath
  if (row === null || row === undefined || path === undefined) return null
  return row.dataset.kind === 'file' ? parentPath(path) : path
}

/** Handles one drop at `position`, in page pixels. Failures go to the status bar. */
export async function handleDrop(paths: readonly string[], position: Point): Promise<void> {
  try {
    const host = await getHost()
    const items = await host.describeDrop(paths)
    const target = folderUnder(position)
    if (target !== null) {
      // On a row of the tree: copy into that folder, folders whole.
      const copyable = items.filter((item) => item.kind === 'file' || item.kind === 'folder')
      if (copyable.length > 0) {
        await copyDropInto(
          target,
          copyable.map((item) => item.path),
        )
      }
      return
    }
    for (const item of items) {
      // A folder anywhere else, including the empty space of the tree, becomes a workspace root.
      if (item.kind === 'folder') await addRootFromDrop(item.path)
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
