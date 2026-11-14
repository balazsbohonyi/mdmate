import { rootOf } from '@/features/tree/store'
import { findPane, type PaneId } from '@/workbench/splitTree'
import { openTabFor, workbenchLayout } from '@/workbench/store'
import { createUntitled, describe, documentOfTab, lastFileFolder, setSaveHint } from './store'
import { suggestedFileName } from './suggest'
import { reportError } from '@/shell/toasts'

/**
 * New files that have no file yet. They are numbered through the session (`Untitled-1`,
 * `Untitled-2`), never reused: closing `Untitled-1` does not make the next one `Untitled-1` again,
 * so a name on screen always means the same buffer.
 */
let counter = 0

/** Makes sure the next number is past `number`, for tabs a restored session brings back. */
export function noteUntitledNumber(number: number): void {
  counter = Math.max(counter, number)
}

/** Forgets the numbering. Tests use it. */
export function resetUntitled(): void {
  counter = 0
}

/**
 * Opens a new empty Markdown tab in `paneId`, or in the focused pane when none is named. Failures
 * show as a toast.
 */
export async function newUntitledTab(paneId?: PaneId): Promise<void> {
  try {
    const doc = await createUntitled(++counter)
    openTabFor({ kind: 'markdown', docId: doc.id }, paneId)
  } catch (error) {
    reportError(`Could not make a new file: ${describe(error)}`)
  }
}

/**
 * The folder the save dialog starts in: the workspace folder of the focused pane's files (the
 * active tab's first, then the others), else the folder of the last file opened or saved, else the
 * system's choice.
 */
function startFolder(): string | null {
  const layout = workbenchLayout.value
  const pane = findPane(layout, layout.activePane)
  const tabs = pane === undefined ? [] : [pane.activeTab, ...pane.tabs]
  for (const tab of tabs) {
    if (tab === null) continue
    const path = documentOfTab(tab)?.path ?? ''
    const root = path === '' ? undefined : rootOf(path)
    if (root !== undefined) return root
  }
  return lastFileFolder()
}

setSaveHint((doc) => ({
  name: suggestedFileName(doc.master.doc.toString()),
  folder: startFolder(),
}))
