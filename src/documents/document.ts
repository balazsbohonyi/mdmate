import { redo, undo } from '@codemirror/commands'
import {
  EditorState,
  Transaction,
  type Extension,
  type StateCommand,
  type Text,
} from '@codemirror/state'
import { createFollowerState, createMasterState } from '@/editor/create'
import { endingsOf, lineEndingsFor } from '@/editor/lineEndings'
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

export interface DocumentOptions {
  /** False gives views plain source, with no Markdown parser, as for a file above the size cutoff. */
  readonly parser?: boolean
  /** Extensions every view of this document gets, such as live preview. */
  readonly extensions?: Extension
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
  /** Hash of the bytes last read from or written to disk. */
  diskHash: string
  #master: EditorState
  #saved: { doc: Text; endings: Endings }
  #dirty = false
  readonly #followers = new Map<string, Follower>()
  readonly #options: DocumentOptions
  readonly #changed: (doc: Document) => void

  constructor(opened: OpenedFile, changed: (doc: Document) => void, options: DocumentOptions = {}) {
    this.id = opened.id
    this.path = opened.path
    this.name = opened.name
    this.readOnly = opened.readOnly
    this.diskHash = opened.hash
    this.#changed = changed
    this.#options = options
    this.#master = createMasterState(opened.text, [
      lineEndingsFor(opened.endings),
      EditorState.readOnly.of(opened.readOnly !== null),
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
          selection: this.#master.selection,
          parser: this.#options.parser,
          extensions: [
            followerSync(link),
            EditorState.readOnly.of(this.readOnly !== null),
            this.#options.extensions ?? [],
          ],
        }),
      )
      this.#followers.set(tabId, follower)
    }
    return follower
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
    this.#refreshDirty()
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
    this.#refreshDirty()
    return true
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
    this.#refreshDirty()
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
