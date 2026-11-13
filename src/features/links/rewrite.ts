import { shallowRef } from 'vue'
import { settings, type LinksOnRename } from '@/lib/settings'
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

/** What a rename or move updated, for the line shown afterwards. */
export interface RewriteUpdated {
  /** How many links (zero when none pointed at the file), or null when some files kept theirs and the count would be a guess. */
  readonly links: number | null
  readonly files: number
}

/** What the sidebar shows, or null when nothing is going on. */
export type RewriteState =
  | { readonly phase: 'scanning'; readonly scanned: number }
  /** Asked before any file is read for links, so there are no counts yet. */
  | { readonly phase: 'asking'; readonly path: string }
  | {
      readonly phase: 'report'
      /** What was updated, when links were. */
      readonly updated: RewriteUpdated | null
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

function ask(path: string): Promise<RewriteAnswer> {
  return new Promise((resolve) => {
    answer = (choice) => {
      answer = undefined
      resolve(choice)
    }
    rewriteState.value = { phase: 'asking', path }
  })
}

/** How long a line that only says what was updated stays up. */
const SUMMARY_MS = 6000

/** Shows what was done and what could not be. A report with nothing wrong in it goes away by itself. */
function showReport(report: Extract<RewriteState, { phase: 'report' }>): void {
  rewriteState.value = report
  if (report.failed.length > 0 || report.skipped.length > 0) return
  setTimeout(() => {
    if (rewriteState.value === report) rewriteState.value = null
  }, SUMMARY_MS)
}

export interface MoveOptions {
  /** Called once, when the move has been checked and the scan found nothing wrong with it. */
  readonly onChecked?: () => void
}

/**
 * Renames or moves `path`, and rewrites the links that would break when `links.onRename` says so.
 * Resolves to where it went, or null when the user cancelled. Rejects as `renameEntry` and
 * `moveEntry` do for a name that is taken or not allowed, before anything is asked or read.
 *
 * - `never`: nothing is asked and no file is read for links; the file is only renamed or moved.
 * - `ask`: the question comes first and "Yes" is its default answer; the workspace is read for
 *   links only after "Yes", and "No" only renames or moves.
 * - `update`: the workspace is read and the links updated without a question.
 *
 * Cancel, in the question or while the links are being looked for, leaves everything as it was.
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

  const mode: LinksOnRename = (await host.linksOnRenameOverride()) ?? settings.links.onRename
  if (mode === 'never') {
    const moved = await plain()
    options.onChecked?.()
    return moved
  }

  // The change is checked before anything is asked or read, so a name that cannot be used is
  // explained where it was typed, and a change that moves nothing asks nothing.
  const something = await host.rewriteCheck(path, change)
  options.onChecked?.()
  if (!something) return plain()

  if (mode === 'ask') {
    const choice = await ask(path)
    rewriteState.value = null
    if (choice === 'cancel') return null
    if (choice === 'move-only') return plain()
  }

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
  if (planned.cancelled) {
    rewriteState.value = null
    return null
  }
  if (planned.links === 0) {
    // Nothing to change: the plain move, and say so when some files could not be checked.
    rewriteState.value = null
    if (planned.token !== 0) await host.rewriteDiscard(planned.token)
    const moved = await plain()
    // Said out loud: after a long scan, silence reads as if nothing had happened.
    showReport({
      phase: 'report',
      updated: { links: 0, files: 0 },
      failed: [],
      skipped: planned.skipped,
    })
    return moved
  }

  rewriteState.value = null
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

  const files = Math.max(0, planned.files - failed.length)
  const updated: RewriteUpdated | null =
    files === 0 ? null : { links: failed.length === 0 ? planned.links : null, files }
  showReport({ phase: 'report', updated, failed, skipped: planned.skipped })
  return done.moved
}
