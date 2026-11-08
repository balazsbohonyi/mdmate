import type { EditorView } from '@codemirror/view'
import type { Follower } from '@/documents/follower'
import { createView } from '@/editor/create'
import { previewEffect } from '@/editor/previewMode'

/**
 * The editor of one pane. The view is made once and lives as long as the pane; each tab's state
 * is swapped in with `setState`, which keeps a tab switch cheap. Whether the pane shows live
 * preview or raw Markdown belongs to the pane, not to a tab, so it is applied again every time a
 * tab is shown: a tab that was last shown in another pane, or before the toggle, still comes up in
 * the pane's mode.
 */
export class PaneEditor {
  readonly #parent: HTMLElement
  #view: EditorView | undefined
  #shown: Follower | undefined
  #raw = false

  constructor(parent: HTMLElement) {
    this.#parent = parent
  }

  /** The view, once a tab has been shown. */
  get view(): EditorView | undefined {
    return this.#view
  }

  /** True while the pane shows raw Markdown. */
  get raw(): boolean {
    return this.#raw
  }

  /** Shows a tab's follower. Does nothing when it is already the one on screen. */
  show(follower: Follower, focus = false): void {
    if (follower === this.#shown) return
    this.#shown?.park()
    this.#view ??= createView(this.#parent, follower.state)
    follower.show(this.#view)
    this.#shown = follower
    this.#applyMode()
    if (focus) this.#view.focus()
  }

  /** Switches the pane between raw Markdown and live preview. */
  setRaw(raw: boolean): void {
    this.#raw = raw
    this.#applyMode()
  }

  focus(): void {
    this.#view?.focus()
  }

  /** Gives the state back to its follower and removes the view. */
  destroy(): void {
    this.#shown?.park()
    this.#shown = undefined
    this.#view?.destroy()
    this.#view = undefined
  }

  #applyMode(): void {
    if (this.#shown === undefined) return
    // Through the follower, so the document knows it is a setting and not an edit.
    const effect = previewEffect(this.#shown.state, !this.#raw)
    if (effect !== null) this.#shown.reconfigure(effect)
  }
}
