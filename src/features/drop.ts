import { describe, openPath, problem } from '@/documents/store'
import { dropPosition, insertDropped } from '@/editor/imagePaste'
import { getHost, type Point } from '@/platform'
import { EditorView } from '@codemirror/view'
import type { PaneId } from '@/workbench/splitTree'
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

/** The pane a point is over, or undefined outside every pane (the sidebar, the title bar). */
function paneUnder(point: Point): PaneId | undefined {
  const pane = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-pane-id]')
  return pane?.dataset.paneId
}

/** The editor whose text a point is over, or null anywhere else (a tab strip, the tree, a margin). */
function editorUnder(point: Point): EditorView | null {
  const content = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('.cm-content')
  return content === null || content === undefined ? null : EditorView.findFromDOM(content)
}

/**
 * Opens the files of a drop in tabs, in the pane they landed on (the active pane when they landed
 * outside every pane). Rust grants each file only if a native drop delivered it. An image dropped
 * on a document's text opens nothing: it becomes a link at the drop point (Rust links it where it
 * lies inside the workspace folder, and copies it into `assets` otherwise).
 */
async function openDropped(
  items: readonly { path: string; fileKind?: string }[],
  position: Point,
): Promise<void> {
  const pane = paneUnder(position)
  const view = editorUnder(position)
  const at = view === null ? null : dropPosition(view, position)
  const images = items.filter((item) => item.fileKind === 'image').map((item) => item.path)
  // A view that takes no images (a read-only or unsaved-in-a-folder kind it knows nothing of) falls
  // back to opening the picture in a tab, as before.
  const linked =
    view !== null && at !== null && images.length > 0 && (await insertDropped(view, images, at))
  for (const item of items) {
    if (item.fileKind === 'image' && linked) continue
    try {
      await openPath(item.path, pane)
    } catch (error) {
      problem.value = `Could not open ${item.path}: ${describe(error)}`
    }
  }
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
    // Files anywhere else open in tabs. Rust grants them here, and refuses the lot unless a native
    // drop delivered every path.
    if (items.some((item) => item.kind === 'file')) {
      const opened = await host.openDropped(
        items.filter((item) => item.kind === 'file').map((item) => item.path),
      )
      await openDropped(
        opened.filter((item) => item.kind === 'file'),
        position,
      )
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
