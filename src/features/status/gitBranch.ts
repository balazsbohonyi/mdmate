import { shallowRef, watch } from 'vue'
import { documentOfTab, watchDocuments } from '@/documents/store'
import type { Document } from '@/documents/document'
import { settledRuntime } from '@/features/settings/store'
import { gitPending, knownBranches, onGitRefreshed } from '@/features/tree/gitStore'
import { isUnder } from '@/features/tree/store'
import { settings } from '@/lib/settings'
import { getHost } from '@/platform'
import { findPane } from '@/workbench/splitTree'
import { workbenchLayout } from '@/workbench/store'

/** The branch of the repository that holds the file in the focused tab; null for nothing to show. */
export const gitBranch = shallowRef<string | null>(null)

function focusedFile(): Document | undefined {
  const layout = workbenchLayout.value
  const tab = findPane(layout, layout.activePane)?.activeTab ?? null
  const doc = tab === null ? undefined : documentOfTab(tab)
  return doc === undefined || doc.untitled ? undefined : doc
}

/**
 * Starts reporting. It asks when another file gets the focus, and whenever git is asked about the
 * folders again (see `gitStore`), which covers the window getting the focus back. Returns the
 * function that stops it.
 */
export function watchGitBranch(): () => void {
  let question = 0
  /** The repository whose branch is on show. */
  let shown: string | undefined
  let asked = ''

  const show = (repo?: string, branch: string | null = null): void => {
    shown = branch === null ? undefined : repo
    gitBranch.value = branch
  }

  async function ask(): Promise<void> {
    const mine = ++question
    const doc = focusedFile()
    if (doc === undefined || !settings.git.enabled) {
      show()
      return
    }
    // The branch on show stays up while a file of the same repository is asked about.
    if (shown !== undefined && !isUnder(doc.path, shown)) show()
    // The status of its folder will name the branch, so wait rather than start git a second time.
    if (gitPending(doc.path)) return
    try {
      await settledRuntime()
      const host = await getHost()
      const known = knownBranches()
      const found = await host.gitBranch(doc.id, [...known.keys()])
      if (mine !== question) return
      if (found === null) show()
      else show(found.repo, found.branch ?? known.get(found.repo) ?? null)
    } catch {
      // The document closed meanwhile, or git has nothing to say: no branch, and no note.
      if (mine === question) show()
    }
  }

  /** Asks again only when the focused tab holds another file; this runs on every key. */
  function check(): void {
    const doc = focusedFile()
    const file = doc === undefined ? '' : `${String(doc.id)} ${doc.path}`
    if (file === asked) return
    asked = file
    void ask()
  }

  const stops = [
    watchDocuments(check),
    watch(workbenchLayout, check),
    onGitRefreshed(() => void ask()),
  ]
  check()

  return () => {
    for (const stop of stops) stop()
    question += 1
    show()
  }
}
