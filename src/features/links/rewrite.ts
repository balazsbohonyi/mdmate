import { shallowRef } from 'vue'
import { settings } from '@/lib/settings'
import { allDocuments, documentById, refreshFromDisk } from '@/documents/store'
import { getHost, type Moved } from '@/platform'
import type {
  RewriteBuffer,
  RewriteChange,
  RewritePlanned,
  RewriteProblem,
} from '@/platform/rewrite'

/**
 * Moving a file or folder with the links that point at it. Rust finds the links and rewrites the
 * closed files; this asks the question, keeps the open documents in step (an unsaved one gets
 * edits it can undo, a clean one reloads) and lists what could not be done.
 */

/** What the user may answer when asked. */
export type RewriteAnswer = 'update' | 'move-only' | 'cancel'

/** What the sidebar shows, or null when nothing is going on. */
export type RewriteState =
  | { readonly phase: 'scanning'; readonly scanned: number }
  | { readonly phase: 'asking'; readonly planned: RewritePlanned }
  | {
      readonly phase: 'report'
      /** Files whose links were not changed, with the reason. */
      readonly failed: readonly RewriteProblem[]
      /** Files the scan could not read, whose links were not checked. */
      readonly skipped: readonly RewriteProblem[]
    }

export const rewriteState = shallowRef<RewriteState | null>(null)

let answer: ((choice: RewriteAnswer) => void) | undefined

/** The user's answer to the question the sidebar shows. */
export function answerRewrite(choice: RewriteAnswer): void {
  answer?.(choice)
}

/** Stops a scan that is running. */
export function cancelRewriteScan(): void {
  void getHost().then((host) => host.rewriteCancel())
}

/** Closes the list of what could not be done. */
export function dismissRewriteReport(): void {
  if (rewriteState.value?.phase === 'report') rewriteState.value = null
}

/** The text of every open document with unsaved edits, as the editor holds it now. */
export function dirtyBuffers(): RewriteBuffer[] {
  return allDocuments()
    .filter((doc) => doc.dirty)
    .map((doc) => ({ id: doc.id, text: doc.snapshot().text }))
}

function ask(planned: RewritePlanned): Promise<RewriteAnswer> {
  return new Promise((resolve) => {
    answer = (choice) => {
      answer = undefined
      resolve(choice)
    }
    rewriteState.value = { phase: 'asking', planned }
  })
}

export interface MoveOptions {
  /** Called once, when the move has been checked and the scan found nothing wrong with it. */
  readonly onChecked?: () => void
}

/**
 * Renames or moves `path`, rewriting the links that would break. Resolves to where it went, or
 * null when the user cancelled. Rejects as `renameEntry` and `moveEntry` do for a name that is
 * taken or not allowed, before anything is scanned.
 */
export async function moveWithLinks(
  path: string,
  change: RewriteChange,
  options: MoveOptions = {},
): Promise<Moved | null> {
  const host = await getHost()
  const plain = (): Promise<Moved> =>
    change.kind === 'rename'
      ? host.renameEntry(path, change.name)
      : host.moveEntry(path, change.into)

  rewriteState.value = { phase: 'scanning', scanned: 0 }
  let planned: RewritePlanned
  try {
    planned = await host.rewritePlan(path, change, dirtyBuffers(), (scanned) => {
      if (rewriteState.value?.phase === 'scanning')
        rewriteState.value = { phase: 'scanning', scanned }
    })
  } catch (error) {
    rewriteState.value = null
    throw error
  }
  options.onChecked?.()
  if (planned.cancelled) {
    rewriteState.value = null
    return null
  }
  if (planned.links === 0) {
    // Nothing to change: the plain move, and say so when some files could not be checked.
    rewriteState.value = null
    if (planned.token !== 0) await host.rewriteDiscard(planned.token)
    const moved = await plain()
    if (planned.skipped.length > 0) {
      rewriteState.value = { phase: 'report', failed: [], skipped: planned.skipped }
    }
    return moved
  }

  const choice = settings.links.confirmRewrite ? await ask(planned) : 'update'
  rewriteState.value = null
  if (choice === 'cancel') {
    await host.rewriteDiscard(planned.token)
    return null
  }
  if (choice === 'move-only') {
    await host.rewriteDiscard(planned.token)
    return plain()
  }
  return finish(planned)
}

async function finish(planned: RewritePlanned): Promise<Moved> {
  const host = await getHost()
  // Who holds edits is decided now, not when the question was asked: typing may have gone on.
  const ids = new Set([...planned.buffers, ...dirtyBuffers().map((buffer) => buffer.id)])
  const sent = [...ids].flatMap((id) => {
    const doc = documentById(id)
    return doc === undefined ? [] : [{ id, text: doc.snapshot().text, doc: doc.snapshot().doc }]
  })
  const done = await host.rewriteMove(
    planned.token,
    sent.map(({ id, text }) => ({ id, text })),
  )

  const failed: RewriteProblem[] = [...done.failed]
  for (const { id, changes } of done.edits) {
    const doc = documentById(id)
    const before = sent.find((item) => item.id === id)?.doc
    if (doc === undefined || before === undefined) continue
    if (!doc.snapshot().doc.eq(before)) {
      failed.push({
        path: doc.path,
        reason: 'it was edited while the links were being updated, so its links were not changed',
      })
      continue
    }
    doc.applyEdits(changes)
  }
  await Promise.all(done.reload.map((id) => refreshFromDisk(id)))

  if (failed.length > 0 || planned.skipped.length > 0) {
    rewriteState.value = { phase: 'report', failed, skipped: planned.skipped }
  }
  return done.moved
}
