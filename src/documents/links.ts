import { shallowRef } from 'vue'
import { findAnchor } from '@/editor/headingSlug'
import { getHost } from '@/platform'
import type { TabId } from '@/workbench/splitTree'
import { locationOf, recordJump } from './history'
import {
  describe,
  documentOfTab,
  errorKind,
  followerOfTab,
  openPath,
  problem,
  setLinkFollower,
} from './store'

/**
 * Following links. What a target may do is decided by the link guard in Rust; this module only
 * acts on its answer: a heading jump, a Markdown file in a tab, or a question before a file opens
 * in its default app.
 */

/** A file waiting for the user's yes before it opens in its default app. */
export interface PendingLink {
  readonly tabId: TabId
  readonly docId: number
  readonly href: string
  /** The file as Rust resolved it, for the question. */
  readonly path: string
}

/** The open question, shown as a banner in the pane of `tabId`. One at a time. */
export const pendingLink = shallowRef<PendingLink | null>(null)

/** Moves a tab's caret to the heading a fragment names. False when there is no such heading. */
export function jumpToFragment(tabId: TabId, fragment: string): boolean {
  const follower = followerOfTab(tabId)
  if (follower === undefined) return false
  const pos = findAnchor(follower.state.doc, fragment)
  if (pos === null) {
    problem.value = `No heading #${fragment} in ${documentOfTab(tabId)?.name ?? 'this file'}`
    return false
  }
  follower.reveal(pos)
  return true
}

/**
 * Follows `href`, written in the document of `tabId`. `confirmed` is the user's yes for a file
 * that opens in its default app; without it, such a file raises `pendingLink` instead.
 */
export async function followLinkFrom(tabId: TabId, href: string, confirmed = false): Promise<void> {
  const doc = documentOfTab(tabId)
  if (doc === undefined) return
  problem.value = null
  const host = await getHost()
  let followed
  try {
    followed = await host.followLink(doc.id, href, confirmed)
  } catch (error) {
    switch (errorKind(error)) {
      case 'needs-confirmation': {
        const info = await host.describeLink(doc.id, href).catch(() => null)
        const path = info !== null && 'path' in info ? info.path : href
        pendingLink.value = { tabId, docId: doc.id, href, path }
        return
      }
      case 'link-refused':
        problem.value = `This link cannot be followed: ${href}`
        return
      case 'not-found':
        problem.value = `Link target not found: ${href}`
        return
      case undefined:
      default:
        problem.value = `Could not follow the link: ${describe(error)}`
        return
    }
  }
  // Where the caret was before the jump, for Alt+Left.
  const from = locationOf(tabId)
  const jumped = (to: TabId): void => {
    const there = locationOf(to)
    if (from !== null && there !== null) recordJump(from, there)
  }
  switch (followed.kind) {
    case 'anchor':
      if (jumpToFragment(tabId, followed.fragment)) jumped(tabId)
      return
    case 'opened':
      return
    case 'document': {
      const opened = await openPath(followed.path).catch((error: unknown) => {
        problem.value = `Could not open ${followed.path}: ${describe(error)}`
        return null
      })
      if (opened === null) return
      if (followed.fragment !== null && followed.fragment !== '')
        jumpToFragment(opened, followed.fragment)
      jumped(opened)
      return
    }
    default: {
      const unreachable: never = followed
      return unreachable
    }
  }
}

/** Answers the open question: open the file in its default app, or leave it. */
export async function resolvePendingLink(choice: 'open' | 'cancel'): Promise<void> {
  const pending = pendingLink.value
  pendingLink.value = null
  if (pending === null || choice === 'cancel') return
  await followLinkFrom(pending.tabId, pending.href, true)
}

setLinkFollower((tabId, href) => {
  followLinkFrom(tabId, href).catch((error: unknown) => {
    problem.value = `Could not follow the link: ${describe(error)}`
  })
})
