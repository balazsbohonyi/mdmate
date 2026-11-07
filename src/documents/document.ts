import { EditorState, type Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createState } from '@/editor/create'
import { endingsOf, lineEndingsFor } from '@/editor/lineEndings'
import { endingsEqual, type Endings } from '@/lib/endings'
import type { OpenedFile, ReadOnlyReason, SavedFile } from '@/platform'

/** What a save sends: the text and endings as they were at one moment. */
export interface Snapshot {
  readonly doc: Text
  readonly endings: Endings
  readonly text: string
}

/**
 * One open file: its editor state, and what is known about the file on disk. Plain TypeScript,
 * never inside Vue's reactivity; the chrome reads `DocMeta` instead.
 */
export class Document {
  readonly id: number
  path: string
  name: string
  readOnly: ReadOnlyReason | null
  /** Hash of the bytes last read from or written to disk. */
  diskHash: string
  state: EditorState
  #saved: { doc: Text; endings: Endings }
  #dirty = false
  readonly #changed: (doc: Document) => void

  constructor(opened: OpenedFile, changed: (doc: Document) => void) {
    this.id = opened.id
    this.path = opened.path
    this.name = opened.name
    this.readOnly = opened.readOnly
    this.diskHash = opened.hash
    this.#changed = changed
    this.state = createState(opened.text, [
      lineEndingsFor(opened.endings),
      EditorState.readOnly.of(opened.readOnly !== null),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) this.setState(update.state)
      }),
    ])
    this.#saved = { doc: this.state.doc, endings: endingsOf(this.state) }
  }

  get dirty(): boolean {
    return this.#dirty
  }

  /** Takes the state the view ended up with after an edit. */
  setState(state: EditorState): void {
    this.state = state
    this.#refreshDirty()
  }

  /** The text and endings right now, for a save. */
  snapshot(): Snapshot {
    const doc = this.state.doc
    return { doc, endings: endingsOf(this.state), text: doc.toString() }
  }

  /** Records that `snapshot` is now on disk. Edits made while the save ran stay unsaved. */
  markSaved(snapshot: Snapshot, saved: SavedFile): void {
    this.#saved = { doc: snapshot.doc, endings: snapshot.endings }
    this.diskHash = saved.hash
    this.#refreshDirty()
  }

  #refreshDirty(): void {
    const dirty =
      !this.state.doc.eq(this.#saved.doc) ||
      !endingsEqual(endingsOf(this.state), this.#saved.endings)
    if (dirty === this.#dirty) return
    this.#dirty = dirty
    this.#changed(this)
  }
}
