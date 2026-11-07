import { Compartment, type EditorState, type Extension, type StateEffect } from '@codemirror/state'
import { livePreview } from './livePreview'

/**
 * Whether a state draws live preview or the raw Markdown, which a pane switches without touching
 * the text. The compartment sits in every state that has the parser; a state without it (plain
 * source) has no preview to switch.
 */
const slot = new Compartment()
const on: Extension = livePreview()
const off: Extension = []

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
