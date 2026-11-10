import { redo, undo } from '@codemirror/commands'
import {
  ChangeSet,
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
  type StateCommand,
  type Text,
} from '@codemirror/state'
import { createFollowerState, createMasterState } from '@/editor/create'
import { imageContext } from '@/editor/livePreview/blocks'
import { brokenLinks, LinkStatus, linkStatus } from '@/editor/brokenLinks'
import { linkNavigation } from '@/editor/links'
import { isLargeFile } from './largeFile'
import { endingsOf, lineEndingsFor } from '@/editor/lineEndings'
import { sourceCopy } from '@/editor/sourceCopy'
import { carriedAnnotations, followerSync } from '@/editor/sync'
import { endingsEqual, type Endings } from '@/lib/endings'
import type { OpenedFile, ReadOnlyReason, SavedFile } from '@/platform'
import { Follower, type FollowerHost } from './follower'

/** What a save sends: the text and endings as they were at one moment. */
export interface Snapshot {
  readonly doc: Text
  readonly endings: Endings
  readonly text: string
}

/** The read-only setting of the master and of every follower, in a compartment so a reload can change it. */
const readOnlySetting = new Compartment()

function readOnlyFacet(readOnly: ReadOnlyReason | null): Extension {
  return readOnlySetting.of(EditorState.readOnly.of(readOnly !== null))
}

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff

/**
 * The smallest single change that turns `before` into `after`, or null when they are the same.
 * Keeping it small keeps carets and scroll positions where they were, away from the edit.
 */
function smallestChange(
  before: string,
  after: string,
): { from: number; to: number; insert: string } | null {
  if (before === after) return null
  const limit = Math.min(before.length, after.length)
  let from = 0
  while (from < limit && before.charCodeAt(from) === after.charCodeAt(from)) from++
  // Never cut between the two halves of one character.
  if (from > 0 && isHighSurrogate(before.charCodeAt(from - 1))) from--
  let endBefore = before.length
  let endAfter = after.length
  while (
    endBefore > from &&
    endAfter > from &&
    before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
  ) {
    endBefore--
    endAfter--
  }
  if (endBefore < before.length && isLowSurrogate(before.charCodeAt(endBefore))) {
    endBefore++
    endAfter++
  }
  return { from, to: endBefore, insert: after.slice(from, endAfter) }
}

export interface DocumentOptions {
  /** False gives views plain source, with no Markdown parser, as for a file above the size cutoff. */
  readonly parser?: boolean
  /** Extensions every view of this document gets, such as live preview. */
  readonly extensions?: Extension
  /** Turns the path of a file on disk into an address the webview can load, for images. */
  readonly assetUrl?: (path: string) => string
  /** Called whenever something a session snapshot holds may have changed: text, caret, saved state. */
  readonly touched?: () => void
  /** Called on Ctrl+click on a link in a tab of this document, with the target as written. */
  readonly followLink?: (tabId: string, href: string) => void
  /** Says which link targets are missing files, for the broken-link style. Without it, none is drawn. */
  readonly checkLinks?: (hrefs: readonly string[]) => Promise<readonly boolean[]>
}

/** Where a caret is, as the session stores it. */
export interface Caret {
  readonly anchor: number
  readonly head: number
}

/**
 * One open file. A headless master `EditorState` owns the text, the undo history and the line
 * endings. Each tab showing the file has a `Follower`, whose state a view displays. Edits made in
 * a follower go to the master, and from there to every other follower. Plain TypeScript, never
 * inside Vue's reactivity; the chrome reads `DocMeta` instead.
 */
export class Document implements FollowerHost {
  readonly id: number
  path: string
  name: string
  readOnly: ReadOnlyReason | null
  /** How the file opens: Markdown in the live editor, anything else as plain source. */
  readonly kind: 'markdown' | 'text'
  /**
   * True when its tabs show plain source, with no parser: a file that is not Markdown, or a
   * Markdown file above the size cutoff.
   */
  readonly plainSource: boolean
  /** Hash of the bytes last read from or written to disk. */
  diskHash: string
  #master: EditorState
  #saved: { doc: Text; endings: Endings }
  #dirty = false
  readonly #followers = new Map<string, Follower>()
  readonly #options: DocumentOptions
  readonly #changed: (doc: Document) => void
  readonly #touched: () => void
  /** Carets restored from a session, for tabs whose follower does not exist yet. */
  readonly #seeds = new Map<string, EditorSelection>()

