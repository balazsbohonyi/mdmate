import { Compartment, type EditorState, type Extension, type StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { livePreview } from './livePreview'

/** Class on `.cm-editor` while showing plain source or Raw Markdown, so the code font applies. */
export const SOURCE_MODE_CLASS = 'cm-source-mode'

/** Extension that puts `.cm-source-mode` on the editor root. */
export const sourceModeAttr: Extension = EditorView.editorAttributes.of({
  class: SOURCE_MODE_CLASS,
})

/**
 * Whether a state draws live preview or the raw Markdown, which a pane switches without touching
 * the text. The compartment sits in every state that has the parser; a state without it (plain
 * source) has no preview to switch.
 */
const slot = new Compartment()
const on: Extension = livePreview()
const off: Extension = sourceModeAttr

/** The extension that holds the preview, for a state's configuration. Starts on. */
export function previewSlot(): Extension {
  return slot.of(on)
}

/** The effect that makes `state` show preview (or raw), or null when it already does or cannot. */
export function previewEffect(state: EditorState, preview: boolean): StateEffect<unknown> | null {
  const current = slot.get(state)
  if (current === undefined) return null
  const wanted = preview ? on : off
  return current === wanted ? null : slot.reconfigure(wanted)
}

/** True while `state` draws live preview. False for raw, and for a state that has none. */
export function previewShown(state: EditorState): boolean {
  return slot.get(state) === on
}
