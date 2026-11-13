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
import { imageSink, imageStamp } from '@/editor/imagePaste'
import { imageContext, imagesMoved } from '@/editor/livePreview/blocks'
import { brokenLinks, LinkStatus, linkStatus } from '@/editor/brokenLinks'
import { linkNavigation } from '@/editor/links'
import { renameEdits } from './draftLinks'
import { isLargeFile } from './largeFile'
import { endingsOf, lineEndingsFor } from '@/editor/lineEndings'
import { sourceCopy } from '@/editor/sourceCopy'
import { carriedAnnotations, followerSync } from '@/editor/sync'
import { endingsEqual, type Endings } from '@/lib/endings'
import type { OpenedFile, ReadOnlyReason, SavedAs, SavedFile } from '@/platform'
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
  /** The workspace folder that holds a file, or null: how far up an image path may climb. */
  readonly imageBoundary?: (path: string) => string | null
  /** Called whenever something a session snapshot holds may have changed: text, caret, saved state. */
  readonly touched?: () => void
  /** Called on Ctrl+click on a link in a tab of this document, with the target as written. */
  readonly followLink?: (tabId: string, href: string) => void
  /** The number in the name of an untitled document, which has no path. */
  readonly untitledNumber?: number
  /**
   * Where the images of an untitled document are kept, since it has no folder of its own: its
   * pictures are linked and loaded from here until the first Save As copies them beside the file.
   */
  readonly draftFolder?: string
  /**
   * Saves a pasted or dropped picture next to this document, by the stamp (local time) for its
   * name, and resolves to the path to write in the link. Without it a paste of a picture is an
   * ordinary paste.
   */
  readonly saveImage?: (bytes: ArrayBuffer, stamp: string) => Promise<string>
  /**
   * Handles a file a native drop delivered onto this document's text: resolves to the link path,
   * the file's own place when it is inside the workspace folder and a copy in `assets` when not.
   */
  readonly dropImage?: (path: string, stamp: string) => Promise<string>
  /** Shows the user a message about something that did not work. */
  readonly notify?: (message: string) => void
  /** Says which link targets are missing files, for the broken-link style. Without it, none is drawn. */
  readonly checkLinks?: (hrefs: readonly string[]) => Promise<readonly boolean[]>
}

/** `doc` with the links of renamed images updated. */
function renamedLinks(doc: Text, renames: ReadonlyMap<string, string>): Text {
  const edits = renameEdits(doc.toString(), renames)
  return edits.length === 0 ? doc : ChangeSet.of(edits, doc.length).apply(doc)
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
  /** The number in the name of an untitled document, or null for one that has a file. */
  untitledNumber: number | null
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
    this.untitledNumber = options.untitledNumber ?? null
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

  /** True for a new document that has no file yet. */
  get untitled(): boolean {
    return this.path === ''
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
            this.#imageSinkSupport(),
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
        if (this.untitled) return this.#options.draftFolder ?? null
        const cut = Math.max(this.path.lastIndexOf('/'), this.path.lastIndexOf('\\'))
        return cut <= 0 ? null : this.path.slice(0, cut)
      },
      boundary: () => (this.untitled ? null : (this.#options.imageBoundary?.(this.path) ?? null)),
      url,
    })
  }

  /**
   * What lets a tab take a picture: the paste hands it to `saveImage` and the drop to `dropImage`. A
   * document with no file keeps them in its draft folder, which the host makes with the first one.
   */
  #imageSinkSupport(): Extension {
    const save = this.#options.saveImage
    if (save === undefined) return []
    const notify = this.#options.notify ?? (() => undefined)
    return imageSink.of({
      refusal: () => null,
      save: (bytes) => save(bytes, imageStamp()),
      drop: (path) => {
        const handle = this.#options.dropImage
        return handle === undefined
          ? Promise.reject(new Error('this document takes no dropped images'))
          : handle(path, imageStamp())
      },
      notify,
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
   * Gives the document the file a Save As wrote: it follows the file, `snapshot` is what that file
   * holds, and the history stays. A document that could not be saved (a file in an encoding mdmate
   * cannot write) can be saved from now on, since what was written is UTF-8. Images that got
   * another name beside the file are renamed in the links of the text too, as one change that is
   * not a step of history (the written file has it already).
   */
  relocate(snapshot: Snapshot, saved: SavedAs): void {
    const renames = new Map(saved.renamedImages.map((image) => [image.from, image.to]))
    const baseline = renames.size === 0 ? snapshot.doc : renamedLinks(snapshot.doc, renames)
    if (renames.size > 0) this.#renameImageLinks(renames)
    this.path = saved.path
    this.name = saved.name
    this.untitledNumber = null
    this.#saved = { doc: baseline, endings: snapshot.endings }
    this.diskHash = saved.hash
    this.#applyReadOnly(null)
    this.imagesMoved()
    this.#touched()
    this.#refreshDirty()
    this.#changed(this)
  }

  /**
   * Points the links of renamed images at their new names, in the master and every follower, as a
   * change history does not record: undo takes back typing, never a rename the disk already has.
   */
  #renameImageLinks(renames: ReadonlyMap<string, string>): void {
    const master = this.#master
    const edits = renameEdits(master.doc.toString(), renames)
    if (edits.length === 0) return
    const changes = ChangeSet.of(edits, master.doc.length, master.lineBreak)
    this.#master = master.update({
      changes,
      annotations: Transaction.addToHistory.of(false),
    }).state
    for (const follower of this.#followers.values()) follower.receive(changes)
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

  /**
   * Tells every tab that the folder its pictures load from has changed: the document got a file, or
   * its file moved. The text may be the same, so the pictures are resolved again on purpose.
   */
  imagesMoved(): void {
    const effect = imagesMoved.of(null)
    for (const follower of this.#followers.values()) follower.reconfigure(effect)
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