  constructor(opened: OpenedFile, changed: (doc: Document) => void, options: DocumentOptions = {}) {
    this.id = opened.id
    this.path = opened.path
    this.name = opened.name
    this.readOnly = opened.readOnly
    this.diskHash = opened.hash
    this.#changed = changed
    this.#touched = options.touched ?? (() => undefined)
    // An explicit choice wins (the perf scenarios make one); otherwise the file's size decides.
    this.kind = opened.kind === 'markdown' ? 'markdown' : 'text'
    const parser = options.parser ?? (this.kind === 'markdown' && !isLargeFile(opened.size))
    this.plainSource = !parser
    this.#options = { ...options, parser }
    this.#master = createMasterState(opened.text, [
      lineEndingsFor(opened.endings),
      readOnlyFacet(opened.readOnly),
    ])
    this.#saved = { doc: this.#master.doc, endings: endingsOf(this.#master) }
  }

  /** The state that owns the document. Read it; change it only through a follower. */
  get master(): EditorState {
    return this.#master
  }

  get dirty(): boolean {
    return this.#dirty
  }

  /** How many tabs have a follower on this document. */
  get followerCount(): number {
    return this.#followers.size
  }

  /** The follower for a tab, made on first use with the document's text and caret. */
  followerFor(tabId: string): Follower {
    let follower = this.#followers.get(tabId)
    if (follower === undefined) {
      follower = new Follower(tabId, this, (link) =>
        createFollowerState({
          doc: this.#master.doc,
          selection: this.#seeds.get(tabId) ?? this.#master.selection,
          parser: this.#options.parser,
          extensions: [
            followerSync(link),
            sourceCopy(() => link.endings()),
            readOnlyFacet(this.readOnly),
            this.#imageSupport(),
            this.#linkSupport(tabId),
            this.#brokenLinkSupport(),
            this.#options.extensions ?? [],
          ],
        }),
      )
      this.#followers.set(tabId, follower)
      this.#seeds.delete(tabId)
    }
    return follower
  }

  /** One answer cache for the whole document, so every tab of it shares what is known. */
  #linkStatus: LinkStatus | null = null

  /** The broken-link style, for documents with a parser and a way to check. */
  #brokenLinkSupport(): Extension {
    const check = this.#options.checkLinks
    if (check === undefined || this.#options.parser === false) return []
    this.#linkStatus ??= new LinkStatus(check)
    return [linkStatus.of(this.#linkStatus), brokenLinks()]
  }

  /** Ctrl+click on a link in this tab. Without a `followLink` option, links are only text. */
  #linkSupport(tabId: string): Extension {
    const follow = this.#options.followLink
    if (follow === undefined) return []
    return linkNavigation((hit) => {
      follow(tabId, hit.href)
    })
  }

  /** What lets live preview load the images next to this file. Without an `assetUrl` there are none. */
  #imageSupport(): Extension {
    const url = this.#options.assetUrl
    if (url === undefined) return []
    return imageContext.of({
      folder: () => {
        const cut = Math.max(this.path.lastIndexOf('/'), this.path.lastIndexOf('\\'))
        return cut <= 0 ? null : this.path.slice(0, cut)
      },
      url,
    })
  }

  /** Where the caret of a tab is: in its follower once that exists, otherwise where it was seeded. */
  caretOf(tabId: string): Caret {
    const follower = this.#followers.get(tabId)
    const { anchor, head } = (
      follower?.state.selection ??
      this.#seeds.get(tabId) ??
      this.#master.selection
    ).main
    return { anchor, head }
  }

  /** Sets where a tab's caret will be when its follower is made. Positions are clamped to the text. */
  seedCaret(tabId: string, caret: Caret): void {
    const length = this.#master.doc.length
    const clamp = (position: number): number => Math.max(0, Math.min(length, position))
    const selection = EditorSelection.single(clamp(caret.anchor), clamp(caret.head))
    const follower = this.#followers.get(tabId)
    if (follower === undefined) this.#seeds.set(tabId, selection)
    else follower.dispatch({ selection })
  }

  /** Drops a tab's follower. The document, and its undo history, stay. */
  closeFollower(tabId: string): void {
    const follower = this.#followers.get(tabId)
    if (follower === undefined) return
    follower.park()
    this.#followers.delete(tabId)
  }

  /** Takes edits a follower's user made: into the master, then into every other follower. */
  forward(origin: Follower, transactions: readonly Transaction[]): void {
    for (const tr of transactions) {
      if (!tr.docChanged && !tr.selection) continue
      let master = this.#master
      // History records the selection from before an edit, so the master must have the caret the
      // edit was made from, which another follower may have moved since.
      if (tr.docChanged && !master.selection.eq(tr.startState.selection)) {
        master = master.update({
          selection: tr.startState.selection,
          annotations: Transaction.addToHistory.of(false),
        }).state
      }
      this.#master = master.update({
        changes: tr.changes,
        selection: tr.newSelection,
        annotations: tr.docChanged ? carriedAnnotations(tr) : Transaction.addToHistory.of(false),
      }).state
      if (!tr.docChanged) continue
      for (const follower of this.#followers.values()) {
        if (follower !== origin) follower.receive(tr.changes)
      }
    }
    this.#touched()
    this.#refreshDirty()
  }

  /**
   * Changes the text the way typing would: one step of history that undo takes back, the same
   * change in every follower, and the document counts as edited. For edits that come from the app
   * itself, such as rewritten links. Positions are in the master's text.
   */
  applyEdits(edits: readonly { from: number; to: number; insert: string }[]): void {
    if (edits.length === 0) return
    const master = this.#master
    const changes = ChangeSet.of(
      edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.insert })),
      master.doc.length,
      master.lineBreak,
    )
    this.#master = master.update({ changes, userEvent: 'input.rewrite' }).state
    for (const follower of this.#followers.values()) follower.receive(changes)
    this.#touched()
    this.#refreshDirty()
  }

  /** The line ending of every break, as the file had them. Followers hold `\n` only. */
  endings(): Endings {
    return endingsOf(this.#master)
  }

  undo(origin: Follower): boolean {
    return this.#stepHistory(origin, undo)
  }

  redo(origin: Follower): boolean {
    return this.#stepHistory(origin, redo)
  }

  /** Runs undo or redo on the master and shows the result in every follower. */
  #stepHistory(origin: Follower, command: StateCommand): boolean {
    const steps: Transaction[] = []
    const ran = command({
      state: this.#master,
      dispatch: (tr) => {
        steps.push(tr)
      },
    })
    const step = steps[0]
    if (!ran || step === undefined) return false
    this.#master = step.state
    for (const follower of this.#followers.values()) {
      if (follower === origin) follower.receive(step.changes, step.newSelection)
      else follower.receive(step.changes)
    }
    this.#touched()
    this.#refreshDirty()
    return true
  }

  /**
   * Shows what an earlier run left unsaved. `disk` is the file as it is now; `buffer` is the text
   * and endings the user had. The document then holds the buffer and counts as edited from the disk's
   * content, so it is clean when the two happen to be equal and edited otherwise.
   */
  restoreBuffer(disk: OpenedFile, buffer: { text: string; endings: Endings }): void {
    this.reload({ ...disk, text: buffer.text, endings: buffer.endings })
    this.adoptDisk(disk)
  }

  /** The text and endings right now, for a save. */
  snapshot(): Snapshot {
    const doc = this.#master.doc
    return { doc, endings: endingsOf(this.#master), text: doc.toString() }
  }

  /** Records that `snapshot` is now on disk. Edits made while the save ran stay unsaved. */
  markSaved(snapshot: Snapshot, saved: SavedFile): void {
    this.#saved = { doc: snapshot.doc, endings: snapshot.endings }
    this.diskHash = saved.hash
    this.#touched()
    this.#refreshDirty()
  }

  /**
   * Replaces the document with what is on disk now, for a file another program changed. History
   * starts over, since its steps describe text that is gone. Every follower gets the difference as
   * one change, so carets away from it stay put. Edits not yet saved are lost, which is why the
   * caller only does this for a document with none, or after the user chose it.
   */
  reload(opened: OpenedFile): void {
    const before = this.#master
    const change = smallestChange(before.doc.toString(), opened.text)
    const changes =
      change === null ? null : ChangeSet.of(change, before.doc.length, before.lineBreak)
    this.#master = createMasterState(opened.text, [
      lineEndingsFor(opened.endings),
      readOnlyFacet(opened.readOnly),
    ])
    const selection = changes === null ? before.selection : before.selection.map(changes)
    if (!selection.eq(this.#master.selection)) {
      this.#master = this.#master.update({ selection }).state
    }
    this.#saved = { doc: this.#master.doc, endings: endingsOf(this.#master) }
    this.diskHash = opened.hash
    this.#applyReadOnly(opened.readOnly)
    if (changes !== null) {
      for (const follower of this.#followers.values()) follower.receive(changes)
    }
    this.#touched()
    this.#refreshDirty()
  }

  /**
   * Takes the disk's content as the document's saved baseline without touching its text, for when
   * the user keeps their edits over a change on disk. The document stays edited as long as its
   * text differs from the disk's, and the next save replaces the file.
   */
  adoptDisk(opened: OpenedFile): void {
    const theirs = createMasterState(opened.text, [lineEndingsFor(opened.endings)])
    this.#saved = { doc: theirs.doc, endings: endingsOf(theirs) }
    this.diskHash = opened.hash
    this.#applyReadOnly(opened.readOnly)
    this.#touched()
    this.#refreshDirty()
  }

  /** Follows a change in whether the file can be saved, in the master and in every follower. */
  #applyReadOnly(readOnly: ReadOnlyReason | null): void {
    if ((this.readOnly !== null) === (readOnly !== null)) {
      this.readOnly = readOnly
      return
    }
    this.readOnly = readOnly
    const effect = readOnlySetting.reconfigure(EditorState.readOnly.of(readOnly !== null))
    this.#master = this.#master.update({ effects: effect }).state
    for (const follower of this.#followers.values()) follower.reconfigure(effect)
    this.#changed(this)
  }

  #refreshDirty(): void {
    const dirty =
      !this.#master.doc.eq(this.#saved.doc) ||
      !endingsEqual(endingsOf(this.#master), this.#saved.endings)
    if (dirty === this.#dirty) return
    this.#dirty = dirty
    this.#changed(this)
  }
}
